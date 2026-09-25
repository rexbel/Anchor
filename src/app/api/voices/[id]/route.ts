import { handle, readJson } from "@/lib/http/respond";
import { getStore } from "@/lib/store";
import { revoke_twin_voice, update_self_hearing } from "@/lib/voice/twin";

/** PATCH { enabled?, lowShelfDb?, highShelfDb?, reverbMix? } → updated profile. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/voices/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return update_self_hearing(await getStore(), id, await readJson(request));
  });
}

/** DELETE → consent withdrawn; the sample is deleted. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/voices/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return revoke_twin_voice(await getStore(), id);
  });
}
