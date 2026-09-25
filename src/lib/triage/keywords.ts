/**
 * First-pass signal words from docs/triage-logic.md.
 *
 * These are a sense-check, not the classifier: matching strings alone would
 * misclassify sarcasm, negation, or quoted speech. They set a deterministic
 * floor that the reasoning model can raise but never lower.
 *
 * Tier 3 terms are general distress, hopelessness, and safety language only.
 * No method, means, or instructional detail appears here, under any framing.
 */

export const TIER1_ON_TRACK = [
  "fine",
  "okay",
  "ok",
  "good",
  "great",
  "stuck to it",
  "stuck to the plan",
  "stuck to",
  "on track",
  "nothing to report",
  "manageable",
];

export const TIER1_SITUATIONAL = [
  "tempted",
  "wanted a drink",
  "wanted to drink",
  "wanted to use",
  "stressful day",
  "stressful",
  "tired",
  "craving",
  "urge",
  "on edge",
];

/**
 * Phrases that state recurrence on their own ("again", "third time").
 * Per the triage logic, repetition is what makes something Tier 2, not the
 * words themselves, so single-instance words live in TIER2_CONTEXTUAL below.
 */
export const TIER2_RECURRENCE = [
  "again",
  "every time",
  "keeps happening",
  "keep happening",
  "keep missing",
  "haven't been",
  "not working",
  "third time",
  "slipping",
  "hard to keep up",
];

/** Tier 2 words that read as Tier 1 unless history shows repetition. */
export const TIER2_CONTEXTUAL = ["missed", "frustrated"];

export const TIER3_SAFETY = [
  "hopeless",
  "no point",
  "can't do this anymore",
  "scared of myself",
  "not safe",
  "give up",
  "doesn't matter",
  "don't matter",
  "can't stop thinking about it",
  "hurt someone",
  "don't want to be here",
];

/** Flat, non-responsive, or evasive answers. Ambiguity itself routes up. */
export const TIER3_AMBIGUITY = [
  "don't want to talk",
  "don't really want to talk",
  "not talking about it",
  "leave me alone",
  "whatever",
  "rather not say",
];

/** Topic extraction for pattern rules (same issue across check-ins). */
export const TOPICS: Record<string, string[]> = {
  craving: ["craving", "wanted a drink", "wanted to drink", "wanted to use", "urge", "tempted"],
  after_work: ["after work"],
  stress: ["stress", "stressful", "on edge", "overwhelmed"],
  missed_session: ["missed", "keep missing", "missing my", "haven't been in"],
  technique_not_working: ["not working", "doesn't feel like it's working", "haven't been doing"],
  sleep: ["sleep", "tired", "insomnia"],
  on_track: ["stuck to", "on track", "nothing to report"],
};

export const TOPIC_LABELS: Record<string, string> = {
  craving: "craving",
  after_work: "after-work timing",
  stress: "stress",
  missed_session: "missed session",
  technique_not_working: "coping technique not landing",
  sleep: "sleep",
  on_track: "on track",
};
