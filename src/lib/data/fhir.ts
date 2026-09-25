import bundle10 from "@/data/fhir/bundle-patient-10.json";

/**
 * Minimal FHIR R4 reader for the crosswalk demo.
 *
 * Anchor's Recovery Plan store is keyed by patientId. For the bridge scenario,
 * the FHIR Patient.identifier value is the same id (`demo-patient-bridge`), so
 * the authoritative diagnosis is read from the FHIR Condition resource instead
 * of being duplicated in the plan. The dataset is synthetic and tagged as such
 * in Patient.meta.tag.
 */

type Coding = { system?: string; code?: string; display?: string };
type Resource = {
  resourceType: string;
  id: string;
  identifier?: { system?: string; value?: string }[];
  code?: { coding?: Coding[]; text?: string };
  description?: { text?: string };
  activity?: { detail?: { description?: string } }[];
  meta?: { tag?: Coding[] };
  note?: { text?: string }[];
};
type Bundle = { resourceType: "Bundle"; entry: { resource: Resource }[] };

const BUNDLES: Record<string, Bundle> = {
  "bundle-patient-10.json": bundle10 as unknown as Bundle,
};

export type FhirSummary = {
  bundle: string;
  patientIdentifier: string;
  synthetic: boolean;
  diagnosis: { system: "ICD-10-CM"; code: string; display: string } | null;
  goals: string[];
  carePlanActivities: string[];
  careTeamNote: string | null;
};

const ICD10 = "http://hl7.org/fhir/sid/icd-10-cm";

export function readFhirSummary(bundleName: string): FhirSummary | null {
  const bundle = BUNDLES[bundleName];
  if (!bundle || bundle.resourceType !== "Bundle") return null;
  const resources = bundle.entry.map((e) => e.resource);
  const patient = resources.find((r) => r.resourceType === "Patient");
  const condition = resources.find((r) => r.resourceType === "Condition");
  const coding = condition?.code?.coding?.find((c) => c.system === ICD10);
  const careTeam = resources.find((r) => r.resourceType === "CareTeam");

  return {
    bundle: bundleName,
    patientIdentifier: patient?.identifier?.[0]?.value ?? "unknown",
    synthetic: Boolean(patient?.meta?.tag?.some((t) => t.code === "synthetic")),
    diagnosis:
      coding?.code && coding.display
        ? { system: "ICD-10-CM", code: coding.code, display: coding.display }
        : null,
    goals: resources
      .filter((r) => r.resourceType === "Goal")
      .map((g) => g.description?.text ?? "")
      .filter(Boolean),
    carePlanActivities: resources
      .filter((r) => r.resourceType === "CarePlan")
      .flatMap((cp) => cp.activity ?? [])
      .map((a) => a.detail?.description ?? "")
      .filter(Boolean),
    careTeamNote: careTeam?.note?.[0]?.text ?? null,
  };
}
