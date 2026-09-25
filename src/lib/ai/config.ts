/**
 * Adapter configuration. Everything is optional: with no env vars set, Anchor
 * runs fully on deterministic logic and seeded data. On the GB10, point these
 * at the local servers (vLLM or Ollama for the reasoning model, Kokoro for
 * voice, the OpenClaw hook for clinician handoff).
 */
export const aiConfig = {
  llmBaseUrl: process.env.ANCHOR_LLM_BASE_URL?.replace(/\/$/, "") ?? "",
  llmModel: process.env.ANCHOR_LLM_MODEL ?? "qwen-3.8-27b",
  llmApiKey: process.env.ANCHOR_LLM_API_KEY ?? "",
  llmTimeoutMs: Number(process.env.ANCHOR_LLM_TIMEOUT_MS ?? 12000),

  ttsBaseUrl: process.env.ANCHOR_TTS_BASE_URL?.replace(/\/$/, "") ?? "",
  ttsModel: process.env.ANCHOR_TTS_MODEL ?? "kokoro",
  ttsVoice: process.env.ANCHOR_TTS_VOICE ?? "af_heart",

  /** Voice-cloning TTS (e.g. XTTS-v2 behind a small shim). See README for the contract. */
  twinTtsUrl: process.env.ANCHOR_TWIN_TTS_URL?.replace(/\/$/, "") ?? "",

  openclawHookUrl: process.env.OPENCLAW_HOOK_URL ?? "",
  openclawHookToken: process.env.OPENCLAW_HOOK_TOKEN ?? "",
};

export const MODEL_DISPLAY_NAMES: Record<string, string> = {
  "qwen-3.8-27b": "Qwen 3.8 27B",
};

export function modelDisplayName(id = aiConfig.llmModel) {
  return MODEL_DISPLAY_NAMES[id] ?? id;
}
