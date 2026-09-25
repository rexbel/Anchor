import { handle } from "@/lib/http/respond";
import { getStore } from "@/lib/store";

export async function GET() {
  return handle(async () => {
    const store = await getStore();
    const [requests, plans] = await Promise.all([store.listGateRequests(), store.listPlans()]);
    return {
      requests: requests.map((r) => ({
        ...r,
        displayName: plans.find((p) => p.patientId === r.patientId)?.displayName ?? r.patientId,
      })),
    };
  });
}
