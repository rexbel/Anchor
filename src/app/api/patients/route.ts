import { handle } from "@/lib/http/respond";
import { getStore } from "@/lib/store";

export async function GET() {
  return handle(async () => {
    const store = await getStore();
    const plans = await store.listPlans();
    return {
      patients: plans.map((p) => ({
        patientId: p.patientId,
        displayName: p.displayName,
        scenario: p.scenario,
        scenarioBlurb: p.scenarioBlurb,
        diagnosis: p.diagnosis,
        openEscalations: p.escalationHistory.filter((e) => !e.resolved).length,
        patternFlags: p.patternFlags.length,
      })),
    };
  });
}
