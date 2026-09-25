import { readFile } from "node:fs/promises";

import type { AnchorStore } from "@/lib/store/types";
import { enroll_twin_voice } from "./twin";

/**
 * Demo twin: seeds a Digital Twin from a consented reference that is mounted
 * on the box (for example the hackathon T7 bundle's self_ref.wav and
 * self_ref.txt), so the live-call demo speaks in a cloned voice without an
 * in-app enrollment. It never seeds without a named consenting person.
 *
 *   ANCHOR_DEMO_TWIN_WAV            path to a 16-bit PCM WAV (3 to 60 s)
 *   ANCHOR_DEMO_TWIN_TEXT           path to the exact transcript of that WAV
 *   ANCHOR_DEMO_TWIN_PATIENT        which seeded patient gets the voice
 *   ANCHOR_DEMO_TWIN_CONSENTED_BY   the voice owner's name, who consented
 */
export type DemoTwinEnv = {
  ANCHOR_DEMO_TWIN_WAV?: string;
  ANCHOR_DEMO_TWIN_TEXT?: string;
  ANCHOR_DEMO_TWIN_PATIENT?: string;
  ANCHOR_DEMO_TWIN_CONSENTED_BY?: string;
};

export type DemoTwinOutcome =
  | { status: "not_configured" }
  | { status: "missing_consent" }
  | { status: "already_seeded"; profileId: string }
  | { status: "seeded"; profileId: string }
  | { status: "failed"; reason: string };

type Reader = (path: string) => Promise<Uint8Array>;

export async function seedDemoTwin(
  store: AnchorStore,
  env: DemoTwinEnv = process.env as DemoTwinEnv,
  read: Reader = async (p) => new Uint8Array(await readFile(p)),
): Promise<DemoTwinOutcome> {
  const wavPath = env.ANCHOR_DEMO_TWIN_WAV?.trim();
  const patientId = env.ANCHOR_DEMO_TWIN_PATIENT?.trim();
  if (!wavPath || !patientId) return { status: "not_configured" };
  const consentedBy = env.ANCHOR_DEMO_TWIN_CONSENTED_BY?.trim();
  if (!consentedBy) return { status: "missing_consent" };

  const existing = await store.getActiveVoiceProfile(patientId);
  if (existing) return { status: "already_seeded", profileId: existing.id };

  try {
    const wav = await read(wavPath);
    const textPath = env.ANCHOR_DEMO_TWIN_TEXT?.trim();
    const transcript = textPath ? new TextDecoder().decode(await read(textPath)).trim() : undefined;
    const profile = await enroll_twin_voice(store, {
      patientId,
      wav,
      transcript,
      consentName: consentedBy,
      consent: true,
      source: "deployment",
      minSec: 3,
    });
    return { status: "seeded", profileId: profile.id };
  } catch (err) {
    return { status: "failed", reason: err instanceof Error ? err.message : String(err) };
  }
}

export function describeDemoTwin(outcome: DemoTwinOutcome): string | null {
  switch (outcome.status) {
    case "missing_consent":
      return "ANCHOR_DEMO_TWIN_WAV is set but ANCHOR_DEMO_TWIN_CONSENTED_BY is not. The demo voice was not seeded.";
    case "failed":
      return `The demo voice could not be seeded: ${outcome.reason}`;
    default:
      return null;
  }
}
