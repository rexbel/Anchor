import { z } from "zod";

import { aiConfig } from "@/lib/ai/config";
import { readJson } from "@/lib/http/respond";

const TtsSchema = z.object({ text: z.string().trim().min(1).max(1200) });

/**
 * Proxies to a local Kokoro server (OpenAI-compatible /audio/speech, as served
 * by Kokoro-FastAPI). With no server configured or reachable, it answers with
 * JSON { fallback: "browser" } and the client uses its own speech synthesis.
 */
export async function POST(request: Request) {
  const parsed = TtsSchema.safeParse(await readJson(request).catch(() => null));
  if (!parsed.success) return Response.json({ error: "Text is required." }, { status: 400 });
  if (!aiConfig.ttsBaseUrl) {
    return Response.json({ fallback: "browser", reason: "ANCHOR_TTS_BASE_URL not set" });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${aiConfig.ttsBaseUrl}/audio/speech`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: aiConfig.ttsModel,
        voice: aiConfig.ttsVoice,
        input: parsed.data.text,
        response_format: "mp3",
      }),
    });
    if (!res.ok || !res.body) {
      return Response.json({ fallback: "browser", reason: `Kokoro returned ${res.status}` });
    }
    return new Response(res.body, { headers: { "Content-Type": res.headers.get("Content-Type") ?? "audio/mpeg" } });
  } catch {
    return Response.json({ fallback: "browser", reason: "Kokoro unreachable" });
  } finally {
    clearTimeout(timer);
  }
}
