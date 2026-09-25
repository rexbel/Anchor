import { chatJSON, type ModelOutcome } from "@/lib/ai/provider";
import { buildTriageMessages } from "@/lib/ai/prompts";
import { modelDisplayName } from "@/lib/ai/config";
import {
  ModelTriageSchema,
  type CheckinRecord,
  type CheckinRequest,
  type EscalationEvent,
  type GateRequest,
  type ModelTriage,
  type ReferenceLibraryEntry,
  type TriageResult,
} from "@/lib/domain/schemas";
import { newId } from "@/lib/ids";
import type { AnchorStore } from "@/lib/store";
import {
  escalate_to_clinician,
  get_bh_library,
  get_recovery_plan,
  request_gated_action,
} from "@/lib/tools";
import { combineTriage, scoreDeterministic } from "@/lib/triage/engine";
import { composeReply, selectReferences } from "@/lib/triage/responses";

export type Stage = {
  key: "read" | "classify" | "commit" | "route";
  label: string;
  detail: string;
  ms: number;
};

export type CheckinResult = {
  record: CheckinRecord;
  triage: TriageResult;
  reply: string;
  references: ReferenceLibraryEntry[];
  escalation?: EscalationEvent;
  gateRequest?: GateRequest;
  stages: Stage[];
  store: "memory" | "mongodb";
  model: {
    name: string;
    status: "live" | "skipped" | "fallback" | "not_configured";
    detail?: string;
  };
};

type Deps = {
  classify?: (messages: ReturnType<typeof buildTriageMessages>) => Promise<ModelOutcome<ModelTriage>>;
  escalate?: typeof escalate_to_clinician;
};

/**
 * One patient turn, end to end:
 * read plan and history, classify (deterministic floor plus local model),
 * commit to the store, then route: resolve in conversation (Tier 1),
 * request a gated pattern flag (Tier 2), or escalate with no gate (Tier 3).
 */
export async function runCheckin(store: AnchorStore, req: CheckinRequest, deps: Deps = {}): Promise<CheckinResult> {
  const stages: Stage[] = [];
  const time = async <T,>(fn: () => Promise<T>) => {
    const t0 = performance.now();
    const value = await fn();
    return { value, ms: Math.round(performance.now() - t0) };
  };

  // 1. Read (ungated tools)
  const read = await time(async () => {
    const plan = await get_recovery_plan(store, req.patientId);
    const [history, library] = await Promise.all([
      store.listCheckins(req.patientId, 10),
      get_bh_library(store),
    ]);
    return { plan, history, library };
  });
  const { plan, history, library } = read.value;
  stages.push({
    key: "read",
    label: "Read Recovery Plan",
    detail: `get_recovery_plan and get_bh_library: ${plural(plan.goals.length, "goal")}, ${plural(plan.knownTriggers.length, "known trigger")}, ${plural(history.length, "prior check-in")}.`,
    ms: read.ms,
  });

  await store.appendAudit({
    patientId: req.patientId,
    kind: "checkin_received",
    detail: `${req.direction === "inbound" ? "Inbound call" : "Outbound check-in"} turn received.`,
    transcript: req.utterance,
    escalationFlag: false,
  });

  // 2. Classify
  const classify = await time(async () => {
    const det = scoreDeterministic(req.utterance, history, plan);
    // An explicit Tier 3 signal can't be lowered by anything, so escalation
    // never waits on the model.
    if (det.tier === 3 && !det.unclassified) {
      return { triage: combineTriage(det, null), model: { status: "skipped" as const, detail: "Explicit Tier 3 signal. Escalation does not wait on the model." } };
    }
    const outcome = await (deps.classify ?? ((m) => chatJSON(m, ModelTriageSchema)))(
      buildTriageMessages(req.utterance, plan, history),
    );
    if (outcome.ok) {
      return { triage: combineTriage(det, outcome.data), model: { status: "live" as const, detail: `${outcome.ms} ms` } };
    }
    return {
      triage: combineTriage(det, null),
      model: {
        status: outcome.reason === "not_configured" ? ("not_configured" as const) : ("fallback" as const),
        detail: outcome.detail,
      },
    };
  });
  const { triage } = classify.value;
  const model = { name: modelDisplayName(), ...classify.value.model };
  stages.push({
    key: "classify",
    label: "Classify locally",
    detail:
      model.status === "live"
        ? `${model.name} on the GB10 plus the deterministic floor. Tier ${triage.tier}.`
        : model.status === "skipped"
          ? `Deterministic floor found an explicit Tier 3 signal. Model not consulted.`
          : `Deterministic rules only (${model.status === "not_configured" ? "no model configured" : "model unavailable"}). Tier ${triage.tier}.`,
    ms: classify.ms,
  });

  const references = selectReferences(triage, plan, library);
  const reply = composeReply(triage, references);
  const record: CheckinRecord = {
    id: newId("chk"),
    patientId: req.patientId,
    at: new Date().toISOString(),
    direction: req.direction,
    utterance: req.utterance,
    anchorReply: reply,
    triage,
    referenceIds: references.map((r) => r.id),
  };

  // 3. Commit, then 4. Route
  let escalation: EscalationEvent | undefined;
  let gateRequest: GateRequest | undefined;

  const commit = await time(async () => {
    await store.appendAudit({
      patientId: req.patientId,
      kind: "triage_scored",
      detail: `Tier ${triage.tier} (${triage.source}). ${triage.rationale}`,
      escalationFlag: triage.tier === 3,
    });
    if (triage.tier === 3) {
      const outcome = await (deps.escalate ?? escalate_to_clinician)(store, {
        patientId: req.patientId,
        triage,
        transcript: req.utterance,
      });
      escalation = outcome.event;
      record.escalationId = escalation.id;
    }
  });
  stages.push({
    key: "commit",
    label: store.kind === "mongodb" ? "Commit to MongoDB" : "Commit to store",
    detail:
      triage.tier === 3
        ? `Escalation ${escalation?.id} committed before any handoff. Transcript and audit rows written.`
        : "Transcript and triage written to the audit log.",

    ms: commit.ms,
  });

  const route = await time(async () => {
    if (triage.tier === 2) {
      gateRequest = await request_gated_action(store, {
        patientId: req.patientId,
        action: "flag_pattern_for_clinician",
        summary: `Pattern from ${req.direction === "inbound" ? "an inbound call" : "a scheduled check-in"}. Waiting for clinician approval.`,
        draft: triage.patternSummary ?? "Recurring issue across check-ins.",
        checkinId: record.id,
      });
    }
  });
  if (gateRequest) record.gateRequestId = gateRequest.id;
  await store.saveCheckin(record);
  stages.push({
    key: "route",
    label: triage.tier === 3 ? "Escalate to clinician" : triage.tier === 2 ? "Hold at OpenShell gate" : "Resolve in conversation",
    detail:
      triage.tier === 3
        ? `escalate_to_clinician() fired with no gate. OpenClaw handoff: ${escalation?.handoff.replace("_", " ")}.`
        : triage.tier === 2
          ? `flag_pattern_for_clinician() requested (${gateRequest?.id}). It runs only after a clinician approves.`
          : references.length
            ? `Surfaced ${references.map((r) => r.title).join(", ")} from the reference library.`
            : "Acknowledged. No reference content needed.",
    ms: route.ms,
  });

  return { record, triage, reply, references, escalation, gateRequest, stages, store: store.kind, model };
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
