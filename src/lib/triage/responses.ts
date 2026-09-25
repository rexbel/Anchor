import type { RecoveryPlan, ReferenceLibraryEntry, TriageResult } from "@/lib/domain/schemas";

/**
 * What Anchor says back, chosen from vetted lines in
 * docs/triage-dialogue-examples.md. The reasoning model never writes the
 * reply at Tier 3: at that tier Anchor's job is to route, not to counsel
 * through the disclosure. Tier 1 and 2 replies are also template based, so
 * every word a patient hears has been reviewed.
 */

// Vetted Tier 3 lines, verbatim.
const TIER3_DISCLOSURE =
  "Thank you for telling me that directly — that matters, and it's exactly the kind of thing a person needs to hear right now, not me. I'm escalating this immediately so your clinician can reach you.";
const TIER3_HOPELESS =
  "That sounds like more than a rough day, and I want to make sure you're actually okay — not something I can just check a box on. I'm connecting you with your clinician right now so a real person can talk this through with you.";
const TIER3_NONRESPONSIVE =
  "That's okay — you don't have to walk me through it. I'm not going to guess what's going on, though, so I'm getting your clinician on this so a person can check in with you properly.";

const DISCLOSURE_PHRASES = new Set([
  "hopeless",
  "scared of myself",
  "not safe",
  "hurt someone",
  "don't want to be here",
  "can't stop thinking about it",
]);

export function selectReferences(
  triage: TriageResult,
  plan: RecoveryPlan,
  library: ReferenceLibraryEntry[],
): ReferenceLibraryEntry[] {
  if (triage.tier === 3) {
    // Clinician-facing only. Attached to the escalation record, never spoken.
    return library.filter((e) => e.category === "crisis_resource");
  }
  // Tier 1 and 2 may surface coping or psychoeducation content, never
  // program or crisis resources, and only when a topic calls for it.
  const wantsCoping = triage.topics.some((t) => ["craving", "stress", "sleep"].includes(t));
  if (!wantsCoping) return [];

  const eligible = library.filter(
    (e) =>
      e.audience === "patient" &&
      (e.category === "coping_technique" || e.category === "psychoeducation") &&
      e.patientScript.length > 0,
  );
  const scored = eligible
    .map((e) => {
      let score = 0;
      if (plan.copingPlanReferenceIds.includes(e.id)) score += 2;
      if (triage.topics.includes("craving") && e.keywords.some((k) => /crav|urge|drink|use|tempt/.test(k))) score += 3;
      if (triage.topics.includes("stress") && e.keywords.some((k) => /stress|edge|anx|tense/.test(k))) score += 3;
      // A technique the patient says isn't working shouldn't be offered again.
      if (triage.topics.includes("technique_not_working") && e.id === "ref-coping-box-breathing") score -= 10;
      return { e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 1).map((x) => x.e);
}

export function composeReply(triage: TriageResult, references: ReferenceLibraryEntry[]): string {
  if (triage.tier === 3) {
    const safety = triage.signals.filter((s) => s.kind === "safety").map((s) => s.phrase);
    if (safety.some((p) => DISCLOSURE_PHRASES.has(p))) return TIER3_DISCLOSURE;
    if (safety.length > 0) return TIER3_HOPELESS;
    return TIER3_NONRESPONSIVE;
  }

  const coping = references.find((r) => r.audience === "patient" && r.patientScript)?.patientScript;

  if (triage.tier === 2) {
    if (triage.topics.includes("technique_not_working")) {
      return "That's useful to hear, and it's not a failure on your part. Sometimes a technique just isn't the right fit, and that's worth your clinician knowing so you two can find something that clicks. I'm noting this so it comes up at your next visit.";
    }
    if (triage.topics.includes("missed_session")) {
      return "That's good to know, and I'm glad you told me directly instead of me finding out another way. I'll flag it for your care team so they can follow up on scheduling.";
    }
    const lead =
      "I hear you, and thanks for being straight about it happening again. I'm going to make sure your care team sees this pattern before your next session.";
    return coping ? `${lead} For tonight: ${lowerFirst(coping)}` : lead;
  }

  if (triage.topics.includes("craving")) {
    return `That's a real moment to notice. You saw it and you didn't act on it. ${coping ?? ""}`.trim();
  }
  if (triage.topics.includes("stress") || triage.topics.includes("sleep")) {
    return `Makes sense after a long one. ${coping ?? "Get some rest, and I'll check in tomorrow."}`.trim();
  }
  return "Good to hear. Same time tomorrow.";
}

function lowerFirst(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
