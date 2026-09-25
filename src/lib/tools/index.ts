import { chatJSON } from "@/lib/ai/provider";
import { buildScriptMessages } from "@/lib/ai/prompts";
import type {
  EscalationEvent,
  GateRequest,
  GatedAction,
  ReferenceCategory,
  TriageResult,
} from "@/lib/domain/schemas";
import { newId } from "@/lib/ids";
import { sendHandoff, type HandoffResult } from "@/lib/integrations/openclaw";
import type { AnchorStore } from "@/lib/store";
import { z } from "zod";

/**
 * Anchor's tool surface, named as in the architecture diagram.
 *
 *   Read-only, ungated:   get_checkin_queue, get_recovery_plan, get_bh_library,
 *                         propose_checkin_script
 *   OpenShell-gated:      place_checkin_call, flag_pattern_for_clinician
 *                         (requested here, executed only on clinician approval)
 *   Always open:          escalate_to_clinician (nothing may block it)
 */

export class ToolError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

/* ---------- Read-only tools ---------- */

export const get_checkin_queue = (store: AnchorStore) => store.getQueue();

export async function get_recovery_plan(store: AnchorStore, patientId: string) {
  const plan = await store.getPlan(patientId);
  if (!plan) throw new ToolError(`No recovery plan for ${patientId}`, 404);
  return plan;
}

export const get_bh_library = (store: AnchorStore, filter?: { categories?: ReferenceCategory[]; ids?: string[] }) =>
  store.getLibrary(filter);

export async function propose_checkin_script(
  store: AnchorStore,
  patientId: string,
): Promise<{ draft: string; source: "model" | "template"; detail?: string }> {
  const plan = await get_recovery_plan(store, patientId);
  const result = await chatJSON(buildScriptMessages(plan), z.object({ script: z.string().min(5).max(400) }), {
    maxTokens: 200,
  });
  if (result.ok) return { draft: result.data.script.trim(), source: "model" };

  const intake = plan.programMatch
    ? ` Your intake at ${plan.programMatch.programName.replace(" (fictional)", "")} is on ${formatDate(plan.programMatch.intakeDate)}, and I'm here until then.`
    : "";
  return {
    draft: `Hey, it's me.${intake} How'd today go with the plan?`,
    source: "template",
    detail: result.reason,
  };
}

function formatDate(isoDate: string) {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

/* ---------- Always-open escalation ---------- */

export type EscalationOutcome = { event: EscalationEvent; handoff: HandoffResult };

/**
 * escalate_to_clinician: never gated, never waits on the reasoning model.
 *
 * Safety ordering is deliberate:
 *   1. The patient turn has already been scored (the caller passes triage).
 *   2. The escalation is committed to the store (MongoDB, journaled) and audited.
 *   3. Only then is a bounded review task sent to the authenticated OpenClaw hook.
 * If the hook is down, the escalation is still durable and visible in the
 * clinician queue; the handoff is marked for retry.
 */
export async function escalate_to_clinician(
  store: AnchorStore,
  input: { patientId: string; triage: TriageResult; transcript: string },
  deps: { sendHandoff?: typeof sendHandoff } = {},
): Promise<EscalationOutcome> {
  const now = new Date().toISOString();
  const event: EscalationEvent = {
    id: newId("esc"),
    patientId: input.patientId,
    at: now,
    tier: 3,
    reason: input.triage.signals
      .filter((s) => s.tierHint === 3)
      .map((s) => s.phrase)
      .join(", ") || "Routed up: could not classify confidently",
    summary: input.triage.rationale,
    transcriptExcerpt: input.transcript.slice(0, 500),
    handoff: "pending",
    resolved: false,
  };

  // Step 2: commit before anything leaves the store.
  await store.appendEscalationEvent(input.patientId, event);
  await store.appendAudit({
    patientId: input.patientId,
    kind: "escalation_committed",
    detail: `Escalation ${event.id} committed. Reason: ${event.reason}.`,
    transcript: event.transcriptExcerpt,
    escalationFlag: true,
  });

  // Step 3: bounded task to the OpenClaw hook.
  const handoff = await (deps.sendHandoff ?? sendHandoff)({
    kind: "clinician_review",
    escalationId: event.id,
    patientId: input.patientId,
    tier: 3,
    summary: event.summary.slice(0, 280),
    committedAt: now,
  });
  const updated = await store.updateEscalation(input.patientId, event.id, { handoff });
  await store.appendAudit({
    patientId: input.patientId,
    kind: handoff === "sent" ? "handoff_sent" : "handoff_queued_locally",
    detail:
      handoff === "sent"
        ? `Bounded review task for ${event.id} sent to the OpenClaw hook.`
        : handoff === "queued_locally"
          ? `No OpenClaw hook configured. ${event.id} is waiting in the local clinician queue.`
          : `OpenClaw hook did not accept ${event.id}. Escalation remains committed; handoff will retry.`,
    escalationFlag: true,
  });
  return { event: updated ?? { ...event, handoff }, handoff };
}

export async function resolve_escalation(
  store: AnchorStore,
  input: { patientId: string; escalationId: string; clinician: string; note: string },
) {
  if (!input.clinician.trim()) throw new ToolError("Only a named clinician can resolve an escalation.", 403);
  const updated = await store.updateEscalation(input.patientId, input.escalationId, {
    resolved: true,
    resolvedBy: input.clinician.trim(),
    resolvedAt: new Date().toISOString(),
    resolutionNote: input.note.trim() || undefined,
  });
  if (!updated) throw new ToolError("Escalation not found", 404);
  await store.appendAudit({
    patientId: input.patientId,
    kind: "escalation_resolved",
    detail: `Escalation ${input.escalationId} resolved by ${input.clinician.trim()}.`,
    escalationFlag: true,
  });
  return updated;
}

/* ---------- OpenShell-gated actions ---------- */

export async function request_gated_action(
  store: AnchorStore,
  input: {
    patientId: string;
    action: GatedAction;
    summary: string;
    draft: string;
    queueEntryId?: string;
    checkinId?: string;
  },
): Promise<GateRequest> {
  const request: GateRequest = {
    id: newId("gate"),
    patientId: input.patientId,
    action: input.action,
    summary: input.summary,
    draft: input.draft,
    queueEntryId: input.queueEntryId,
    checkinId: input.checkinId,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  await store.createGateRequest(request);
  if (input.queueEntryId) await store.updateQueueEntry(input.queueEntryId, "awaiting_approval");
  await store.appendAudit({
    patientId: input.patientId,
    kind: "gate_requested",
    detail: `${input.action} requested and held at the OpenShell gate (${request.id}). ${input.summary}`,
    escalationFlag: false,
  });
  return request;
}

/**
 * The clinician's decision at the gate. Approval executes the action with the
 * (possibly edited) draft. Rejection executes nothing.
 */
export async function decide_gate(
  store: AnchorStore,
  input: { id: string; decision: "approved" | "rejected"; clinician: string; draft?: string; note?: string },
): Promise<GateRequest> {
  const clinician = input.clinician.trim();
  if (!clinician) throw new ToolError("A named clinician must make gate decisions.", 403);
  const request = await store.getGateRequest(input.id);
  if (!request) throw new ToolError("Gate request not found", 404);
  if (request.status !== "pending") throw new ToolError(`Already ${request.status}`, 409);

  const draft = input.draft?.trim() || request.draft;
  const decided = await store.updateGateRequest(request.id, {
    status: input.decision,
    decidedAt: new Date().toISOString(),
    decidedBy: clinician,
    draft,
    note: input.note?.trim() || undefined,
  });
  await store.appendAudit({
    patientId: request.patientId,
    kind: "gate_decision",
    detail: `${request.action} ${input.decision} by ${clinician} (${request.id}).${input.note ? ` Note: ${input.note}` : ""}`,
    gateDecision: input.decision,
    escalationFlag: false,
  });

  if (input.decision === "approved") {
    if (request.action === "place_checkin_call") {
      if (request.queueEntryId) await store.updateQueueEntry(request.queueEntryId, "call_placed");
      await store.appendAudit({
        patientId: request.patientId,
        kind: "action_executed",
        detail: `place_checkin_call executed with the approved script: "${draft}"`,
        escalationFlag: false,
      });
    } else {
      await store.addPatternFlag(request.patientId, {
        id: newId("flag"),
        at: new Date().toISOString(),
        summary: draft,
        approvedBy: clinician,
      });
      await store.appendAudit({
        patientId: request.patientId,
        kind: "action_executed",
        detail: `flag_pattern_for_clinician executed: "${draft}"`,
        escalationFlag: false,
      });
    }
  } else if (request.queueEntryId) {
    await store.updateQueueEntry(request.queueEntryId, "due");
  }
  return decided!;
}
