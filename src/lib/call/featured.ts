import type { AnchorStore } from "@/lib/store/types";

export const DEFAULT_FEATURED_PATIENT = "demo-patient-complex";

/**
 * The patient the demo leads with: the deployment's demo twin if one is
 * configured, else any patient with an enrolled Digital Twin, else the
 * after-work-cravings scenario (it exercises Tier 1 and Tier 2 in one call).
 */
export async function featuredPatientId(store: AnchorStore, env: { ANCHOR_DEMO_TWIN_PATIENT?: string } = process.env as never) {
  const plans = await store.listPlans();
  const ids = plans.map((p) => p.patientId);
  const configured = env.ANCHOR_DEMO_TWIN_PATIENT?.trim();
  if (configured && ids.includes(configured)) return configured;
  for (const id of ids) {
    if (await store.getActiveVoiceProfile(id)) return id;
  }
  return ids.includes(DEFAULT_FEATURED_PATIENT) ? DEFAULT_FEATURED_PATIENT : (ids[0] ?? DEFAULT_FEATURED_PATIENT);
}
