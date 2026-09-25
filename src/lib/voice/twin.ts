import { aiConfig } from "@/lib/ai/config";
import {
  DEFAULT_SELF_HEARING,
  SelfHearingSchema,
  type SelfHearing,
  type VoiceProfile,
} from "@/lib/domain/schemas";
import { newId } from "@/lib/ids";
import type { AnchorStore } from "@/lib/store";
import { ToolError } from "@/lib/tools";
import { parseWav } from "./wav";

/**
 * Digital Twin voice: the patient records a reference sample and explicitly
 * consents to it being cloned. The sample is the speaker reference for the
 * cloning TTS (XTTS-v2 on the GB10). Synthetic demo only.
 */

export const TWIN_LIMITS = { minSec: 5, maxSec: 60, maxBytes: 4 * 1024 * 1024 };

/**
 * What the patient reads when recording. Kept to about 8 seconds so it also
 * suits Sesame CSM-1B, which conditions on 3 to 10 seconds of reference audio
 * plus its exact transcript.
 */
export const READING_PASSAGE =
  "Most mornings I make coffee, check the weather, and take the long way to work. When the day gets hard, I slow down and take a breath.";

export const CONSENT_STATEMENT =
  "I am recording my own voice, and I agree that Anchor may use this recording to create a synthetic copy of my voice for my check-ins. I can withdraw this consent at any time, which deletes the recording.";

export async function enroll_twin_voice(
  store: AnchorStore,
  input: {
    patientId: string;
    wav: Uint8Array;
    consentName: string;
    consent: boolean;
    transcript?: string;
    source?: VoiceProfile["source"];
    minSec?: number;
  },
  now = new Date(),
): Promise<VoiceProfile> {
  const consentName = input.consentName.trim();
  if (!input.consent || !consentName) {
    throw new ToolError("Explicit consent and the patient's typed name are required to create a Digital Twin voice.", 403);
  }
  if (!(await store.getPlan(input.patientId))) throw new ToolError("Unknown patient.", 404);
  if (input.wav.byteLength > TWIN_LIMITS.maxBytes) {
    throw new ToolError(`The recording is too large (max ${TWIN_LIMITS.maxBytes / 1024 / 1024} MB).`, 413);
  }
  const info = parseWav(input.wav);
  if (!info) throw new ToolError("The recording must be a PCM WAV file.", 400);
  const minSec = input.minSec ?? TWIN_LIMITS.minSec;
  if (info.durationSec < minSec || info.durationSec > TWIN_LIMITS.maxSec) {
    throw new ToolError(
      `The recording must be ${minSec} to ${TWIN_LIMITS.maxSec} seconds long (got ${info.durationSec.toFixed(1)} s).`,
      400,
    );
  }

  // One active twin per patient: re-enrolling replaces (and deletes) the old sample.
  const previous = await store.getActiveVoiceProfile(input.patientId);
  if (previous) await store.revokeVoiceProfile(previous.id, now.toISOString());

  const transcript = input.transcript?.trim().replace(/\s+/g, " ").slice(0, 2000) || undefined;
  const profile: VoiceProfile = {
    id: newId("voice"),
    patientId: input.patientId,
    status: "active",
    source: input.source ?? "enrolled",
    consent: { consentedBy: consentName, statement: CONSENT_STATEMENT, attestedAt: now.toISOString() },
    sample: {
      mimeType: "audio/wav",
      bytes: input.wav.byteLength,
      durationSec: Math.round(info.durationSec * 10) / 10,
      sampleRate: info.sampleRate,
      transcript,
    },
    selfHearing: { ...DEFAULT_SELF_HEARING },
    createdAt: now.toISOString(),
  };
  await store.saveVoiceProfile(profile, input.wav);
  await store.appendAudit({
    patientId: input.patientId,
    kind: "voice_enrolled",
    detail: `Digital Twin voice ${profile.source === "deployment" ? "seeded from the deployment's consented reference" : "enrolled"} (${profile.id}, ${profile.sample.durationSec} s sample${transcript ? ", with transcript" : ""}). Consent attested by "${consentName}".${previous ? ` Replaced ${previous.id}; its sample was deleted.` : ""}`,
    escalationFlag: false,
  });
  return profile;
}

export async function update_self_hearing(store: AnchorStore, id: string, patch: unknown): Promise<VoiceProfile> {
  const current = await store.getVoiceProfile(id);
  if (!current || current.status !== "active") throw new ToolError("No active Digital Twin voice with that id.", 404);
  const selfHearing: SelfHearing = SelfHearingSchema.parse({ ...current.selfHearing, ...(patch as object) });
  const updated = await store.updateVoiceProfile(id, { selfHearing });
  await store.appendAudit({
    patientId: current.patientId,
    kind: "voice_updated",
    detail: `Self-hearing ${selfHearing.enabled ? "on" : "off"} (low +${selfHearing.lowShelfDb} dB, high ${selfHearing.highShelfDb} dB, reverb ${Math.round(selfHearing.reverbMix * 100)}%) for ${id}.`,
    escalationFlag: false,
  });
  return updated!;
}

export async function revoke_twin_voice(store: AnchorStore, id: string, now = new Date()): Promise<VoiceProfile> {
  const current = await store.getVoiceProfile(id);
  if (!current) throw new ToolError("No Digital Twin voice with that id.", 404);
  if (current.status === "revoked") return current;
  const revoked = await store.revokeVoiceProfile(id, now.toISOString());
  await store.appendAudit({
    patientId: current.patientId,
    kind: "voice_revoked",
    detail: `Consent withdrawn for ${id}. The voice sample was deleted; check-ins fall back to the standard voice.`,
    escalationFlag: false,
  });
  return revoked!;
}

/* ---------- Speech: twin → Kokoro → browser ---------- */

export type VoiceEngine = "twin" | "kokoro" | "browser";
export type SpeechResult =
  | { engine: "twin" | "kokoro"; audio: Response }
  | { engine: "browser"; reason: string };

type Fetch = typeof fetch;

async function timed(fetchImpl: Fetch, url: string, init: RequestInit, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const isAudio = (res: Response) => {
  const type = res.headers.get("Content-Type") ?? "";
  return res.ok && !!res.body && (type === "" || type.startsWith("audio/"));
};

export async function synthesize(
  store: AnchorStore,
  input: { text: string; patientId?: string },
  deps: { fetch?: Fetch; config?: Pick<typeof aiConfig, "twinTtsUrl" | "ttsBaseUrl" | "ttsModel" | "ttsVoice"> } = {},
): Promise<SpeechResult> {
  const fetchImpl = deps.fetch ?? fetch;
  const cfg = deps.config ?? aiConfig;
  const reasons: string[] = [];

  if (input.patientId) {
    const profile = await store.getActiveVoiceProfile(input.patientId);
    if (!profile) reasons.push("no Digital Twin voice enrolled");
    else if (!cfg.twinTtsUrl) reasons.push("ANCHOR_TWIN_TTS_URL not set");
    else {
      const sample = await store.getVoiceSample(profile.id);
      if (sample) {
        try {
          const res = await timed(
            fetchImpl,
            cfg.twinTtsUrl,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text: input.text,
                language: "en",
                speaker_wav: Buffer.from(sample).toString("base64"),
                ...(profile.sample.transcript ? { speaker_text: profile.sample.transcript } : {}),
              }),
            },
            20000,
          );
          if (isAudio(res)) return { engine: "twin", audio: res };
          reasons.push(`twin TTS returned ${res.status}`);
        } catch {
          reasons.push("twin TTS unreachable");
        }
      }
    }
  }

  if (cfg.ttsBaseUrl) {
    try {
      const res = await timed(
        fetchImpl,
        `${cfg.ttsBaseUrl}/audio/speech`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: cfg.ttsModel, voice: cfg.ttsVoice, input: input.text, response_format: "mp3" }),
        },
        15000,
      );
      if (isAudio(res)) return { engine: "kokoro", audio: res };
      reasons.push(`Kokoro returned ${res.status}`);
    } catch {
      reasons.push("Kokoro unreachable");
    }
  } else {
    reasons.push("ANCHOR_TTS_BASE_URL not set");
  }
  return { engine: "browser", reason: reasons.join("; ") };
}
