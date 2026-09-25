import { MongoClient, type Collection, type Db, type Document } from "mongodb";

import {
  AuditEventSchema,
  CheckinQueueEntrySchema,
  CheckinRecordSchema,
  GateRequestSchema,
  RecoveryPlanSchema,
  ReferenceLibraryEntrySchema,
  type AuditEvent,
  type CheckinQueueEntry,
  type CheckinRecord,
  type EscalationEvent,
  type GateRequest,
  type RecoveryPlan,
  type ReferenceLibraryEntry,
} from "@/lib/domain/schemas";
import {
  REFERENCE_LIBRARY,
  buildPriorCheckins,
  buildQueue,
  buildRecoveryPlans,
} from "@/lib/data/seed";
import { newId } from "@/lib/ids";
import type { AnchorStore, NewAuditEvent } from "./types";

/**
 * MongoDB is Anchor's durable system of record: Recovery Plans, the
 * Behavioral Health Reference Library, the Check-in Queue, check-in
 * transcripts, gate requests, and the Audit Log all live here, on the GB10,
 * outside the agent sandbox. Collections are seeded on first connect.
 */

type WithId<T> = T & { _id: string };

function strip<T>(doc: Document | null): T | null {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  void _id;
  return rest as T;
}

export class MongoStore implements AnchorStore {
  readonly kind = "mongodb" as const;
  private db: Db;
  private client: MongoClient;

  private constructor(client: MongoClient, db: Db) {
    this.client = client;
    this.db = db;
  }

  async close() {
    await this.client.close();
  }

  /** Test helper: remove the whole database. */
  async dropDatabase() {
    await this.db.dropDatabase();
  }

  static async connect(uri: string, dbName: string, timeoutMs = 2500): Promise<MongoStore> {
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: timeoutMs,
      connectTimeoutMS: timeoutMs,
      // Optional fields left undefined must be omitted, not stored as null,
      // or the Zod schemas reject them on read.
      ignoreUndefined: true,
    });
    await client.connect();
    const store = new MongoStore(client, client.db(dbName));
    await store.ensureSeeded();
    return store;
  }

  private col<T extends Document>(name: string): Collection<WithId<T>> {
    return this.db.collection<WithId<T>>(name);
  }

  private get plans() {
    return this.col<RecoveryPlan>("recovery_plans");
  }
  private get library() {
    return this.col<ReferenceLibraryEntry>("reference_library");
  }
  private get queue() {
    return this.col<CheckinQueueEntry>("checkin_queue");
  }
  private get checkins() {
    return this.col<CheckinRecord>("checkins");
  }
  private get gate() {
    return this.col<GateRequest>("gate_requests");
  }
  private get audit() {
    return this.col<AuditEvent>("audit_log");
  }
  private get counters() {
    return this.db.collection<{ _id: string; value: number }>("counters");
  }

  private async ensureSeeded() {
    if ((await this.plans.estimatedDocumentCount()) === 0) await this.seed(new Date());
    await Promise.all([
      this.plans.createIndex({ patientId: 1 }, { unique: true }),
      this.checkins.createIndex({ patientId: 1, at: -1 }),
      this.audit.createIndex({ patientId: 1, seq: -1 }),
      this.gate.createIndex({ status: 1, createdAt: -1 }),
    ]);
  }

  private async seed(now: Date) {
    const plans = buildRecoveryPlans(now);
    await this.plans.insertMany(plans.map((p) => ({ ...p, _id: p.id })));
    await this.library.insertMany(REFERENCE_LIBRARY.map((e) => ({ ...e, _id: e.id })));
    await this.queue.insertMany(buildQueue(now).map((q) => ({ ...q, _id: q.id })));
    await this.checkins.insertMany(buildPriorCheckins(now).map((c) => ({ ...c, _id: c.id })));
    await this.counters.updateOne({ _id: "audit" }, { $set: { value: 0 } }, { upsert: true });
  }

  async listPlans() {
    const docs = await this.plans.find().sort({ id: 1 }).toArray();
    return docs.map((d) => RecoveryPlanSchema.parse(strip(d)));
  }

  async getPlan(patientId: string) {
    const doc = strip<RecoveryPlan>(await this.plans.findOne({ patientId }));
    return doc ? RecoveryPlanSchema.parse(doc) : null;
  }

  async getLibrary(filter?: { categories?: ReferenceLibraryEntry["category"][]; ids?: string[] }) {
    const q: Document = {};
    if (filter?.categories) q.category = { $in: filter.categories };
    if (filter?.ids) q.id = { $in: filter.ids };
    const docs = await this.library.find(q).toArray();
    return docs.map((d) => ReferenceLibraryEntrySchema.parse(strip(d)));
  }

  async getQueue() {
    const docs = await this.queue.find().sort({ dueAt: 1 }).toArray();
    return docs.map((d) => CheckinQueueEntrySchema.parse(strip(d)));
  }

  async listCheckins(patientId: string, limit = 20) {
    const docs = await this.checkins.find({ patientId }).sort({ at: -1 }).limit(limit).toArray();
    return docs.map((d) => CheckinRecordSchema.parse(strip(d)));
  }

  async listAudit(filter?: { patientId?: string; limit?: number }) {
    const q = filter?.patientId ? { patientId: filter.patientId } : {};
    const docs = await this.audit.find(q).sort({ seq: -1 }).limit(filter?.limit ?? 500).toArray();
    return docs.map((d) => AuditEventSchema.parse(strip(d)));
  }

  async listGateRequests(filter?: { status?: GateRequest["status"] }) {
    const q = filter?.status ? { status: filter.status } : {};
    const docs = await this.gate.find(q).sort({ createdAt: -1 }).toArray();
    return docs.map((d) => GateRequestSchema.parse(strip(d)));
  }

  async getGateRequest(id: string) {
    const doc = strip<GateRequest>(await this.gate.findOne({ id }));
    return doc ? GateRequestSchema.parse(doc) : null;
  }

  async saveCheckin(record: CheckinRecord) {
    await this.checkins.insertOne({ ...record, _id: record.id });
  }

  async updateQueueEntry(id: string, status: CheckinQueueEntry["status"]) {
    await this.queue.updateOne({ id }, { $set: { status } });
  }

  async appendEscalationEvent(patientId: string, event: EscalationEvent) {
    const res = await this.plans.updateOne(
      { patientId },
      { $push: { escalationHistory: event } } as Document,
      { writeConcern: { j: true } },
    );
    if (res.matchedCount === 0) throw new Error(`No recovery plan for ${patientId}`);
  }

  async updateEscalation(patientId: string, escalationId: string, patch: Partial<EscalationEvent>) {
    const set: Document = {};
    for (const [k, v] of Object.entries(patch)) set[`escalationHistory.$.${k}`] = v;
    await this.plans.updateOne({ patientId, "escalationHistory.id": escalationId }, { $set: set });
    const plan = await this.getPlan(patientId);
    return plan?.escalationHistory.find((e) => e.id === escalationId) ?? null;
  }

  async addPatternFlag(patientId: string, flag: RecoveryPlan["patternFlags"][number]) {
    await this.plans.updateOne({ patientId }, { $push: { patternFlags: flag } } as Document);
  }

  async updateIntakeStatus(
    patientId: string,
    status: NonNullable<RecoveryPlan["programMatch"]>["intakeStatus"],
  ) {
    await this.plans.updateOne(
      { patientId, programMatch: { $exists: true } },
      { $set: { "programMatch.intakeStatus": status } },
    );
  }

  async createGateRequest(request: GateRequest) {
    await this.gate.insertOne({ ...request, _id: request.id });
  }

  async updateGateRequest(id: string, patch: Partial<GateRequest>) {
    await this.gate.updateOne({ id }, { $set: patch });
    return this.getGateRequest(id);
  }

  async appendAudit(event: NewAuditEvent) {
    const counter = await this.counters.findOneAndUpdate(
      { _id: "audit" },
      { $inc: { value: 1 } },
      { upsert: true, returnDocument: "after" },
    );
    const row: AuditEvent = {
      ...event,
      id: newId("aud"),
      seq: counter?.value ?? Date.now(),
      timestamp: event.timestamp ?? new Date().toISOString(),
    };
    await this.audit.insertOne({ ...row, _id: row.id }, { writeConcern: { j: true } });
    return row;
  }

  async reset(now: Date = new Date()) {
    await Promise.all(
      ["recovery_plans", "reference_library", "checkin_queue", "checkins", "gate_requests", "audit_log", "counters"].map(
        (c) => this.db.collection(c).deleteMany({}),
      ),
    );
    await this.seed(now);
  }
}
