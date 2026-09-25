import type {
  AuditEvent,
  CheckinQueueEntry,
  CheckinRecord,
  EscalationEvent,
  GateRequest,
  RecoveryPlan,
  ReferenceCategory,
  ReferenceLibraryEntry,
} from "@/lib/domain/schemas";

export type NewAuditEvent = Omit<AuditEvent, "id" | "seq" | "timestamp"> & { timestamp?: string };

/**
 * Storage contract. Two implementations: MemoryStore (seeded, zero setup) and
 * MongoStore (the durable system of record on the GB10). The reasoning
 * sandbox never holds patient state; it only ever receives bounded tasks.
 */
export interface AnchorStore {
  readonly kind: "memory" | "mongodb";

  // Read-only surfaces (ungated tools)
  listPlans(): Promise<RecoveryPlan[]>;
  getPlan(patientId: string): Promise<RecoveryPlan | null>;
  getLibrary(filter?: { categories?: ReferenceCategory[]; ids?: string[] }): Promise<ReferenceLibraryEntry[]>;
  getQueue(): Promise<CheckinQueueEntry[]>;
  listCheckins(patientId: string, limit?: number): Promise<CheckinRecord[]>;
  listAudit(filter?: { patientId?: string; limit?: number }): Promise<AuditEvent[]>;
  listGateRequests(filter?: { status?: GateRequest["status"] }): Promise<GateRequest[]>;
  getGateRequest(id: string): Promise<GateRequest | null>;

  // Writes. Plan mutations are only reachable through the escalation path or
  // behind an approved gate request.
  saveCheckin(record: CheckinRecord): Promise<void>;
  updateQueueEntry(id: string, status: CheckinQueueEntry["status"]): Promise<void>;
  appendEscalationEvent(patientId: string, event: EscalationEvent): Promise<void>;
  updateEscalation(
    patientId: string,
    escalationId: string,
    patch: Partial<Pick<EscalationEvent, "handoff" | "resolved" | "resolvedBy" | "resolvedAt" | "resolutionNote">>,
  ): Promise<EscalationEvent | null>;
  addPatternFlag(patientId: string, flag: RecoveryPlan["patternFlags"][number]): Promise<void>;
  updateIntakeStatus(
    patientId: string,
    status: NonNullable<RecoveryPlan["programMatch"]>["intakeStatus"],
  ): Promise<void>;
  createGateRequest(request: GateRequest): Promise<void>;
  updateGateRequest(id: string, patch: Partial<GateRequest>): Promise<GateRequest | null>;
  appendAudit(event: NewAuditEvent): Promise<AuditEvent>;

  reset(now?: Date): Promise<void>;
}
