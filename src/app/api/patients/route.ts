import { handle } from "@/lib/http/respond";
import { featuredPatientId } from "@/lib/call/featured";
import { getStore } from "@/lib/store";

export async function GET() {
  return handle(async () => {
    const store = await getStore();
    const plans = await store.listPlans();
    const twins = await Promise.all(plans.map((p) => store.getActiveVoiceProfile(p.patientId)));
    const featured = await featuredPatientId(store);
    return {
      featured,
      patients: plans.map((p, i) => ({
        patientId: p.patientId,
        displayName: p.displayName,
        scenario: p.scenario,
        scenarioBlurb: p.scenarioBlurb,
        diagnosis: p.diagnosis,
        openEscalations: p.escalationHistory.filter((e) => !e.resolved).length,
        patternFlags: p.patternFlags.length,
        twin: twins[i]
          ? { active: true, consentedBy: twins[i]!.consent.consentedBy, source: twins[i]!.source ?? "enrolled" }
          : { active: false },
      })),
    };
  });
}
