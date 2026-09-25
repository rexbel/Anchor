import { handle } from "@/lib/http/respond";
import { getStore } from "@/lib/store";
import { ToolError, get_checkin_queue, propose_checkin_script, request_gated_action } from "@/lib/tools";

/** propose_checkin_script (ungated) then place_checkin_call held at the gate. */
export async function POST(_request: Request, ctx: RouteContext<"/api/queue/[id]/propose">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const store = await getStore();
    const entry = (await get_checkin_queue(store)).find((q) => q.id === id);
    if (!entry) throw new ToolError("Queue entry not found", 404);
    if (entry.status !== "due") throw new ToolError(`This check-in is already ${entry.status.replace("_", " ")}.`, 409);

    const proposal = await propose_checkin_script(store, entry.patientId);
    const gateRequest = await request_gated_action(store, {
      patientId: entry.patientId,
      action: "place_checkin_call",
      summary: `Scheduled ${entry.cadence} check-in. Script drafted by ${proposal.source === "model" ? "the local model" : "the clinic template"}.`,
      draft: proposal.draft,
      queueEntryId: entry.id,
    });
    return { gateRequest, source: proposal.source };
  });
}
