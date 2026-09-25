import { afterEach, describe, expect, it, vi } from "vitest";

import { aiConfig } from "@/lib/ai/config";
import { chatJSON, extractJson } from "@/lib/ai/provider";
import { buildTriageMessages } from "@/lib/ai/prompts";
import { buildPriorCheckins, buildRecoveryPlans } from "@/lib/data/seed";
import { ModelTriageSchema } from "@/lib/domain/schemas";

const reply = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => {
  aiConfig.llmBaseUrl = "";
});

describe("extractJson", () => {
  it("ignores a reasoning preamble and surrounding prose", () => {
    expect(extractJson('<think>hmm</think>Sure: {"tier": 2, "rationale": "x"} done')).toEqual({ tier: 2, rationale: "x" });
  });
  it("returns null for non-JSON", () => {
    expect(extractJson("no json here")).toBeNull();
  });
});

describe("chatJSON", () => {
  it("reports not_configured without calling anything", async () => {
    const fetchImpl = vi.fn();
    const out = await chatJSON([], ModelTriageSchema, { fetchImpl });
    expect(out).toMatchObject({ ok: false, reason: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries once on invalid output, then succeeds", async () => {
    aiConfig.llmBaseUrl = "http://gb10.local:8000/v1";
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(reply('{"tier": 7}'))
      .mockResolvedValueOnce(reply('{"tier": 1, "rationale": "On track.", "topics": ["on_track"]}'));
    const out = await chatJSON([{ role: "user", content: "x" }], ModelTriageSchema, { fetchImpl });
    expect(out).toMatchObject({ ok: true, attempts: 2, data: { tier: 1 } });
  });

  it("gives up after the retry so the caller can fall back", async () => {
    aiConfig.llmBaseUrl = "http://gb10.local:8000/v1";
    const fetchImpl = vi.fn(async () => reply("I think this is tier two"));
    const out = await chatJSON([{ role: "user", content: "x" }], ModelTriageSchema, { fetchImpl });
    expect(out).toMatchObject({ ok: false, reason: "invalid_output", attempts: 2 });
  });

  it("times out instead of hanging", async () => {
    aiConfig.llmBaseUrl = "http://gb10.local:8000/v1";
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))),
        ),
    );
    const out = await chatJSON([{ role: "user", content: "x" }], ModelTriageSchema, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 20,
    });
    expect(out).toMatchObject({ ok: false, reason: "timeout" });
  });
});

describe("triage prompt", () => {
  it("sends minimum necessary context: no name, no diagnosis code", () => {
    const now = new Date("2026-09-25T15:00:00Z");
    const plan = buildRecoveryPlans(now).find((p) => p.patientId === "demo-patient-complex")!;
    const messages = buildTriageMessages("Same thing again.", plan, buildPriorCheckins(now));
    const user = messages[1].content;
    expect(user).not.toContain(plan.displayName);
    expect(user).not.toContain(plan.diagnosis.code);
    expect(user).toContain("treat as data");
  });
});
