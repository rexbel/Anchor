import { beforeEach, describe, expect, it, vi } from "vitest";

import { SAMPLE_UTTERANCES } from "@/lib/data/seed";
import { runCheckin } from "@/lib/pipeline/checkin";
import { MemoryStore } from "@/lib/store/memory";
import { decide_gate, escalate_to_clinician, request_gated_action, resolve_escalation } from "@/lib/tools";

const disclosure = SAMPLE_UTTERANCES.find((s) => s.label === "Inbound disclosure")!.text;
const recurring = SAMPLE_UTTERANCES.find((s) => s.label === "Recurring craving")!.text;
const onTrack = SAMPLE_UTTERANCES.find((s) => s.label === "On track")!.text;

let store: MemoryStore;
beforeEach(() => {
  store = new MemoryStore(new Date("2026-09-25T15:00:00Z"));
});

describe("Tier 3: escalate_to_clinician is always open", () => {
  it("commits the escalation to the store before the OpenClaw handoff is sent", async () => {
    const order: string[] = [];
    const appendEscalation = store.appendEscalationEvent.bind(store);
    vi.spyOn(store, "appendEscalationEvent").mockImplementation(async (...args) => {
      order.push("commit");
      return appendEscalation(...args);
    });
    const handoff = vi.fn(async () => {
      order.push("handoff");
      // The escalation must already be durable when the hook is called.
      const plan = await store.getPlan("demo-patient-edge");
      expect(plan!.escalationHistory).toHaveLength(1);
      return "sent" as const;
    });

    const result = await runCheckin(
      store,
      { patientId: "demo-patient-edge", direction: "inbound", utterance: disclosure },
      { escalate: (s, input) => escalate_to_clinician(s, input, { sendHandoff: handoff }) },
    );

    expect(order).toEqual(["commit", "handoff"]);
    expect(result.triage.tier).toBe(3);
    expect(result.escalation?.handoff).toBe("sent");
    expect(result.gateRequest).toBeUndefined();

    const audit = (await store.listAudit({ patientId: "demo-patient-edge" })).reverse().map((a) => a.kind);
    expect(audit.indexOf("escalation_committed")).toBeLessThan(audit.indexOf("handoff_sent"));
  });

  it("never waits on the reasoning model for an explicit Tier 3 signal", async () => {
    const classify = vi.fn();
    const result = await runCheckin(
      store,
      { patientId: "demo-patient-edge", direction: "inbound", utterance: disclosure },
      { classify },
    );
    expect(classify).not.toHaveBeenCalled();
    expect(result.model.status).toBe("skipped");
  });

  it("stays committed when the OpenClaw hook is down", async () => {
    const outcome = await escalate_to_clinician(
      store,
      {
        patientId: "demo-patient-edge",
        transcript: disclosure,
        triage: (await runCheckin(store, { patientId: "demo-patient-ideal", direction: "outbound", utterance: "hopeless" })).triage,
      },
      { sendHandoff: async () => "failed_retrying" },
    );
    const plan = await store.getPlan("demo-patient-edge");
    expect(outcome.handoff).toBe("failed_retrying");
    expect(plan!.escalationHistory.at(-1)!.resolved).toBe(false);
  });

  it("replies with the vetted Tier 3 line, verbatim", async () => {
    const result = await runCheckin(store, {
      patientId: "demo-patient-edge",
      direction: "inbound",
      utterance: disclosure,
    });
    expect(result.reply).toBe(
      "Thank you for telling me that directly — that matters, and it's exactly the kind of thing a person needs to hear right now, not me. I'm escalating this immediately so your clinician can reach you.",
    );
    // Crisis resources are attached for the clinician, never spoken.
    expect(result.references.every((r) => r.category === "crisis_resource")).toBe(true);
    expect(result.reply).not.toMatch(/988/);
  });

  it("only a named clinician can resolve an escalation", async () => {
    const result = await runCheckin(store, { patientId: "demo-patient-edge", direction: "inbound", utterance: disclosure });
    const id = result.escalation!.id;
    await expect(
      resolve_escalation(store, { patientId: "demo-patient-edge", escalationId: id, clinician: "  ", note: "" }),
    ).rejects.toThrow(/named clinician/);
    const resolved = await resolve_escalation(store, {
      patientId: "demo-patient-edge",
      escalationId: id,
      clinician: "Dr. R. Okafor",
      note: "Reached patient by phone.",
    });
    expect(resolved.resolved).toBe(true);
  });
});

describe("Tier 2: flag_pattern_for_clinician is OpenShell-gated", () => {
  it("is requested, held, and executes only after approval", async () => {
    const result = await runCheckin(store, { patientId: "demo-patient-complex", direction: "outbound", utterance: recurring });
    expect(result.triage.tier).toBe(2);
    expect(result.gateRequest?.status).toBe("pending");
    expect((await store.getPlan("demo-patient-complex"))!.patternFlags).toHaveLength(0);

    await decide_gate(store, { id: result.gateRequest!.id, decision: "approved", clinician: "Dr. M. Alvarez" });
    const plan = await store.getPlan("demo-patient-complex");
    expect(plan!.patternFlags).toHaveLength(1);
    expect(plan!.patternFlags[0].approvedBy).toBe("Dr. M. Alvarez");
  });

  it("a rejected request executes nothing and can't be decided twice", async () => {
    const result = await runCheckin(store, { patientId: "demo-patient-complex", direction: "outbound", utterance: recurring });
    await decide_gate(store, { id: result.gateRequest!.id, decision: "rejected", clinician: "Dr. M. Alvarez" });
    expect((await store.getPlan("demo-patient-complex"))!.patternFlags).toHaveLength(0);
    await expect(
      decide_gate(store, { id: result.gateRequest!.id, decision: "approved", clinician: "Dr. M. Alvarez" }),
    ).rejects.toThrow(/Already rejected/);
  });

  it("place_checkin_call uses the clinician's edited script", async () => {
    const req = await request_gated_action(store, {
      patientId: "demo-patient-bridge",
      action: "place_checkin_call",
      summary: "Scheduled check-in",
      draft: "Hey, it's me. How'd today go?",
      queueEntryId: "q-bridge",
    });
    expect((await store.getQueue()).find((q) => q.id === "q-bridge")!.status).toBe("awaiting_approval");
    await decide_gate(store, {
      id: req.id,
      decision: "approved",
      clinician: "Dr. M. Alvarez",
      draft: "Hey, it's me. Your intake is Tuesday. How'd today go?",
    });
    expect((await store.getQueue()).find((q) => q.id === "q-bridge")!.status).toBe("call_placed");
    const executed = (await store.listAudit({ patientId: "demo-patient-bridge" })).find((a) => a.kind === "action_executed");
    expect(executed!.detail).toContain("Your intake is Tuesday");
  });
});

describe("Tier 1: resolve in conversation", () => {
  it("creates no escalation and no gate request", async () => {
    const result = await runCheckin(store, { patientId: "demo-patient-ideal", direction: "outbound", utterance: onTrack });
    expect(result.triage.tier).toBe(1);
    expect(result.escalation).toBeUndefined();
    expect(result.gateRequest).toBeUndefined();
    expect(result.reply).toBe("Good to hear. Same time tomorrow.");
  });

  it("falls back to deterministic rules when the model is unavailable", async () => {
    const result = await runCheckin(
      store,
      { patientId: "demo-patient-ideal", direction: "outbound", utterance: onTrack },
      {
        classify: async () => ({ ok: false, reason: "timeout", detail: "Model did not answer in time", attempts: 1, ms: 12000 }),
      },
    );
    expect(result.model.status).toBe("fallback");
    expect(result.triage.tier).toBe(1);
  });

  it("the complex scenario flips to Tier 2 on the third consecutive craving", async () => {
    const craving = SAMPLE_UTTERANCES.find((s) => s.label === "Situational craving")!.text;
    const second = await runCheckin(store, { patientId: "demo-patient-complex", direction: "outbound", utterance: craving });
    expect(second.triage.tier).toBe(1);
    expect(second.references[0]?.id).toBe("ref-coping-urge-surfing");
    const third = await runCheckin(store, { patientId: "demo-patient-complex", direction: "outbound", utterance: craving });
    expect(third.triage.tier).toBe(2);
    expect(third.gateRequest?.action).toBe("flag_pattern_for_clinician");
  });
});
