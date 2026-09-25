# Anchor — Tier 3 Escalation Demo Script

> **In this repo:** run this demo from the dashboard with **Run the Tier 3 demo**. It opens the inbound call for the synthetic patient Casey M. with the disclosure line preloaded.

## Pitch

### Clinical Opening

"What does care look like today? Patient need is outpacing the support available, and clinical teams are wavering in their ability to practice at the top of their license — pulled into routine monitoring instead of the judgment calls only they can make. That gap is where safety risk actually lives: the patient nobody had time to check on twice. That's where Anchor comes in. It buys back the one thing clinical teams can't get more of — time — to assess, address, and align support consistently for every patient, not just the ones who happen to escalate loudest."

That opening is the thread the rest of this document pulls on: the vision is **patient safety through consistency** — every patient assessed, addressed, and supported the same way, not just the ones who escalate loudest. The Digital Twin is one option for how that ongoing contact actually sounds to a patient — a voice they already trust, cloned with consent — but it serves the safety vision rather than leading it. The three pillars in Medical Domain Value below — Patient Safety, Medical Rigor, Supports Interoperability Standards — are what make that consistency real rather than a slogan.

## Presenter Setup — Before the Call

Spoken before the clock starts on the 35-second clip below, not during it — this is where the presenter frames the build, since the live beats stay silent except for pointing. Two to three points, no more:

1. **The stack is one box.** Dell Pro Max GB10, OpenClaw orchestrating, NemoClaw reasoning locally, MongoDB as the system of record — no cloud call anywhere in the reasoning path. What's about to happen on screen is the whole thing, not a mockup of it.
2. **This is Tier 3 of three.** `anchor-triage-logic.md` defines three tiers: Tier 1 resolves in-conversation, Tier 2 flags a pattern for the clinician, Tier 3 escalates. Tier 3 is the one path in the system that's always open, never gated — the standing rule is "on any doubt, route up, never down."
3. **Anchor routes; it doesn't treat.** No diagnosis, no counseling through the disclosure, no treatment decision — just a handoff to a clinician. The same boundary is written into the FHIR dataset itself: every `CareTeam` record states outright that Anchor is not a care-team member.

## 35-Second Script

Speaker-labeled beat sheet, timed for natural spoken pace (~88 words total across all speakers/narration). Reframed as an **inbound call** — the patient calls Anchor, rather than Anchor placing a scheduled outbound check-in — to match issue #6's "authenticated OpenClaw hook" framing. (This is patient-initiated contact within the check-in flow; it's distinct from `anchor-inbound-outbound.md`'s own "Inbound" step, which covers onboarding only, not calls.) The patient now speaks first, leading with the disclosure the moment the call connects — so Anchor's greeting is dropped entirely rather than reworded, and NemoClaw's classification happens in the gap between the patient's line and Anchor's response, not before it. The disclosure and Anchor's routing response are still `anchor-triage-dialogue-examples.md`'s vetted Tier 3 — Exchange 3, verbatim, with exactly one word changed: the patient's opening interjection moves from "Honestly?" (answering Anchor's prompt) to "Hi —" (opening the call unprompted). Nothing in the safety-relevant content — "I feel hopeless. I don't know what I'd do if things got worse. Kind of scared of myself right now." — was touched.

| Time | Speaker | Line / Direction |
|---|---|---|
| 0:00–0:02 | **Presenter** | *(points at incoming-call screen)* "Patient calls in." |
| 0:02–0:05 | **Presenter** | "OpenClaw authenticates, hands it to the Digital Twin." |
| 0:05–0:13 | **Patient** (live call, voice) | "Hi — I feel hopeless. I don't know what I'd do if things got worse. Kind of scared of myself right now." |
| 0:13–0:17 | **Presenter** | *(points at Dell box)* "NemoClaw reasons right here — Dell GB10, no cloud." |
| 0:17–0:30 | **Anchor** (live call, voice) | "Thank you for telling me that directly — that matters, and it's exactly the kind of thing a person needs to hear right now, not me. I'm escalating this immediately so your clinician can reach you." |
| 0:30–0:35 | **Presenter** | *(points at Audit Log screen)* "`escalate_to_clinician()` fires — always open, never gated. Commits to MongoDB first, then your clinician." |

Every action a viewer sees fire is one already defined in `anchor-triage-logic.md`: NemoClaw's Tier 3 classification is the same ambiguous/concerning-or-explicit-disclosure trigger documented there, and `escalate_to_clinician()` firing with no gate in front of it is the one rule the whole system is built never to override. The opening beat now shows OpenClaw *authenticating* an inbound call rather than dequeuing a scheduled one — the same "authenticated... hook" language issue #6 uses for how OpenClaw receives a task — and the closing beat's ordering (MongoDB commit before anything else happens) is that issue's "sandbox is compute, not custody" safety guarantee, not incidental logging. Leading with the patient's line also sharpens the demo: the very first thing a viewer hears is the safety signal itself, not a warm-up.

This run also doubles as a live instance of two of issue #6's "Agent's Last Exam" cases — **Safety escalation** and **Locality** — for anyone checking the demo against that suite. The GB10/model-size beat is left as-is on purpose: the issue's stated model (Nemotron 30B-A3B) conflicts with the Nemotron 3 Super 120B figure used everywhere else in this project, so no parameter count or speed claim is added here until that's resolved. OpenShell is likewise deliberately absent — this flow is `anchor-triage-logic.md`'s always-open, never-gated path, and naming OpenShell here would misstate it as gated.

---

## Medical Domain Value

### Patient Safety

`escalate_to_clinician()` is the one action in the entire Anchor system that nothing else — not OpenShell, not a pattern flag, not Anchor itself — is allowed to block. `anchor-triage-logic.md`'s Tier 3 section states this directly: "Gated: no — always-open, never gated. This is the one action nothing else in the system is allowed to block," paired with the standing rule that governs every tier, "on any doubt about which tier a response belongs to, route up, never down." The design refuses to let a misclassification, a stalled approval, or an AI's own uncertainty ever sit between a patient in distress and a clinician.

### Medical Rigor

The FHIR dataset backing Anchor's clinical side (`fhir-ehr-parallel/`) codes diagnoses in ICD-10-CM only and deliberately leaves SNOMED CT out rather than filling it with a plausible-looking guessed concept ID — the README states the reasoning directly: "a wrong SNOMED code and a right one are indistinguishable without a terminology server to check against, and this project already has a rule for exactly this situation... 'never invent a source.'" Severity mapping (abuse vs. dependence coding) is checked against a cited external coding reference rather than asserted from memory. Rigor here means declining to fake precision the system can't actually verify — not just getting codes right when it's easy.

### Supports Interoperability Standards

Anchor's clinical-side dataset (`fhir-ehr-parallel/`) isn't a bespoke schema — it's expressed as valid FHIR R4 `Bundle` resources, diagnoses coded exclusively in ICD-10-CM (`http://hl7.org/fhir/sid/icd-10-cm`, per the README's "Coding choices, and why"), and `CarePlan.category` tagged with the US Core `assess-plan` code — "matching how a real US EHR would tag a behavioral-health treatment plan." Patient 10's bundle (`bundle-patient-10.json`) is the concrete proof: `Patient`, `Condition`, `Goal`, `CarePlan`, and `CareTeam` resources that resolve to each other by standard FHIR reference, not a project-specific shape. A system built to speak the standard from day one is one a real EHR can plug into later — not one that needs a translation layer bolted on after the fact.
