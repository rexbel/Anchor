import type {
  CheckinQueueEntry,
  CheckinRecord,
  RecoveryPlan,
  ReferenceLibraryEntry,
} from "@/lib/domain/schemas";

/**
 * Seeded demo data. Every person here is synthetic. Dates are computed
 * relative to the moment the store is seeded, so the queue is always "due
 * today" when the demo is reset.
 */

const LIBRARY_SOURCE =
  "Adapted from public SAMHSA and NIDA patient education for demo use. Must be vetted by the clinic before real use.";

export const REFERENCE_LIBRARY: ReferenceLibraryEntry[] = [
  {
    id: "ref-coping-box-breathing",
    category: "coping_technique",
    title: "Box breathing",
    summary: "A four count breathing pattern that slows the stress response in about a minute.",
    patientScript:
      "If it helps tonight, try box breathing: breathe in for four, hold for four, out for four, hold for four. Four rounds is enough.",
    audience: "patient",
    keywords: ["stress", "stressful", "on edge", "anxious", "tense", "panic", "overwhelmed"],
    source: LIBRARY_SOURCE,
  },
  {
    id: "ref-coping-urge-surfing",
    category: "coping_technique",
    title: "Urge surfing",
    summary: "Treat a craving as a wave that rises, peaks, and passes without acting on it.",
    patientScript:
      "If it comes up again tonight, try urge surfing: picture the craving as a wave. It peaks and passes even if you don't act on it, usually inside twenty minutes.",
    audience: "patient",
    keywords: ["craving", "wanted a drink", "urge", "tempted", "want to use", "wanted to use"],
    source: LIBRARY_SOURCE,
  },
  {
    id: "ref-psychoed-craving-curve",
    category: "psychoeducation",
    title: "The craving curve",
    summary: "Cravings build, peak, and fade. Riding one out tends to make the next one weaker.",
    patientScript:
      "Cravings follow a curve: they build, peak, and fade. Each one you ride out without acting on it tends to make the next one a little weaker.",
    audience: "patient",
    keywords: ["craving", "keeps coming back", "why do i", "urge"],
    source: LIBRARY_SOURCE,
  },
  {
    id: "ref-program-riverside",
    category: "program_resource",
    title: "Riverside Accountability & Recovery Program (fictional)",
    summary:
      "Combined accountability and substance treatment program. Self referral accepted. Set upstream in the check-in script from the Recovery Plan, never chosen reactively.",
    patientScript: "",
    audience: "patient",
    keywords: [],
    source: "Seeded, fictional program used for the bridge scenario.",
  },
  {
    id: "ref-crisis-988",
    category: "crisis_resource",
    title: "988 Suicide & Crisis Lifeline (US)",
    summary:
      "Call or text 988. For clinician reference while handling an escalation. Anchor never reads this aloud or acts on it itself.",
    patientScript: "",
    audience: "clinician",
    keywords: [],
    source: "988lifeline.org",
  },
  {
    id: "ref-crisis-ndvh",
    category: "crisis_resource",
    title: "National Domestic Violence Hotline (US)",
    summary:
      "1-800-799-7233. For clinician reference while handling an escalation. Anchor never reads this aloud or acts on it itself.",
    patientScript: "",
    audience: "clinician",
    keywords: [],
    source: "thehotline.org",
  },
];

function iso(base: Date, { days = 0, hours = 0, minutes = 0 } = {}) {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(d.getUTCHours() + hours, d.getUTCMinutes() + minutes);
  return d.toISOString();
}

export function buildRecoveryPlans(now: Date): RecoveryPlan[] {
  const consent = (voiceClone: boolean) => ({
    aiCheckins: true,
    voiceClone,
    voiceCloneScope: voiceClone
      ? "Patient recorded a reference sample and consented to a cloned check-in voice. Separate from consent to AI check-ins."
      : "Not consented. Check-ins use the default clinic voice.",
    recordedAt: iso(now, { days: -14 }),
  });

  return [
    {
      id: "plan-demo-ideal",
      patientId: "demo-patient-ideal",
      displayName: "Jordan R.",
      scenario: "ideal",
      scenarioBlurb: "On track. The check-in resolves with acknowledgment alone.",
      diagnosis: {
        system: "ICD-10-CM",
        code: "F10.10",
        display: "Alcohol abuse, uncomplicated",
        source: "recovery-plan",
      },
      clinician: { name: "Dr. A. Chen (fictional)", role: "Addiction medicine physician" },
      goals: [
        {
          id: "g-ideal-1",
          description: "No drinking days this week",
          measure: "Self reported drinking days",
          missesThisWindow: 0,
        },
        {
          id: "g-ideal-2",
          description: "Attend the Thursday peer group",
          measure: "Attendance",
          missesThisWindow: 0,
        },
      ],
      knownTriggers: ["Friday happy hour with coworkers"],
      copingPlanReferenceIds: ["ref-coping-box-breathing"],
      checkinCadence: "daily",
      consent: consent(true),
      escalationHistory: [],
      patternFlags: [],
    },
    {
      id: "plan-demo-complex",
      patientId: "demo-patient-complex",
      displayName: "Sam T.",
      scenario: "complex",
      scenarioBlurb:
        "Situational after-work cravings. One prior mention on record, so a third consecutive mention flips to a Tier 2 pattern flag.",
      diagnosis: {
        system: "ICD-10-CM",
        code: "F10.20",
        display: "Alcohol dependence, uncomplicated",
        source: "recovery-plan",
      },
      clinician: { name: "Dr. M. Alvarez (fictional)", role: "Addiction medicine physician" },
      goals: [
        {
          id: "g-complex-1",
          description: "Ride out cravings without drinking",
          measure: "Self reported drinking days",
          missesThisWindow: 0,
        },
        {
          id: "g-complex-2",
          description: "Tuesday counseling session",
          measure: "Attendance",
          missesThisWindow: 1,
        },
      ],
      knownTriggers: ["After-work stress", "Driving past the liquor store on the way home"],
      copingPlanReferenceIds: ["ref-coping-urge-surfing", "ref-psychoed-craving-curve"],
      checkinCadence: "daily",
      consent: consent(true),
      escalationHistory: [],
      patternFlags: [],
    },
    {
      id: "plan-demo-edge",
      patientId: "demo-patient-edge",
      displayName: "Casey M.",
      scenario: "edge",
      scenarioBlurb:
        "Inbound call. The patient leads with a safety-relevant disclosure. Anchor routes to a human immediately and does not counsel.",
      diagnosis: {
        system: "ICD-10-CM",
        code: "F11.20",
        display: "Opioid dependence, uncomplicated",
        source: "recovery-plan",
      },
      clinician: { name: "Dr. R. Okafor (fictional)", role: "Psychiatrist, addiction specialty" },
      goals: [
        {
          id: "g-edge-1",
          description: "Daily medication adherence (clinician managed)",
          measure: "Self reported",
          missesThisWindow: 0,
        },
      ],
      knownTriggers: ["Isolation on weekends", "Poor sleep"],
      copingPlanReferenceIds: ["ref-coping-box-breathing"],
      checkinCadence: "daily",
      consent: consent(true),
      escalationHistory: [],
      patternFlags: [],
    },
    {
      id: "plan-demo-bridge",
      patientId: "demo-patient-bridge",
      displayName: "Bridge-Scenario J.",
      scenario: "bridge",
      scenarioBlurb:
        "Post-disclosure bridge. Referred to an accountability program, not yet enrolled. Diagnosis is read from the FHIR R4 record.",
      diagnosis: {
        system: "ICD-10-CM",
        code: "F10.20",
        display: "Alcohol dependence, uncomplicated",
        source: "fhir",
      },
      clinician: { name: "Dr. M. Alvarez (fictional)", role: "Addiction medicine physician" },
      goals: [
        {
          id: "g-bridge-1",
          description: "Maintain abstinence through the wait for program intake",
          measure: "Self reported drinking days and daily check-in engagement",
          missesThisWindow: 0,
        },
      ],
      knownTriggers: ["Evenings alone", "Arguments at home"],
      copingPlanReferenceIds: ["ref-coping-box-breathing", "ref-coping-urge-surfing"],
      checkinCadence: "daily",
      consent: consent(false),
      programMatch: {
        referenceId: "ref-program-riverside",
        programName: "Riverside Accountability & Recovery Program (fictional)",
        intakeDate: iso(now, { days: 5 }).slice(0, 10),
        intakeStatus: "scheduled",
      },
      fhirBundle: "bundle-patient-10.json",
      escalationHistory: [],
      patternFlags: [],
    },
  ];
}

export function buildQueue(now: Date): CheckinQueueEntry[] {
  return [
    { id: "q-ideal", patientId: "demo-patient-ideal", dueAt: iso(now, { minutes: -40 }), cadence: "daily", status: "due" },
    { id: "q-complex", patientId: "demo-patient-complex", dueAt: iso(now, { minutes: -15 }), cadence: "daily", status: "due" },
    { id: "q-bridge", patientId: "demo-patient-bridge", dueAt: iso(now, { minutes: 20 }), cadence: "daily", status: "due" },
    { id: "q-edge", patientId: "demo-patient-edge", dueAt: iso(now, { hours: 2 }), cadence: "daily", status: "due" },
  ];
}

/** Prior check-ins, so pattern rules have real history to count against. */
export function buildPriorCheckins(now: Date): CheckinRecord[] {
  return [
    {
      id: "c-seed-complex-1",
      patientId: "demo-patient-complex",
      at: iso(now, { days: -1, hours: -3 }),
      direction: "outbound",
      utterance:
        "Kind of a stressful day, honestly. Had a moment where I really wanted a drink after work, but I didn't.",
      anchorReply:
        "That's a real moment to notice. You saw it and you didn't act on it. If it comes up again tonight, try urge surfing.",
      triage: {
        tier: 1,
        label: "Mild: resolve in conversation",
        rationale: "Single, clearly described situational craving with no recurrence yet.",
        signals: [{ phrase: "wanted a drink", tierHint: 1, kind: "situational" }],
        topics: ["craving", "after_work", "stress"],
        source: "deterministic",
        deterministicTier: 1,
      },
      referenceIds: ["ref-coping-urge-surfing"],
    },
    {
      id: "c-seed-ideal-1",
      patientId: "demo-patient-ideal",
      at: iso(now, { days: -1, hours: -2 }),
      direction: "outbound",
      utterance: "Today was fine, stuck to the plan.",
      anchorReply: "Good to hear. Same time tomorrow.",
      triage: {
        tier: 1,
        label: "Mild: resolve in conversation",
        rationale: "On track, nothing ambiguous.",
        signals: [{ phrase: "stuck to", tierHint: 1, kind: "on_track" }],
        topics: ["on_track"],
        source: "deterministic",
        deterministicTier: 1,
      },
      referenceIds: [],
    },
  ];
}

export type SampleUtterance = { label: string; tierHint: 1 | 2 | 3; text: string };

/**
 * Patient lines from the vetted triage dialogue examples
 * (docs/triage-dialogue-examples.md). No new crisis language is written here.
 */
export const SAMPLE_UTTERANCES: SampleUtterance[] = [
  { label: "On track", tierHint: 1, text: "Pretty good, honestly. Stuck to it, nothing to report." },
  {
    label: "Situational craving",
    tierHint: 1,
    text: "Kind of a stressful day, honestly. Had a moment where I really wanted a drink after work, but I didn't.",
  },
  { label: "A little on edge", tierHint: 1, text: "Tired, but manageable. Feeling a little on edge, nothing major." },
  {
    label: "Recurring craving",
    tierHint: 2,
    text: "Same thing again, wanted to drink after work. That's the third time this week.",
  },
  {
    label: "Missed sessions",
    tierHint: 2,
    text: "Fine. Honestly though, I keep missing my Tuesday counseling session. Haven't been in two weeks.",
  },
  {
    label: "Technique not landing",
    tierHint: 2,
    text: "Okay I guess. I haven't been doing the breathing thing you suggested, doesn't feel like it's working. Kind of frustrated with the whole thing, honestly.",
  },
  { label: "Doesn't matter", tierHint: 3, text: "I don't know. Doesn't really matter anymore." },
  { label: "Won't talk", tierHint: 3, text: "I don't really want to talk about today." },
  {
    label: "Inbound disclosure",
    tierHint: 3,
    text: "Hi, I feel hopeless. I don't know what I'd do if things got worse. Kind of scared of myself right now.",
  },
];

export const SCENARIO_DEFAULT_SAMPLE: Record<RecoveryPlan["scenario"], number> = {
  ideal: 0,
  complex: 1,
  edge: 8,
  bridge: 5,
};
