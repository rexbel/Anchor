import { handle } from "@/lib/http/respond";
import { getStore } from "@/lib/store";

export async function GET() {
  return handle(async () => {
    const store = await getStore();
    const [plans, library] = await Promise.all([store.listPlans(), store.getLibrary({ categories: ["crisis_resource"] })]);
    const escalations = plans
      .flatMap((p) =>
        p.escalationHistory.map((e) => ({ ...e, displayName: p.displayName, clinician: p.clinician })),
      )
      .sort((a, b) => b.at.localeCompare(a.at));
    return { escalations, clinicianReference: library };
  });
}
