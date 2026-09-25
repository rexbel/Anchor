import { z } from "zod";

import { readJson } from "@/lib/http/respond";
import { getStore } from "@/lib/store";
import { synthesize } from "@/lib/voice/twin";

const TtsSchema = z.object({
  text: z.string().trim().min(1).max(1200),
  patientId: z.string().min(1).optional(),
});

/**
 * Speech in the best voice available, in order: the patient's Digital Twin
 * (cloning TTS, ANCHOR_TWIN_TTS_URL), Kokoro (ANCHOR_TTS_BASE_URL), then the
 * browser's own speech synthesis. The engine used is named in the
 * X-Anchor-Voice-Engine header; the browser fallback answers with JSON.
 */
export async function POST(request: Request) {
  const parsed = TtsSchema.safeParse(await readJson(request).catch(() => null));
  if (!parsed.success) return Response.json({ error: "Text is required." }, { status: 400 });
  const result = await synthesize(await getStore(), parsed.data);
  if (result.engine === "browser") {
    return Response.json(
      { fallback: "browser", reason: result.reason },
      { headers: { "X-Anchor-Voice-Engine": "browser" } },
    );
  }
  return new Response(result.audio.body, {
    headers: {
      "Content-Type": result.audio.headers.get("Content-Type") || "audio/mpeg",
      "X-Anchor-Voice-Engine": result.engine,
    },
  });
}
