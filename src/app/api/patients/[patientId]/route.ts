import { readFhirSummary } from "@/lib/data/fhir";
import { handle } from "@/lib/http/respond";
import { getStore } from "@/lib/store";
import { get_bh_library, get_recovery_plan } from "@/lib/tools";

export async function GET(_request: Request, ctx: RouteContext<"/api/patients/[patientId]">) {
  return handle(async () => {
    const { patientId } = await ctx.params;
    const store = await getStore();
    const plan = await get_recovery_plan(store, patientId);
    const [history, copingPlan] = await Promise.all([
      store.listCheckins(patientId, 10),
      get_bh_library(store, { ids: plan.copingPlanReferenceIds }),
    ]);
    return {
      plan,
      history,
      copingPlan,
      fhir: plan.fhirBundle ? readFhirSummary(plan.fhirBundle) : null,
    };
  });
}
