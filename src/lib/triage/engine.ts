import type {
  CheckinRecord,
  ModelTriage,
  RecoveryPlan,
  Signal,
  Tier,
  TriageResult,
} from "@/lib/domain/schemas";
import {
  TIER1_ON_TRACK,
  TIER1_SITUATIONAL,
  TIER2_CONTEXTUAL,
  TIER2_RECURRENCE,
  TIER3_AMBIGUITY,
  TIER3_SAFETY,
  TOPICS,
  TOPIC_LABELS,
} from "./keywords";

export const TIER_LABELS: Record<Tier, string> = {
  1: "Mild: resolve in conversation",
  2: "Moderate: flag pattern for clinician",
  3: "At risk: escalate to clinician",
};

/** Consecutive check-ins (including the current one) that trip the pattern rule. */
export const PATTERN_THRESHOLD = 3;

export const UNCLASSIFIED_PHRASE = "(no recognizable signal)";

const FILLERS = /\b(really|even|just|honestly|actually|kind of|sort of|like|totally)\b/g;

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function variants(text: string): string[] {
  const base = normalize(text);
  const stripped = base.replace(FILLERS, " ").replace(/\s+/g, " ").trim();
  return stripped === base ? [base] : [base, stripped];
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasPhrase(texts: string[], phrase: string): boolean {
  const re = new RegExp(`(^|[^a-z'])${escapeRegex(phrase)}($|[^a-z'])`);
  return texts.some((t) => re.test(t));
}

function isNegated(texts: string[], phrase: string): boolean {
  const re = new RegExp(
    `(^|[^a-z'])(not|never|no|isn't|wasn't|ain't|hardly)\\s+(so\\s+|very\\s+|that\\s+|too\\s+|really\\s+)?${escapeRegex(phrase)}($|[^a-z'])`,
  );
  return texts.some((t) => re.test(t));
}

function matchAll(texts: string[], phrases: string[], { guardNegation = false } = {}): string[] {
  const hits = phrases.filter(
    (p) => hasPhrase(texts, p) && !(guardNegation && isNegated(texts, p)),
  );
  // Drop phrases fully contained in a longer hit ("stuck to" inside "stuck to it").
  return hits.filter((h) => !hits.some((o) => o !== h && o.includes(h)));
}

export function extractTopics(utterance: string): string[] {
  const texts = variants(utterance);
  return Object.entries(TOPICS)
    .filter(([, phrases]) => phrases.some((p) => hasPhrase(texts, p)))
    .map(([topic]) => topic);
}

export type DeterministicResult = TriageResult & {
  /** True when Tier 3 was reached only because nothing could be classified. */
  unclassified: boolean;
  /** Highest tier implied by explicit signals, ignoring the unclassified rule. */
  signalFloor: Tier;
};

function maxTier(...tiers: Tier[]): Tier {
  return Math.max(...tiers) as Tier;
}

/**
 * Deterministic three-tier scoring.
 *
 * Governing rule: on any doubt about which tier a response belongs to, route
 * up, never down. A response that can't be classified is itself a Tier 3
 * trigger when no reasoning model is available to read it.
 *
 * @param history prior check-ins for this patient, most recent first
 */
export function scoreDeterministic(
  utterance: string,
  history: CheckinRecord[],
  plan: Pick<RecoveryPlan, "goals">,
): DeterministicResult {
  const texts = variants(utterance);
  const signals: Signal[] = [];

  for (const p of matchAll(texts, TIER3_SAFETY)) signals.push({ phrase: p, tierHint: 3, kind: "safety" });
  for (const p of matchAll(texts, TIER3_AMBIGUITY)) signals.push({ phrase: p, tierHint: 3, kind: "ambiguity" });
  for (const p of matchAll(texts, TIER2_RECURRENCE)) signals.push({ phrase: p, tierHint: 2, kind: "recurrence" });
  for (const p of matchAll(texts, TIER1_SITUATIONAL)) signals.push({ phrase: p, tierHint: 1, kind: "situational" });
  for (const p of matchAll(texts, TIER2_CONTEXTUAL)) signals.push({ phrase: p, tierHint: 1, kind: "situational" });
  for (const p of matchAll(texts, TIER1_ON_TRACK, { guardNegation: true })) signals.push({ phrase: p, tierHint: 1, kind: "on_track" });

  const topics = extractTopics(utterance);

  // Pattern history: the same issue in PATTERN_THRESHOLD consecutive check-ins.
  let patternSummary: string | undefined;
  for (const topic of topics) {
    if (topic === "on_track") continue;
    let run = 1;
    for (const prior of history) {
      if (prior.triage.topics.includes(topic)) run += 1;
      else break;
    }
    if (run >= PATTERN_THRESHOLD) {
      const withTiming =
        topic === "craving" && topics.includes("after_work") ? " (after work)" : "";
      patternSummary = `${ordinal(run)} consecutive check-in mentioning ${TOPIC_LABELS[topic]}${withTiming}.`;
      signals.push({ phrase: `${TOPIC_LABELS[topic]} x${run}`, tierHint: 2, kind: "pattern_history" });
      break;
    }
  }

  // A missed goal target more than once in the current tracking window.
  if (topics.includes("missed_session")) {
    const attendance = plan.goals.find((g) => /attend|session|group/i.test(g.description));
    if (attendance && attendance.missesThisWindow + 1 > 1) {
      patternSummary ??= `"${attendance.description}" missed more than once this tracking window.`;
      signals.push({ phrase: "goal missed more than once", tierHint: 2, kind: "pattern_history" });
    }
  }

  // Very short, non-descriptive answers are ambiguous unless clearly on track.
  const words = normalize(utterance).split(" ").filter(Boolean);
  if (words.length <= 2 && !signals.some((s) => s.kind === "on_track")) {
    signals.push({ phrase: "very short, non-descriptive answer", tierHint: 3, kind: "ambiguity" });
  }

  let unclassified = false;
  if (signals.length === 0) {
    unclassified = true;
    signals.push({ phrase: UNCLASSIFIED_PHRASE, tierHint: 3, kind: "ambiguity" });
  }

  const signalFloor = maxTier(
    1,
    ...signals.filter((s) => s.phrase !== UNCLASSIFIED_PHRASE).map((s) => s.tierHint),
  );
  const tier = maxTier(signalFloor, unclassified ? 3 : 1);

  if (tier === 2 && !patternSummary) {
    const recurring = topics.filter((t) => t !== "on_track").map((t) => TOPIC_LABELS[t]);
    patternSummary = recurring.length
      ? `Patient describes a recurring issue: ${recurring.join(", ")}.`
      : "Patient describes an issue recurring across check-ins.";
  }

  return {
    tier,
    label: TIER_LABELS[tier],
    rationale: deterministicRationale(tier, signals, unclassified, patternSummary),
    signals,
    topics,
    patternSummary: tier === 2 ? patternSummary : undefined,
    source: "deterministic",
    deterministicTier: tier,
    unclassified,
    signalFloor,
  };
}

function deterministicRationale(
  tier: Tier,
  signals: Signal[],
  unclassified: boolean,
  patternSummary?: string,
): string {
  if (unclassified) {
    return "Nothing in the response could be classified confidently, and no reasoning model was available to read it. Per the governing rule, a response that is hard to classify routes up to Tier 3.";
  }
  const top = signals.filter((s) => s.tierHint === tier).map((s) => `"${s.phrase}"`);
  if (tier === 3) {
    return `Safety-relevant or ambiguous language (${top.join(", ")}). Anchor does not interpret or reassure past it; it routes to a clinician.`;
  }
  if (tier === 2) {
    return `${patternSummary ?? "Recurring issue."} Nothing in this call is urgent on its own, so the trend is flagged for the clinician's next review.`;
  }
  return `Single, clearly described moment (${top.join(", ")}) with no recurrence across check-ins. Resolves in conversation.`;
}

function ordinal(n: number) {
  return n === 2 ? "Second" : n === 3 ? "Third" : `${n}th`;
}

/**
 * Combine the model's reading with the deterministic floor.
 *
 * The model can raise the tier but never lower it below any explicit signal.
 * The only thing a valid model reading can override is the "unclassified"
 * rule, which exists precisely because keyword matching can't read language.
 */
export function combineTriage(det: DeterministicResult, model: ModelTriage | null): TriageResult {
  const { unclassified: _u, signalFloor: _f, ...base } = det;
  void _u;
  void _f;
  if (!model) return base;

  const signals = det.unclassified
    ? base.signals.filter((s) => s.phrase !== UNCLASSIFIED_PHRASE)
    : base.signals;

  const tier = det.unclassified ? maxTier(model.tier, det.signalFloor) : maxTier(model.tier, det.tier);
  const raised = tier > det.signalFloor && model.tier === tier;
  return {
    ...base,
    signals,
    tier,
    label: TIER_LABELS[tier],
    rationale:
      tier === det.tier && !det.unclassified
        ? `${det.rationale} The local model agreed or rated lower; the higher tier stands.`
        : `${model.rationale}${raised ? " (Model reading raised the tier above the keyword floor.)" : ""}`,
    topics: Array.from(new Set([...det.topics, ...model.topics])),
    source: "model+deterministic",
    modelTier: model.tier,
    // With a valid model reading, the unclassified rule no longer applies, so
    // the floor reported is the one set by explicit signals.
    deterministicTier: det.unclassified ? det.signalFloor : det.tier,
    patternSummary: tier === 2 ? (det.patternSummary ?? model.rationale) : undefined,
  };
}
