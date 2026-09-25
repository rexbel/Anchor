import { handle } from "@/lib/http/respond";
import { getStore } from "@/lib/store";
import { get_checkin_queue } from "@/lib/tools";

export async function GET() {
  return handle(async () => {
    const store = await getStore();
    const [queue, plans] = await Promise.all([get_checkin_queue(store), store.listPlans()]);
    return {
      queue: queue.map((q) => {
        const plan = plans.find((p) => p.patientId === q.patientId);
        return { ...q, displayName: plan?.displayName ?? q.patientId, scenario: plan?.scenario };
      }),
    };
  });
}
