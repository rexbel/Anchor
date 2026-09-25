# FHIR EHR Parallel Dataset — Anchor Build

> **In this repo:** only `bundle-patient-10.json` (the bridge scenario) is included, at `src/data/fhir/`. It is read at runtime by `src/lib/data/fhir.ts` to resolve the bridge patient's diagnosis. The generator and bundles 1 to 9 from the planning workspace are not part of this repo.

10 synthetic behavioral-health patient records, expressed as valid FHIR R4 `Bundle` resources, each with a documented substance use disorder (SUD) diagnosis and a linked care plan. This is a **parallel** dataset to Anchor's own app-specific data store (`anchor-data-stores/` — `Recovery Plan` and `Behavioral Health Reference Library`): it represents the clinical-EHR side a real FHIR integration would eventually read from, not something wired into the live hackathon demo build itself.

## What's in here

- `generate_fhir_ehr.py` — the generator. Builds all 10 bundles deterministically and validates referential integrity (every `subject`/`goal` reference resolves to a resource that actually exists in the same bundle) before writing anything.
- `bundle-patient-01.json` through `bundle-patient-10.json` — one FHIR R4 `Bundle` (type `collection`) per patient, containing that patient's `Patient`, `Condition` (one or more), `Goal`, `CarePlan`, and `CareTeam` resources.

## Every record is synthetic

Every name, MRN, birth date, and address is fabricated. Each `Patient` resource is tagged `meta.tag` with `urn:anchor:demo-data / synthetic` so this is machine-detectable, not just a README claim. Clinician names are marked "(seeded/fictional)" inline. No real PHI appears anywhere in this dataset — treat any resemblance to a real person as coincidental and unintentional.

## Coding choices, and why

**Diagnoses use ICD-10-CM only** (`http://hl7.org/fhir/sid/icd-10-cm`). SNOMED CT codes are deliberately left out rather than filled in with a plausible-looking numeric concept ID — a wrong SNOMED code and a right one are indistinguishable without a terminology server to check against, and this project already has a rule for exactly this situation (Anchor's own AI behavior spec: "never invent a source"). A real integration would resolve SNOMED codes through a terminology service rather than hardcode guessed IDs; that step is intentionally left as a TODO, not faked.

**Severity mapping** follows standard ICD-10-CM coding guidance: DSM-5 mild use disorder maps to the ICD-10-CM "abuse" code (`x.10`), moderate/severe maps to the "dependence" code (`x.20`). Verified against current substance-use coding references — see Sources below.

**"Polysubstance" is two Condition resources, not one code.** ICD-10-CM/DSM-5 dropped the old "polysubstance dependence" category; current practice codes each substance separately. Patient 4 (alcohol + opioid, co-occurring) reflects that.

**`CarePlan.category`** uses the US Core `assess-plan` code, matching how a real US EHR would tag a behavioral-health treatment plan.

## The Anchor boundary, encoded directly in the data

Every `CareTeam` resource includes an explicit note: **Anchor is not a CareTeam member.** It's a patient-facing check-in tool that reads a patient's `CarePlan`/`Goal` resources — it doesn't diagnose, doesn't decide treatment, and isn't part of the clinical team. This isn't just a README claim either; it's a note on every single generated resource, so anyone inspecting the data (including a judge) sees the boundary enforced in the record itself, not just asserted in a slide.

## Patient 10 — the post-disclosure bridge scenario

Patient 10's `identifier.value` is set to `demo-patient-bridge` — the exact same `patientId` used in `anchor-data-stores/data/recovery-plans.seed.json`'s `plan-demo-bridge` entry. This is the crosswalk point: in a real system, Anchor's own Recovery Plan store would resolve a patient by this shared identifier back to their FHIR record to pull the authoritative diagnosis and care plan, rather than duplicating clinical facts in two places. Patients 1–9 are a broader synthetic population and aren't individually crosswalked to the other seeded demo scenarios (`ideal`/`complex`/`edge`), which are UI-demo constructs rather than full patient records.

## Validating this yourself

```bash
python3 generate_fhir_ehr.py
```

Regenerates all 10 files and re-runs the referential-integrity check (every reference between resources in a bundle resolves to a resource that exists in that same bundle). It exits non-zero and prints every broken reference if anything fails — it does not silently produce a partially-broken bundle.

## Sources

- [ICD-10-CM substance use disorder coding guide](https://codeicd.org/guides/substance-use-coding/) — verified F10–F15 abuse/dependence code pairs and the abuse-vs-dependence severity convention used above.
