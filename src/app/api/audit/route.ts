import { handle } from "@/lib/http/respond";
import { getStore } from "@/lib/store";

export async function GET(request: Request) {
  return handle(async () => {
    const url = new URL(request.url);
    const patientId = url.searchParams.get("patientId") ?? undefined;
    const store = await getStore();
    const [events, plans] = await Promise.all([store.listAudit({ patientId, limit: 300 }), store.listPlans()]);
    return {
      events: events.map((e) => ({
        ...e,
        displayName: plans.find((p) => p.patientId === e.patientId)?.displayName ?? e.patientId,
      })),
    };
  });
}
