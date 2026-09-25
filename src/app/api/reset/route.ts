import { handle } from "@/lib/http/respond";
import { getStore } from "@/lib/store";
import { ToolError } from "@/lib/tools";

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
    return { ok: true };
  });
}
