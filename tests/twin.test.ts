import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SELF_HEARING } from "@/lib/domain/schemas";
import { MemoryStore } from "@/lib/store/memory";
import { ToolError } from "@/lib/tools";
import { encodeWav, parseWav } from "@/lib/voice/wav";
import { enroll_twin_voice, revoke_twin_voice, synthesize, update_self_hearing } from "@/lib/voice/twin";

const PATIENT = "demo-patient-complex";
const wavOf = (seconds: number, rate = 22050) =>
  encodeWav(Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => Math.sin(i / 20) * 0.3), rate);

let store: MemoryStore;
beforeEach(() => {
  store = new MemoryStore(new Date("2026-09-25T15:00:00Z"));
});

const enroll = (over: Partial<Parameters<typeof enroll_twin_voice>[1]> = {}) =>
  enroll_twin_voice(store, { patientId: PATIENT, wav: wavOf(12), consentName: "Sam T.", consent: true, ...over });

describe("WAV helpers", () => {
  it("round-trips duration and format", () => {
    const info = parseWav(wavOf(7.5))!;
    expect(info).toMatchObject({ sampleRate: 22050, channels: 1, bitsPerSample: 16 });
    expect(info.durationSec).toBeCloseTo(7.5, 2);
  });
  it("rejects non-WAV bytes", () => {
    expect(parseWav(new TextEncoder().encode("not audio at all, definitely not a riff header"))).toBeNull();
  });
});

describe("Digital Twin enrollment", () => {
  it("requires explicit consent and a typed name", async () => {
    await expect(enroll({ consent: false })).rejects.toMatchObject({ status: 403 });
    await expect(enroll({ consentName: "   " })).rejects.toMatchObject({ status: 403 });
    expect(await store.getActiveVoiceProfile(PATIENT)).toBeNull();
  });

  it("enforces duration and size limits", async () => {
    await expect(enroll({ wav: wavOf(3) })).rejects.toMatchObject({ status: 400 });
    await expect(enroll({ wav: wavOf(61) })).rejects.toMatchObject({ status: 400 });
    await expect(enroll({ wav: new Uint8Array(4 * 1024 * 1024 + 1) })).rejects.toMatchObject({ status: 413 });
    await expect(enroll({ wav: new Uint8Array(1000) })).rejects.toBeInstanceOf(ToolError);
  });

  it("rejects unknown patients", async () => {
    await expect(enroll({ patientId: "nobody" })).rejects.toMatchObject({ status: 404 });
  });

  it("stores the profile and sample, with default self-hearing, and audits it", async () => {
    const profile = await enroll();
    expect(profile.status).toBe("active");
    expect(profile.selfHearing).toEqual(DEFAULT_SELF_HEARING);
    expect(profile.consent.consentedBy).toBe("Sam T.");
    expect((await store.getVoiceSample(profile.id))?.byteLength).toBe(profile.sample.bytes);
    const audit = await store.listAudit({ patientId: PATIENT });
    expect(audit.some((a) => a.kind === "voice_enrolled")).toBe(true);
  });

  it("keeps one active profile per patient; re-enrolling deletes the old sample", async () => {
    const first = await enroll();
    const second = await enroll();
    expect((await store.getActiveVoiceProfile(PATIENT))!.id).toBe(second.id);
    expect((await store.getVoiceProfile(first.id))!.status).toBe("revoked");
    expect(await store.getVoiceSample(first.id)).toBeNull();
  });

  it("revoking withdraws consent and deletes the sample", async () => {
    const profile = await enroll();
    const revoked = await revoke_twin_voice(store, profile.id);
    expect(revoked.status).toBe("revoked");
    expect(await store.getVoiceSample(profile.id)).toBeNull();
    expect(await store.getActiveVoiceProfile(PATIENT)).toBeNull();
    expect((await store.listAudit({ patientId: PATIENT })).some((a) => a.kind === "voice_revoked")).toBe(true);
  });

  it("validates self-hearing updates", async () => {
    const profile = await enroll();
    const updated = await update_self_hearing(store, profile.id, { lowShelfDb: 8, enabled: false });
    expect(updated.selfHearing).toMatchObject({ lowShelfDb: 8, enabled: false, highShelfDb: -4 });
    await expect(update_self_hearing(store, profile.id, { reverbMix: 2 })).rejects.toThrow();
  });
});

describe("speech engine order: twin → Kokoro → browser", () => {
  const cfg = { twinTtsUrl: "http://twin", ttsBaseUrl: "http://kokoro/v1", ttsModel: "kokoro", ttsVoice: "af_heart" };
  const audio = () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/wav" } });

  it("uses the Digital Twin with the enrolled sample when available", async () => {
    await enroll();
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("http://twin");
      const body = JSON.parse(String(init?.body));
      expect(body.speaker_wav.length).toBeGreaterThan(100);
      expect(body.text).toBe("Hello");
      return audio();
    });
    const result = await synthesize(store, { text: "Hello", patientId: PATIENT }, { fetch: fetchMock as typeof fetch, config: cfg });
    expect(result.engine).toBe("twin");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to Kokoro when the twin server fails", async () => {
    await enroll();
    const fetchMock = vi.fn(async (url: string | URL | Request) =>
      String(url) === "http://twin" ? new Response("down", { status: 503 }) : audio(),
    );
    const result = await synthesize(store, { text: "Hello", patientId: PATIENT }, { fetch: fetchMock as typeof fetch, config: cfg });
    expect(result.engine).toBe("kokoro");
  });

  it("skips the twin when no voice is enrolled, and never sends a revoked sample", async () => {
    const profile = await enroll();
    await revoke_twin_voice(store, profile.id);
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return audio();
    });
    const result = await synthesize(store, { text: "Hello", patientId: PATIENT }, { fetch: fetchMock as typeof fetch, config: cfg });
    expect(result.engine).toBe("kokoro");
    expect(urls).not.toContain("http://twin");
  });

  it("sends the transcript as speaker_text when the profile has one", async () => {
    await enroll({ transcript: "  Most mornings   I make coffee.  " });
    let body: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return audio();
    });
    await synthesize(store, { text: "Hello", patientId: PATIENT }, { fetch: fetchMock as typeof fetch, config: cfg });
    expect(body.speaker_text).toBe("Most mornings I make coffee.");
  });

  it("omits speaker_text when there is no transcript", async () => {
    await enroll();
    let body: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return audio();
    });
    await synthesize(store, { text: "Hello", patientId: PATIENT }, { fetch: fetchMock as typeof fetch, config: cfg });
    expect(body).not.toHaveProperty("speaker_text");
  });

  it("falls back to the browser when nothing is configured", async () => {
    await enroll();
    const fetchMock = vi.fn();
    const result = await synthesize(
      store,
      { text: "Hello", patientId: PATIENT },
      { fetch: fetchMock as unknown as typeof fetch, config: { ...cfg, twinTtsUrl: "", ttsBaseUrl: "" } },
    );
    expect(result).toMatchObject({ engine: "browser" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/voices", () => {
  it("rejects an upload without consent", async () => {
    const { POST } = await import("@/app/api/voices/route");
    const form = new FormData();
    form.set("patientId", PATIENT);
    form.set("consentName", "Sam T.");
    form.set("audio", new Blob([wavOf(10) as BlobPart], { type: "audio/wav" }), "ref.wav");
    const res = await POST(new Request("http://x/api/voices", { method: "POST", body: form }));
    expect(res.status).toBe(403);
  });
});
