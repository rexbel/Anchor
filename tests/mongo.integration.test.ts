import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SAMPLE_UTTERANCES } from "@/lib/data/seed";
import { runCheckin } from "@/lib/pipeline/checkin";
import { MongoStore } from "@/lib/store/mongo";
import { decide_gate } from "@/lib/tools";

/**
 * Runs only when MONGODB_URI is set (CI starts a mongo service container).
 * Exercises the same safety properties as the memory-store tests, against a
 * real MongoDB.
 */
const uri = process.env.MONGODB_URI;
const suite = uri ? describe : describe.skip;

suite("MongoStore integration", () => {
  let store: MongoStore;

  beforeAll(async () => {
    store = await MongoStore.connect(uri!, `anchor_test_${Date.now()}`, 5000);
    await store.reset(new Date("2026-09-25T15:00:00Z"));
  });

  afterAll(async () => {
    await store?.dropDatabase();
    await store?.close();
  });

  it("seeds four plans and the reference library", async () => {
    expect(await store.listPlans()).toHaveLength(4);
    expect((await store.getLibrary({ categories: ["crisis_resource"] })).length).toBe(2);
  });

  it("commits a Tier 3 escalation durably before the handoff", async () => {
    const disclosure = SAMPLE_UTTERANCES.find((s) => s.label === "Inbound disclosure")!.text;
    const result = await runCheckin(store, { patientId: "demo-patient-edge", direction: "inbound", utterance: disclosure });
    expect(result.triage.tier).toBe(3);
    const plan = await store.getPlan("demo-patient-edge");
    expect(plan!.escalationHistory.at(-1)!.id).toBe(result.escalation!.id);

    const audit = await store.listAudit({ patientId: "demo-patient-edge" });
    const committed = audit.find((a) => a.kind === "escalation_committed")!;
    const handoff = audit.find((a) => a.kind === "handoff_queued_locally" || a.kind === "handoff_sent")!;
    expect(committed.seq).toBeLessThan(handoff.seq);
  });

  it("holds a Tier 2 flag at the gate until approval", async () => {
    const recurring = SAMPLE_UTTERANCES.find((s) => s.label === "Recurring craving")!.text;
    const result = await runCheckin(store, { patientId: "demo-patient-complex", direction: "outbound", utterance: recurring });
    expect((await store.getPlan("demo-patient-complex"))!.patternFlags).toHaveLength(0);
    await decide_gate(store, { id: result.gateRequest!.id, decision: "approved", clinician: "Dr. M. Alvarez" });
    expect((await store.getPlan("demo-patient-complex"))!.patternFlags).toHaveLength(1);
  });
});
