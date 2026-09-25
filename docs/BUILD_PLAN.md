# Anchor: Build Plan

> **Reconstructed.** The original `anchor-build-plan.md` from the hackathon planning workspace was lost. This version is rebuilt from the documents that survived: the triage logic, the dialogue examples, the inbound/outbound spec, the FHIR dataset notes, the architecture notes, and the Tier 3 demo script. It uses the same structure as the hackathon-build-planner template. Checkboxes show the state of this repository.

## 1. Brief

| Item | Value |
|---|---|
| Event | Dell x NVIDIA AI Hackathon NYC (one-day build). **Result: won.** |
| Mandated stack | OpenClaw, NVIDIA NemoClaw, NVIDIA OpenShell, running 100% locally on a Dell Pro Max with NVIDIA GB10 |
| Team additions | MongoDB as the system of record; a local voice layer (STT and TTS) |
| Track | Healthcare: an always-on business agent |
| Hard rule | The final demo runs on the box. Nothing leaves the device. |

## 2. Option scoring (summary)

Anchor was scored against the other healthcare candidates with the standard rubric (user impact 25%, demo clarity 20%, build feasibility 20%, meaningful AI use 15%, differentiation 10%, data readiness 10%). It tied for first at **4.30 weighted**, on the condition that the one-day build held the scope cut in section 4. It cleared both decision floors (demo clarity at least 4, feasibility at least 3.5).

## 3. Product concept

**One-sentence pitch.** Anchor helps clinical teams in substance use disorder care keep every patient supported between visits by running clinician-governed voice check-ins, in a voice the patient already trusts, that route any safety signal to a human immediately.

**Narrative.** Patient need outpaces the support available, and clinical teams get pulled into routine monitoring instead of practicing at the top of their license. That gap is where safety risk lives: the patient nobody had time to check on twice. Anchor runs the routine check-ins, classifies each response locally, and hands anything concerning to a clinician, while the clinician stays in control through an approval gate and owns every resolution.

**Core hypothesis.** If we provide consistent, plan-grounded check-ins between visits, then clinical teams can assess, address, and align support for every patient, because routine monitoring no longer competes with clinical judgment for their time.

**Principles.** One workflow. Human control over AI output. Evidence over claims. Fast comprehension. Graceful failure. No dead ends. Route up, never down.

## 4. MVP scope

**Core journey**

1. A check-in comes due in the queue, or the patient calls in.
2. The clinician-authored Recovery Plan is read (`get_recovery_plan`).
3. The patient's response is classified on the box: a deterministic floor plus the local model.
4. The result is shown with its rationale, evidence, and Anchor's spoken reply.
5. The action happens: resolve in conversation (Tier 1), hold a pattern flag at the OpenShell gate (Tier 2), or escalate with no gate (Tier 3).
6. The impact is visible: audit rows, the clinician queue, measured timings.

**Must have**

- [x] Landing dashboard with pitch, primary CTA, seeded scenarios, and one measured impact metric
- [x] One input flow (the check-in), typed or dictated
- [x] One real transformation (three-tier triage) with structured output
- [x] A human review step (the clinician queue and the OpenShell gate)
- [x] Loading, empty, success, and error states
- [x] Seeded demo scenarios (ideal, complex, edge, bridge) and a reset button
- [x] Presentation-ready responsive layout
- [x] A concise How it works page

**Should have**

- [x] Several example scenarios with vetted sample lines
- [x] Basic history (recent check-ins in the plan panel)
- [x] A simple impact metric, labeled as measured
- [ ] Export or copy of a check-in summary
- [ ] Dark mode toggle (tokens exist; no toggle yet)

**Non-goals**

- Diagnosis, medication guidance, treatment decisions, or crisis counseling
- Full authentication and RBAC (the clinician name is typed and audited)
- A HIPAA compliance claim (local processing is a head start, not a guarantee)
- Real EHR or FHIR integration beyond the single crosswalk demo
- Inbound onboarding (referral ingestion, voice-sample capture) as a working flow
- Telephony. Calls are simulated in the browser.

## 5. UX and architecture

| Screen | Route | Purpose |
|---|---|---|
| Landing and dashboard | `/` | Pitch, scenarios, check-in queue, measured metrics, adapter status |
| Input | `/checkin/[patientId]` (Call step) | Direction, patient response, vetted sample lines, dictation |
| Processing | same route (Process step) | The four real pipeline stages with measured timings |
| Result | same route (Result step) | The judge moment: tier, reply in the Digital Twin voice, escalation or gate state, evidence |
| Confirmation and impact | same route (Done step) | What changed, what happens next, measured timings |
| Clinician queue | `/clinician` | Escalations (never gated) and the OpenShell gate (approve, edit, reject) |
| Audit log | `/audit` | Every event in commit order |

**Vertical slice.** UI input, Zod validation, route handler, check-in pipeline, tools, model adapter, schema validation, normalized result, UI result.

**Tools**

| Tool | Class |
|---|---|
| `get_checkin_queue`, `get_recovery_plan`, `get_bh_library`, `propose_checkin_script` | Read only, ungated |
| `place_checkin_call`, `flag_pattern_for_clinician` | OpenShell-gated |
| `escalate_to_clinician` | Always open, never gated |

**Safety ordering for escalation.** Score the turn, commit the escalation to MongoDB (journaled), then send only a bounded review task to the authenticated OpenClaw hook. The sandbox is compute, not custody.

**Fallbacks.** Every external dependency has a short timeout, a useful error, and a fallback: deterministic triage when the model is down, the seeded memory store when MongoDB is down, browser speech when Kokoro is down, and the local clinician queue when the OpenClaw hook is down.

## 6. AI behavior

The model reads and classifies. It never writes what the patient hears. Replies come from vetted lines in `docs/triage-dialogue-examples.md`, and Tier 3 replies are used verbatim. The model's output is validated with Zod, retried once on invalid output, and replaced by the deterministic result if the retry fails. The model can raise a tier above the deterministic floor but never lower it. The system prompt is in `src/lib/ai/prompts.ts`.

## 7. Build sequence

- [x] **Phase 0, decision and setup.** Inputs, scoring, concept, journey, repo, seeded cases.
- [x] **Phase 1, static vertical slice.** All screens and navigation on seeded data.
- [x] **Phase 2, core intelligence.** Schemas, prompts, provider adapter, orchestration, validation, timeouts, fallbacks.
- [x] **Phase 3, product polish.** UI states, evidence view, reset, viewport tests, labels and keyboard behavior.
- [ ] **Phase 4, submission and demo prep.** README, screenshots, demo script, CI. *Hosted deploy pending; see `docs/DEPLOY_GB10.md`.*

Checkpoints: Concept Lock, Static Demo, Live Capability, Demo Lock.

## 8. Demo story

Use `docs/demo-script.md`. The **judge moment** is the Tier 3 inbound call: the patient's first words are the disclosure, `escalate_to_clinician()` fires with no gate, and the audit log shows the MongoDB commit landing before the OpenClaw handoff.

**Likely judge questions**

- *Why is AI necessary?* Reading free-text responses in context is language understanding. Keywords alone misread negation and sarcasm, which is why they set only a floor.
- *How reliable is it?* The model can't lower a tier, escalation never waits on it, and every safety property is an automated test.
- *What's real and what's simulated?* Triage, routing, the gate, and the audit trail are real. Telephony is simulated, and the patients are synthetic.
- *Who adopts this?* Outpatient SUD programs and bridge periods between a disclosure and a first appointment.

## 9. Post-hackathon opportunities

- Resolve Recovery Plans live from FHIR `CarePlan` instead of a separate store
- Telephony integration (inbound and outbound calls)
- Inbound onboarding: referral ingestion and consented voice-sample capture for the Digital Twin
- Embedding retrieval over a larger reference library (Bonsai embeddings on the GB10)
- Real authentication, roles, and per-clinic tenancy
- Clinical validation of the triage rules with a care team before any real use
