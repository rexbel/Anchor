import type {
  AuditEvent,
  CheckinQueueEntry,
  CheckinRecord,
  EscalationEvent,
  GateRequest,
  RecoveryPlan,
  ReferenceLibraryEntry,
} from "@/lib/domain/schemas";
import {
  REFERENCE_LIBRARY,
  buildPriorCheckins,
  buildQueue,
  buildRecoveryPlans,
} from "@/lib/data/seed";
import { newId } from "@/lib/ids";
import type { AnchorStore, NewAuditEvent } from "./types";

type State = {
  plans: RecoveryPlan[];
  library: ReferenceLibraryEntry[];
  queue: CheckinQueueEntry[];
  checkins: CheckinRecord[];
  gate: GateRequest[];
  audit: AuditEvent[];
  seq: number;
};

function seed(now: Date): State {
  return structuredClone({
    plans: buildRecoveryPlans(now),
    library: REFERENCE_LIBRARY,
    queue: buildQueue(now),
    checkins: buildPriorCheckins(now),
    gate: [],
    audit: [],
    seq: 0,
  });
}

const clone = <T>(v: T): T => structuredClone(v);

export class MemoryStore implements AnchorStore {
  readonly kind = "memory" as const;
  private state: State;

  constructor(now: Date = new Date()) {
    this.state = seed(now);
  }

  async listPlans() {
    return clone(this.state.plans);
  }

  async getPlan(patientId: string) {
    const plan = this.state.plans.find((p) => p.patientId === patientId);
    return plan ? clone(plan) : null;
  }

  async getLibrary(filter?: { categories?: ReferenceLibraryEntry["category"][]; ids?: string[] }) {
    return clone(
      this.state.library.filter(
        (e) =>
          (!filter?.categories || filter.categories.includes(e.category)) &&
          (!filter?.ids || filter.ids.includes(e.id)),
      ),
    );
  }

  async getQueue() {
    return clone([...this.state.queue].sort((a, b) => a.dueAt.localeCompare(b.dueAt)));
  }

  async listCheckins(patientId: string, limit = 20) {
    return clone(
      this.state.checkins
        .filter((c) => c.patientId === patientId)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, limit),
    );
  }

  async listAudit(filter?: { patientId?: string; limit?: number }) {
    const rows = this.state.audit
      .filter((a) => !filter?.patientId || a.patientId === filter.patientId)
      .sort((a, b) => b.seq - a.seq);
    return clone(rows.slice(0, filter?.limit ?? 500));
  }

  async listGateRequests(filter?: { status?: GateRequest["status"] }) {
    return clone(
      this.state.gate
        .filter((g) => !filter?.status || g.status === filter.status)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }

  async getGateRequest(id: string) {
    const g = this.state.gate.find((r) => r.id === id);
    return g ? clone(g) : null;
  }

  async saveCheckin(record: CheckinRecord) {
    this.state.checkins.push(clone(record));
  }

  async updateQueueEntry(id: string, status: CheckinQueueEntry["status"]) {
    const q = this.state.queue.find((e) => e.id === id);
    if (q) q.status = status;
  }

  async appendEscalationEvent(patientId: string, event: EscalationEvent) {
    const plan = this.state.plans.find((p) => p.patientId === patientId);
    if (!plan) throw new Error(`No recovery plan for ${patientId}`);
    plan.escalationHistory.push(clone(event));
  }

  async updateEscalation(
    patientId: string,
    escalationId: string,
    patch: Partial<EscalationEvent>,
  ) {
    const plan = this.state.plans.find((p) => p.patientId === patientId);
    const ev = plan?.escalationHistory.find((e) => e.id === escalationId);
    if (!ev) return null;
    Object.assign(ev, patch);
    return clone(ev);
  }

  async addPatternFlag(patientId: string, flag: RecoveryPlan["patternFlags"][number]) {
    const plan = this.state.plans.find((p) => p.patientId === patientId);
    if (plan) plan.patternFlags.push(clone(flag));
  }

  async updateIntakeStatus(
    patientId: string,
    status: NonNullable<RecoveryPlan["programMatch"]>["intakeStatus"],
  ) {
    const plan = this.state.plans.find((p) => p.patientId === patientId);
    if (plan?.programMatch) plan.programMatch.intakeStatus = status;
  }

  async createGateRequest(request: GateRequest) {
    this.state.gate.push(clone(request));
  }

  async updateGateRequest(id: string, patch: Partial<GateRequest>) {
    const g = this.state.gate.find((r) => r.id === id);
    if (!g) return null;
    Object.assign(g, patch);
    return clone(g);
  }

  async appendAudit(event: NewAuditEvent) {
    this.state.seq += 1;
    const row: AuditEvent = {
      ...event,
      id: newId("aud"),
      seq: this.state.seq,
      timestamp: event.timestamp ?? new Date().toISOString(),
    };
    this.state.audit.push(row);
    return clone(row);
  }

  async reset(now: Date = new Date()) {
    this.state = seed(now);
  }
}
