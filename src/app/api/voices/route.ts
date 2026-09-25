import { handle } from "@/lib/http/respond";
import { getStore } from "@/lib/store";
import { ToolError } from "@/lib/tools";
import { CONSENT_STATEMENT, READING_PASSAGE, TWIN_LIMITS, enroll_twin_voice } from "@/lib/voice/twin";

/** GET /api/voices?patientId=… → the active Digital Twin profile (never the audio). */
export async function GET(request: Request) {
  return handle(async () => {
    const patientId = new URL(request.url).searchParams.get("patientId");
    if (!patientId) throw new ToolError("patientId is required.", 400);
    const profile = await (await getStore()).getActiveVoiceProfile(patientId);
    return { profile, consentStatement: CONSENT_STATEMENT, readingPassage: READING_PASSAGE, limits: TWIN_LIMITS };
  });
}

/** POST multipart: patientId, audio (16-bit PCM WAV), consentName, consent=true, transcript (optional, exact words spoken). */
export async function POST(request: Request) {
  return handle(async () => {
    const form = await request.formData().catch(() => {
      throw new ToolError("Send the recording as multipart form data.", 400);
    });
    const audio = form.get("audio");
    if (!(audio instanceof Blob)) throw new ToolError("Attach the voice recording.", 400);
    if (audio.size > TWIN_LIMITS.maxBytes) throw new ToolError("The recording is too large (max 4 MB).", 413);
    return enroll_twin_voice(await getStore(), {
      patientId: String(form.get("patientId") ?? ""),
      consentName: String(form.get("consentName") ?? ""),
      consent: form.get("consent") === "true",
      transcript: typeof form.get("transcript") === "string" ? String(form.get("transcript")) : undefined,
      wav: new Uint8Array(await audio.arrayBuffer()),
    });
  });
}
