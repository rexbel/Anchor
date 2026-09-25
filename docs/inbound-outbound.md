# Anchor — Inbound / Outbound Process States

> **In this repo:** the data contracts described here live in `src/lib/domain/schemas.ts`, and both stores implement them (`src/lib/store/memory.ts` and `src/lib/store/mongo.ts`). The Audit Log schema this document calls an open item is now defined as `AuditEventSchema`. References to `anchor-architecture.html` and `anchor-data-stores/` point to the original planning workspace.

Two named pipelines. Inbound gets a patient into Anchor; Outbound is what Anchor does once they're in. Everything built this session so far — the architecture diagram, the data stores, the FHIR dataset — is Outbound or Outbound-adjacent. This document names Inbound explicitly for the first time and shows where the two connect.

---

## Inbound — patient onboarding

**Referral ingested with insurance and demographic info → Patient profile created in the EHR (DB) → Patient sent an invite to record their voice for the Digital Twin → voice recorded and stored = Digital Twin created.**

| Step | What happens |
|---|---|
| 1. Referral ingested | A referral arrives with insurance and demographic info attached — the trigger event that starts onboarding. |
| 2. Patient profile created in the EHR (DB) | The referral's demographic and insurance info becomes a structured patient record: `Patient`, an initial `Condition` (the SUD diagnosis driving the referral), and a `CarePlan`/`Goal` shell a clinician will fill in. |
| 3. Invite sent to record voice for the Digital Twin | The patient is asked, explicitly, to record a reference voice sample and consent to it being cloned. |
| 4. Voice recorded and stored = Digital Twin | The reference sample is captured and becomes the XTTS-v2 `speaker_wav` input — the artifact that *is* the Digital Twin. |

---

## Outbound — patient check-in

**Digital Twin → patient check-in framed around the care plan.**

`anchor-architecture.html` is the source of truth for Outbound's full internals (the AI orchestration, the voice pipeline, the gate logic). What follows is the same flow explained the other way — in terms of what data moves, what gets read, what gets written — for whoever is building or standing up the database layer underneath it. Nobody on the DB side needs to understand NemoClaw or XTTS-v2 to build this correctly; they need to know what tables exist, what shape they're in, and who's allowed to write to them.

**What triggers a run.** A Check-in Queue entry comes due — a schedule table keyed by `patientId`, with a `dueAt` timestamp and a `cadence` (daily / every-other-day / weekly, matching `RecoveryPlan.checkinCadence`). Nothing else needs to exist for this step; it's a straightforward due-date query.

**Two reads, both read-only, both already contract-defined.** `get_recovery_plan(patientId)` and `get_bh_library(filter)` are implemented right now in `anchor-data-stores/lib/data-store/` against flat JSON seed files (`recovery-plans.seed.json`, `bh-reference-library.seed.json`). The field shapes are locked in `anchor-data-stores/types/` — `RecoveryPlan` (goals, known triggers, consent record, program match, escalation history) and `ReferenceLibraryEntry` (coping techniques, program resources, crisis resources). A DB team's job is to back these exact function signatures with a real table or collection, not to redesign what they return — NemoClaw's prompt construction and its Zod validation both depend on the shape staying stable.

**Two writes, both gated, both already contract-defined.** `appendEscalationEvent()` and `updateIntakeStatus()` (same file) are the only two functions allowed to mutate a Recovery Plan, and both are meant to be called only from behind the OpenShell approval gate — never directly by anything the AI drafts on its own. Same rule applies here: implement these signatures against real storage, don't add new write paths around them.

**One store that's named but has no schema yet — this is the DB team's open item.** The architecture diagram calls for an Audit Log ("every call transcript, escalation, and gate decision") but no schema exists for it anywhere in this session's work. At minimum it needs `patientId`, `timestamp`, `transcript`, `gateDecision`, and `escalationFlag`. This is the one piece of Outbound's data layer that's a genuine blank page, not a migration of something already defined.

**One open architecture decision, not yet a gap to just fill in.** Recovery Plan reads from its own seed file today, independent of the FHIR `Patient`/`CarePlan` bundles in `fhir-ehr-parallel/` — the two are connected only by a shared identifier (`demo-patient-bridge`), not a real read-through. Whether Recovery Plan should become a live projection of the FHIR `CarePlan` or stay a separate operational table kept in sync with it is a real design call for whoever owns the DB layer, not something this document should decide on their behalf.

---

## The handoff

Inbound's output is Outbound's input, at a specific, nameable point: Inbound step 4 (Digital Twin created) is the same artifact `anchor-architecture.html`'s Outbound flow consumes as "Cloned-voice TTS render." Inbound step 2 (patient profile in the EHR) is what `get_recovery_plan()` should eventually resolve against — right now `anchor-data-stores/data/recovery-plans.seed.json` is seeded independently of the FHIR bundles, connected only by one shared identifier (`demo-patient-bridge`) rather than a real read-through. Closing that gap — Recovery Plan resolving live from the FHIR record instead of its own seed file — is the natural next integration point once Inbound has an actual referral-ingestion step to originate from.
