import { beforeEach, describe, expect, it } from "vitest";

import { featuredPatientId } from "@/lib/call/featured";
import { formatDuration, summarizeCall } from "@/lib/call/summary";
import { MemoryStore } from "@/lib/store/memory";
import { seedDemoTwin } from "@/lib/voice/demo-twin";
import { encodeWav } from "@/lib/voice/wav";

const wav = (seconds: number) => encodeWav(new Float32Array(Math.round(24000 * seconds)).fill(0.1), 24000);
const files: Record<string, Uint8Array> = {
  "/bundle/self_ref.wav": wav(6),
  "/bundle/self_ref.txt": new TextEncoder().encode("I made coffee and took the long way to work.\n"),
};
const read = async (p: string) => {
  if (!files[p]) throw new Error(`ENOENT: ${p}`);
  return files[p];
};
const env = {
  ANCHOR_DEMO_TWIN_WAV: "/bundle/self_ref.wav",
  ANCHOR_DEMO_TWIN_TEXT: "/bundle/self_ref.txt",
  ANCHOR_DEMO_TWIN_PATIENT: "demo-patient-ideal",
  ANCHOR_DEMO_TWIN_CONSENTED_BY: "Jordan R.",
};

let store: MemoryStore;
beforeEach(() => {
  store = new MemoryStore(new Date("2026-09-25T15:00:00Z"));
});

describe("demo twin seeding", () => {
  it("does nothing when not configured", async () => {
    expect(await seedDemoTwin(store, {}, read)).toEqual({ status: "not_configured" });
  });

  it("never seeds without a named consenting person", async () => {
    const outcome = await seedDemoTwin(store, { ...env, ANCHOR_DEMO_TWIN_CONSENTED_BY: " " }, read);
    expect(outcome).toEqual({ status: "missing_consent" });
    expect(await store.getActiveVoiceProfile("demo-patient-ideal")).toBeNull();
  });

  it("seeds a deployment-attested twin with its transcript, 3 s minimum, and audits it", async () => {
    files["/bundle/short.wav"] = wav(3.5);
    const outcome = await seedDemoTwin(store, { ...env, ANCHOR_DEMO_TWIN_WAV: "/bundle/short.wav" }, read);
    expect(outcome.status).toBe("seeded");
    const profile = (await store.getActiveVoiceProfile("demo-patient-ideal"))!;
    expect(profile.source).toBe("deployment");
    expect(profile.consent.consentedBy).toBe("Jordan R.");
    expect(profile.sample.transcript).toBe("I made coffee and took the long way to work.");
    const audit = await store.listAudit({ patientId: "demo-patient-ideal" });
    expect(audit.find((a) => a.kind === "voice_enrolled")?.detail).toMatch(/deployment/);
  });

  it("is idempotent", async () => {
    const first = await seedDemoTwin(store, env, read);
    const second = await seedDemoTwin(store, env, read);
    expect(second).toEqual({ status: "already_seeded", profileId: (first as { profileId: string }).profileId });
  });

  it("reports a missing file instead of throwing", async () => {
    const outcome = await seedDemoTwin(store, { ...env, ANCHOR_DEMO_TWIN_WAV: "/nope.wav" }, read);
    expect(outcome.status).toBe("failed");
  });
});

describe("featured patient", () => {
  it("prefers the configured demo twin, then any enrolled twin, then the default", async () => {
    expect(await featuredPatientId(store, {})).toBe("demo-patient-complex");
    await seedDemoTwin(store, { ...env, ANCHOR_DEMO_TWIN_PATIENT: "demo-patient-bridge" }, read);
    expect(await featuredPatientId(store, {})).toBe("demo-patient-bridge");
    expect(await featuredPatientId(store, { ANCHOR_DEMO_TWIN_PATIENT: "demo-patient-edge" })).toBe("demo-patient-edge");
    expect(await featuredPatientId(store, { ANCHOR_DEMO_TWIN_PATIENT: "nobody" })).toBe("demo-patient-bridge");
  });
});

describe("call summary", () => {
  it("counts turns, the highest tier, escalations, and gate holds", () => {
    const s = summarizeCall(
      [
        { tier: 1, escalated: false, gated: false },
        { tier: 2, escalated: false, gated: true },
        { tier: 3, escalated: true, gated: false },
      ],
      1_000,
      75_400,
    );
    expect(s).toEqual({ durationSec: 74, turns: 3, highestTier: 3, escalations: 1, gateRequests: 1 });
  });

  it("handles a call with no turns", () => {
    expect(summarizeCall([], 5_000, 4_000)).toEqual({ durationSec: 0, turns: 0, highestTier: null, escalations: 0, gateRequests: 0 });
  });

  it("formats durations", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(74.9)).toBe("01:14");
    expect(formatDuration(3600)).toBe("60:00");
  });
});
