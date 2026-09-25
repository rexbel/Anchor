import { z } from "zod";

import { handle, readJson } from "@/lib/http/respond";
import { getStore } from "@/lib/store";
import { resolve_escalation } from "@/lib/tools";

const ResolveSchema = z.object({
  patientId: z.string().min(1),
  clinician: z.string().trim().min(1, "Enter the resolving clinician's name."),
  note: z.string().max(500).default(""),
});

export async function POST(request: Request, ctx: RouteContext<"/api/escalations/[id]/resolve">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const body = ResolveSchema.parse(await readJson(request));
    return resolve_escalation(await getStore(), { escalationId: id, ...body });
  });
}
