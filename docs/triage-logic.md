# Anchor — Outbound Triage Logic

> **In this repo:** these rules are implemented in `src/lib/triage/` (keywords in `keywords.ts`, scoring in `engine.ts`) and covered by `tests/triage.test.ts`. References below to `anchor-architecture.html` and the build plan point to the original hackathon planning workspace; see `docs/BUILD_PLAN.md` and the app's How it works page.

Three tiers, matching the three actions that already exist in `anchor-architecture.html` — no new action is introduced here, this document only defines which patient response routes to which existing action. Extends Build Plan Section 8's three informal calibration cases (ideal / complex / edge) into explicit rules rather than replacing them.

**The one rule that governs all three tiers:** on any doubt about which tier a response belongs to, route up, never down. A response that's hard to classify is itself the Tier 3 trigger — "I'm not sure" is not a reason to guess toward the calmer tier.

---

## Tier 1 — Mild (Resolve in-conversation)

**Action:** surface reference-library content as relevant. **Gated:** no — this is the ungated default path.

**Trigger.** The response describes a single, situational moment — on track, or a craving/trigger/stressor — clearly enough that there's nothing ambiguous about what's being reported, and it isn't the same issue recurring across check-ins (see Tier 2's escalation rule for what "recurring" means).

**Example utterances:**
- "Today was fine, stuck to the plan."
- "I had a rough afternoon at work and wanted a drink, but I didn't."
- "Feeling a little on edge tonight, nothing major."

**Eligible reference-library categories:** `coping_technique` and `psychoeducation` only — specifically the entries that already exist in `bh-reference-library.seed.json`: `ref-coping-box-breathing`, `ref-coping-urge-surfing`, `ref-psychoed-craving-curve`. Not every Tier 1 response needs a citation — the ideal/on-track case resolves with acknowledgment alone; the complex/craving case is where one of these three entries actually gets surfaced.

`program_resource` and `crisis_resource` entries are never chosen reactively at this tier. A `program_resource` reference (e.g. the bridge scenario's scheduled intake) is set upstream in the check-in script from the patient's Recovery Plan, not selected in response to what the patient says in the moment. `crisis_resource` entries are reserved for Tier 3 — see that tier's note on how they're actually used.

**Escalation rule (up to Tier 2):** the same trigger or craving has now appeared in 3 consecutive check-ins, or a Recovery Plan goal target has been missed more than once in the current tracking window. A single occurrence — however uncomfortable — stays at Tier 1 as long as it's clearly described and resolves within the call.

**Trigger keywords.** Illustrative signal words for a first-pass read only — not a diagnostic keyword-match system. A real deployment needs actual language understanding; matching on these strings alone would misclassify constantly (sarcasm, negation, quoting someone else). Treat this list as a sense-check for a human reviewing NemoClaw's classification, not as the classifier itself.

`fine` · `okay` · `stuck to it` · `tempted` · `wanted a drink` · `stressful day` · `tired` · `craving` · `urge` · `manageable`

---

## Tier 2 — Moderate (Flag pattern)

**Action:** `flag_pattern_for_clinician()`. **Gated:** yes — OpenShell-gated.

**Trigger.** A pattern across multiple check-ins worth a clinician seeing at their next review, with nothing in the *current* call that's urgent on its own. This tier exists because a trend a single check-in can't see is still information — the trend, not any one day's answer, is what's being flagged.

**Example utterances (repetition is what qualifies these, not the content alone):**
- "Same thing again, wanted to drink after work." (third time this week)
- "I keep missing my Tuesday counseling session."
- "I haven't been doing the breathing thing you suggested — doesn't feel like it's working."

**Eligible reference-library categories:** same as Tier 1 — flagging is additive to the in-call response, not a replacement for it. The flag itself carries a plain-language summary of the pattern (e.g. "third mention of after-work craving this week"), never a diagnosis or a clinical interpretation of why it's happening.

**Escalation rule (up to Tier 3):** immediately, regardless of pattern history, the moment anything in the current response is ambiguous, concerning, or touches on safety — self-harm, violence, an inability to say what actually happened, or a response that doesn't track logically. A pattern being "only" Tier 2 material never overrides an in-the-moment safety signal in the same call.

**Trigger keywords.** Same caveat as Tier 1 — illustrative first-pass signal words, not a classifier. What makes these Tier 2 rather than Tier 1 is repetition across check-ins, not the words themselves; a single instance of any of these still reads as Tier 1.

`again` · `every time` · `keeps happening` · `missed` · `haven't been` · `not working` · `third time` · `slipping` · `hard to keep up` · `frustrated`

---

## Tier 3 — At Risk (Escalate)

**Action:** `escalate_to_clinician()`. **Gated:** no — always-open, never gated. This is the one action nothing else in the system is allowed to block.

**Trigger.** The response is ambiguous or concerning enough that confidently classifying it isn't possible, or it contains any explicit safety-relevant disclosure.

**Example utterances:**
- "I don't really want to talk about today." (flat, non-responsive)
- "I don't know, it doesn't matter anymore."
- Any disclosure touching on self-harm, violence, or being unsafe.

**Eligible reference-library categories:** `crisis_resource` entries (`ref-crisis-988`, `ref-crisis-ndvh`) may appear in the escalation record a clinician reviews — per those entries' own documented purpose, they're for clinician reference during escalation handling, never something Anchor decides to act on or read aloud to the patient itself. The AI's job at this tier is to route, not to counsel through the disclosure.

**Escalation rule:** none above this — Tier 3 is terminal. The rule that matters here runs the other direction: nothing self-resolves back down to Tier 1 or 2. Recovery Plan's `EscalationEvent.resolved` field is what closes an escalation out, and only a clinician sets it.

**Trigger keywords.** Same first-pass-only caveat as the other tiers, with one hard rule specific to this list: every term here is general distress/hopelessness/safety language — never a specific method, means, or instructional detail, under any framing. If a real response ever contains that kind of specificity, it escalates regardless of whether it matches a word on this list.

`hopeless` · `no point` · `can't do this anymore` · `scared of myself` · `not safe` · `give up` · `doesn't matter` · `can't stop thinking about it` · `hurt someone` · `don't want to be here`

---

## Summary

| Tier | Trigger (short) | Action | Gated? |
|---|---|---|---|
| 1 — Mild (Resolve in-conversation) | Single, situational, clearly-described response | Surface `coping_technique`/`psychoeducation` content as relevant | Ungated |
| 2 — Moderate (Flag pattern) | Same issue recurring across check-ins; nothing urgent right now | `flag_pattern_for_clinician()` | OpenShell-gated |
| 3 — At Risk (Escalate) | Ambiguous, concerning, or any safety-relevant disclosure | `escalate_to_clinician()` | Always-open, never gated |
