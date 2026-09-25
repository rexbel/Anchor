import { aiConfig } from "@/lib/ai/config";

/**
 * The bounded task sent to the authenticated OpenClaw hook after an
 * escalation is committed to MongoDB. It carries a pointer and a summary,
 * never the patient record: the sandbox is compute, not custody.
 */
export type HandoffTask = {
  kind: "clinician_review";
  escalationId: string;
  patientId: string;
  tier: 3;
  summary: string;
  committedAt: string;
};

export type HandoffResult = "sent" | "queued_locally" | "failed_retrying";

export async function sendHandoff(
  task: HandoffTask,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<HandoffResult> {
  if (!aiConfig.openclawHookUrl) return "queued_locally";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 3000);
  try {
    const res = await (opts.fetchImpl ?? fetch)(aiConfig.openclawHookUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(aiConfig.openclawHookToken ? { Authorization: `Bearer ${aiConfig.openclawHookToken}` } : {}),
      },
      body: JSON.stringify(task),
    });
    return res.ok ? "sent" : "failed_retrying";
  } catch {
    return "failed_retrying";
  } finally {
    clearTimeout(timer);
  }
}
