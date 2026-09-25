import type { z } from "zod";

import { aiConfig } from "./config";

export type ChatMessage = { role: "system" | "user"; content: string };

export type ModelOutcome<T> =
  | { ok: true; data: T; attempts: number; ms: number }
  | { ok: false; reason: "not_configured" | "timeout" | "http_error" | "invalid_output"; detail: string; attempts: number; ms: number };

/**
 * Minimal client for an OpenAI-compatible chat completions endpoint (vLLM,
 * Ollama, llama.cpp server, or NIM running on the GB10). Prompt construction
 * lives elsewhere; this file only transports messages and validates output.
 *
 * Contract: short timeout, one retry on invalid output, never throws. The
 * caller falls back to deterministic logic on any failure.
 */
export async function chatJSON<T>(
  messages: ChatMessage[],
  schema: z.ZodType<T>,
  opts: { timeoutMs?: number; maxTokens?: number; fetchImpl?: typeof fetch } = {},
): Promise<ModelOutcome<T>> {
  const started = Date.now();
  if (!aiConfig.llmBaseUrl) {
    return { ok: false, reason: "not_configured", detail: "ANCHOR_LLM_BASE_URL is not set", attempts: 0, ms: 0 };
  }
  const doFetch = opts.fetchImpl ?? fetch;
  let lastDetail = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? aiConfig.llmTimeoutMs);
    try {
      const res = await doFetch(`${aiConfig.llmBaseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(aiConfig.llmApiKey ? { Authorization: `Bearer ${aiConfig.llmApiKey}` } : {}),
        },
        body: JSON.stringify({
          model: aiConfig.llmModel,
          messages:
            attempt === 1
              ? messages
              : [
                  ...messages,
                  {
                    role: "user",
                    content: "Your last reply was not valid. Reply with only the JSON object described above.",
                  },
                ],
          temperature: 0,
          max_tokens: opts.maxTokens ?? 400,
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) {
        return {
          ok: false,
          reason: "http_error",
          detail: `HTTP ${res.status}`,
          attempts: attempt,
          ms: Date.now() - started,
        };
      }
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const raw = body.choices?.[0]?.message?.content ?? "";
      const parsed = schema.safeParse(extractJson(raw));
      if (parsed.success) return { ok: true, data: parsed.data, attempts: attempt, ms: Date.now() - started };
      lastDetail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      return {
        ok: false,
        reason: aborted ? "timeout" : "http_error",
        detail: aborted ? "Model did not answer in time" : String(err).slice(0, 200),
        attempts: attempt,
        ms: Date.now() - started,
      };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, reason: "invalid_output", detail: lastDetail || "unparseable", attempts: 2, ms: Date.now() - started };
}

/** Pull the first JSON object out of a reply, ignoring any reasoning preamble. */
export function extractJson(raw: string): unknown {
  const withoutThinking = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const start = withoutThinking.indexOf("{");
  const end = withoutThinking.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(withoutThinking.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function pingModel(timeoutMs = 1500): Promise<"reachable" | "unreachable" | "not_configured"> {
  if (!aiConfig.llmBaseUrl) return "not_configured";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${aiConfig.llmBaseUrl}/models`, {
      signal: controller.signal,
      headers: aiConfig.llmApiKey ? { Authorization: `Bearer ${aiConfig.llmApiKey}` } : {},
    });
    return res.ok ? "reachable" : "unreachable";
  } catch {
    return "unreachable";
  } finally {
    clearTimeout(timer);
  }
}
