import { z } from "zod";

import { handle, readJson } from "@/lib/http/respond";
import { getStore } from "@/lib/store";
import { decide_gate } from "@/lib/tools";

const DecisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  clinician: z.string().trim().min(1, "Enter the approving clinician's name."),
  draft: z.string().max(1000).optional(),
  note: z.string().max(500).optional(),
});

export async function POST(request: Request, ctx: RouteContext<"/api/gate/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const body = DecisionSchema.parse(await readJson(request));
    return decide_gate(await getStore(), { id, ...body });
  });
}
