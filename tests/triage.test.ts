import { describe, expect, it } from "vitest";

import { buildPriorCheckins, buildRecoveryPlans, SAMPLE_UTTERANCES } from "@/lib/data/seed";
import type { CheckinRecord, ModelTriage } from "@/lib/domain/schemas";
import { combineTriage, scoreDeterministic } from "@/lib/triage/engine";
import { TIER3_SAFETY } from "@/lib/triage/keywords";

const now = new Date("2026-09-25T15:00:00Z");
const plans = buildRecoveryPlans(now);
const plan = (id: string) => plans.find((p) => p.patientId === id)!;
const priors = buildPriorCheckins(now);
const history = (id: string) =>
  priors.filter((c) => c.patientId === id).sort((a, b) => b.at.localeCompare(a.at));

describe("deterministic triage against the vetted dialogue examples", () => {
  for (const sample of SAMPLE_UTTERANCES) {
    it(`"${sample.label}" scores Tier ${sample.tierHint}`, () => {
      // No history, so recurrence comes only from the words themselves.
      const result = scoreDeterministic(sample.text, [], plan("demo-patient-ideal"));
      expect(result.tier).toBe(sample.tierHint);
    });
  }

  it("every Tier 3 keyword alone escalates", () => {
    for (const phrase of TIER3_SAFETY) {
      const result = scoreDeterministic(`I guess ${phrase}.`, [], plan("demo-patient-ideal"));
      expect(result.tier, phrase).toBe(3);
    }
  });
});

describe("route up, never down", () => {
  it("an unclassifiable answer routes up to Tier 3 when no model is available", () => {
    const result = scoreDeterministic("Went to the store and then watched a movie.", [], plan("demo-patient-ideal"));
    expect(result.unclassified).toBe(true);
    expect(result.tier).toBe(3);
  });

  it("a very short, non-descriptive answer is ambiguous and routes up", () => {
    expect(scoreDeterministic("meh", [], plan("demo-patient-ideal")).tier).toBe(3);
  });

  it("negated on-track words don't count as on track", () => {
    const result = scoreDeterministic("I'm not okay.", [], plan("demo-patient-ideal"));
    expect(result.signals.some((s) => s.kind === "on_track")).toBe(false);
    expect(result.tier).toBe(3);
  });

  it("the model can never lower an explicit Tier 3 signal", () => {
    const det = scoreDeterministic(SAMPLE_UTTERANCES[8].text, [], plan("demo-patient-edge"));
    const model: ModelTriage = { tier: 1, rationale: "Sounds fine.", topics: [] };
    expect(combineTriage(det, model).tier).toBe(3);
  });

  it("the model can never lower a Tier 2 recurrence signal", () => {
    const det = scoreDeterministic(SAMPLE_UTTERANCES[3].text, [], plan("demo-patient-complex"));
    expect(det.tier).toBe(2);
    expect(combineTriage(det, { tier: 1, rationale: "Just a craving.", topics: [] }).tier).toBe(2);
  });

  it("the model can raise a Tier 1 reading", () => {
    const det = scoreDeterministic("Tired, but manageable.", [], plan("demo-patient-ideal"));
    expect(det.tier).toBe(1);
    const combined = combineTriage(det, { tier: 3, rationale: "Flat affect.", topics: [] });
    expect(combined.tier).toBe(3);
    expect(combined.source).toBe("model+deterministic");
  });

  it("a valid model reading replaces only the unclassified rule", () => {
    const det = scoreDeterministic("Went to the store and then watched a movie.", [], plan("demo-patient-ideal"));
    const combined = combineTriage(det, { tier: 1, rationale: "Ordinary day, on track.", topics: ["on_track"] });
    expect(combined.tier).toBe(1);
    expect(combined.signals.some((s) => s.phrase === "(no recognizable signal)")).toBe(false);
  });
});

describe("pattern rules", () => {
  const craving =
    "Kind of a stressful day, honestly. Had a moment where I really wanted a drink after work, but I didn't.";

  it("a second consecutive craving stays Tier 1", () => {
    const result = scoreDeterministic(craving, history("demo-patient-complex"), plan("demo-patient-complex"));
    expect(result.tier).toBe(1);
    expect(result.topics).toContain("craving");
  });

  it("a third consecutive craving becomes a Tier 2 pattern", () => {
    const second: CheckinRecord = {
      ...history("demo-patient-complex")[0],
      id: "c-second",
      at: new Date(now.getTime() - 60_000).toISOString(),
    };
    const result = scoreDeterministic(
      craving,
      [second, ...history("demo-patient-complex")],
      plan("demo-patient-complex"),
    );
    expect(result.tier).toBe(2);
    expect(result.patternSummary).toMatch(/Third consecutive check-in mentioning craving \(after work\)/);
  });

  it("a single missed session with no prior misses stays Tier 1", () => {
    const result = scoreDeterministic("I missed Thursday's group.", [], plan("demo-patient-ideal"));
    expect(result.tier).toBe(1);
  });

  it("a missed session with a prior miss this window is a Tier 2 pattern", () => {
    const result = scoreDeterministic("I missed Tuesday's session.", [], plan("demo-patient-complex"));
    expect(result.tier).toBe(2);
  });
});
