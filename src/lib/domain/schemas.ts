import { z } from "zod";

/**
 * Domain contracts for Anchor.
 *
 * Field shapes follow the data-store contracts established during the build:
 * RecoveryPlan (goals, known triggers, consent record, program match,
 * escalation history), ReferenceLibraryEntry, the Check-in Queue, and the
 * Audit Log (patientId, timestamp, transcript, gateDecision, escalationFlag).
 * Every value that crosses a store, adapter, or API boundary is parsed with
 * these schemas.
 */

export const TierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type Tier = z.infer<typeof TierSchema>;

export const CadenceSchema = z.enum(["daily", "every-other-day", "weekly"]);
export type Cadence = z.infer<typeof CadenceSchema>;

export const EscalationEventSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  at: z.string(),
  tier: TierSchema,
  reason: z.string(),
  summary: z.string(),
  transcriptExcerpt: z.string(),
  handoff: z.enum(["pending", "sent", "queued_locally", "failed_retrying"]),
  /** Only a clinician can set this. Nothing self-resolves. */
  resolved: z.boolean(),
  resolvedBy: z.string().optional(),
  resolvedAt: z.string().optional(),
  resolutionNote: z.string().optional(),
});
export type EscalationEvent = z.infer<typeof EscalationEventSchema>;

export const GoalSchema = z.object({
  id: z.string(),
  description: z.string(),
  measure: z.string(),
  missesThisWindow: z.number().int().nonnegative(),
});
export type Goal = z.infer<typeof GoalSchema>;

export const ConsentSchema = z.object({
  aiCheckins: z.boolean(),
  voiceClone: z.boolean(),
  voiceCloneScope: z.string(),
  recordedAt: z.string(),
});

export const ProgramMatchSchema = z.object({
  referenceId: z.string(),
  programName: z.string(),
  intakeDate: z.string(),
  intakeStatus: z.enum(["scheduled", "confirmed", "completed", "missed"]),
});

export const DiagnosisSchema = z.object({
  system: z.literal("ICD-10-CM"),
  code: z.string(),
  display: z.string(),
  source: z.enum(["recovery-plan", "fhir"]),
});

export const RecoveryPlanSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  displayName: z.string(),
  scenario: z.enum(["ideal", "complex", "edge", "bridge"]),
  scenarioBlurb: z.string(),
  diagnosis: DiagnosisSchema,
  clinician: z.object({ name: z.string(), role: z.string() }),
  goals: z.array(GoalSchema),
  knownTriggers: z.array(z.string()),
  copingPlanReferenceIds: z.array(z.string()),
  checkinCadence: CadenceSchema,
  consent: ConsentSchema,
  programMatch: ProgramMatchSchema.optional(),
  fhirBundle: z.string().optional(),
  escalationHistory: z.array(EscalationEventSchema),
  patternFlags: z.array(
    z.object({ id: z.string(), at: z.string(), summary: z.string(), approvedBy: z.string() }),
  ),
});
export type RecoveryPlan = z.infer<typeof RecoveryPlanSchema>;

export const ReferenceCategorySchema = z.enum([
  "coping_technique",
  "psychoeducation",
  "program_resource",
  "crisis_resource",
]);
export type ReferenceCategory = z.infer<typeof ReferenceCategorySchema>;

export const ReferenceLibraryEntrySchema = z.object({
  id: z.string(),
  category: ReferenceCategorySchema,
  title: z.string(),
  summary: z.string(),
  /** What Anchor may say aloud. Empty for clinician-only entries. */
  patientScript: z.string(),
  audience: z.enum(["patient", "clinician"]),
  keywords: z.array(z.string()),
  source: z.string(),
});
export type ReferenceLibraryEntry = z.infer<typeof ReferenceLibraryEntrySchema>;

export const CheckinQueueEntrySchema = z.object({
  id: z.string(),
  patientId: z.string(),
  dueAt: z.string(),
  cadence: CadenceSchema,
  status: z.enum(["due", "awaiting_approval", "call_placed", "done"]),
});
export type CheckinQueueEntry = z.infer<typeof CheckinQueueEntrySchema>;

export const SignalSchema = z.object({
  phrase: z.string(),
  tierHint: TierSchema,
  kind: z.enum(["on_track", "situational", "recurrence", "safety", "ambiguity", "pattern_history"]),
});
export type Signal = z.infer<typeof SignalSchema>;

export const TriageResultSchema = z.object({
  tier: TierSchema,
  label: z.string(),
  rationale: z.string(),
  signals: z.array(SignalSchema),
  topics: z.array(z.string()),
  patternSummary: z.string().optional(),
  source: z.enum(["deterministic", "model+deterministic"]),
  modelTier: TierSchema.optional(),
  deterministicTier: TierSchema,
});
export type TriageResult = z.infer<typeof TriageResultSchema>;

export const CheckinRecordSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  at: z.string(),
  direction: z.enum(["inbound", "outbound"]),
  utterance: z.string(),
  anchorReply: z.string(),
  triage: TriageResultSchema,
  referenceIds: z.array(z.string()),
  escalationId: z.string().optional(),
  gateRequestId: z.string().optional(),
});
export type CheckinRecord = z.infer<typeof CheckinRecordSchema>;

export const GatedActionSchema = z.enum(["place_checkin_call", "flag_pattern_for_clinician"]);
export type GatedAction = z.infer<typeof GatedActionSchema>;

export const GateRequestSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  action: GatedActionSchema,
  summary: z.string(),
  /** Draft content the clinician can edit before approving. */
  draft: z.string(),
  queueEntryId: z.string().optional(),
  checkinId: z.string().optional(),
  status: z.enum(["pending", "approved", "rejected"]),
  createdAt: z.string(),
  decidedAt: z.string().optional(),
  decidedBy: z.string().optional(),
  note: z.string().optional(),
});
export type GateRequest = z.infer<typeof GateRequestSchema>;

export const AuditKindSchema = z.enum([
  "checkin_received",
  "triage_scored",
  "escalation_committed",
  "handoff_sent",
  "handoff_queued_locally",
  "gate_requested",
  "gate_decision",
  "action_executed",
  "escalation_resolved",
  "demo_reset",
]);
export type AuditKind = z.infer<typeof AuditKindSchema>;

export const AuditEventSchema = z.object({
  id: z.string(),
  seq: z.number().int(),
  patientId: z.string(),
  timestamp: z.string(),
  kind: AuditKindSchema,
  detail: z.string(),
  transcript: z.string().optional(),
  gateDecision: z.enum(["approved", "rejected"]).optional(),
  escalationFlag: z.boolean(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

/** What the reasoning model must return. Anything else is rejected. */
export const ModelTriageSchema = z.object({
  tier: TierSchema,
  rationale: z.string().min(1).max(600),
  topics: z.array(z.string()).max(6).default([]),
});
export type ModelTriage = z.infer<typeof ModelTriageSchema>;

export const CheckinRequestSchema = z.object({
  patientId: z.string().min(1),
  direction: z.enum(["inbound", "outbound"]),
  utterance: z.string().trim().min(1, "Enter what the patient said.").max(2000),
});
export type CheckinRequest = z.infer<typeof CheckinRequestSchema>;
