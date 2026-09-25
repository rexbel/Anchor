import { handle } from "@/lib/http/respond";
import { getStore } from "@/lib/store";
import { ToolError } from "@/lib/tools";
import { seedDemoTwin } from "@/lib/voice/demo-twin";

export async function POST() {
  return handle(async () => {
    if (process.env.ANCHOR_DEMO_MODE === "false") {
      throw new ToolError("Reset is disabled outside demo mode.", 403);
    }
    const store = await getStore();
    await store.reset();
    await store.appendAudit({
      patientId: "system",
      kind: "demo_reset",
      detail: "Demo data reset to the seeded scenarios.",
      escalationFlag: false,
    });
    // The reset clears voices too; put the deployment's consented demo voice back.
    await seedDemoTwin(store);
    return { ok: true };
  });
}
