import { getStore } from "@/lib/store";

/** The enrolled reference sample, for playback on the enrollment page. */
export async function GET(_request: Request, ctx: RouteContext<"/api/voices/[id]/sample">) {
  const { id } = await ctx.params;
  const store = await getStore();
  const profile = await store.getVoiceProfile(id);
  const sample = profile?.status === "active" ? await store.getVoiceSample(id) : null;
  if (!sample) return Response.json({ error: "No sample for that voice." }, { status: 404 });
  return new Response(new Blob([sample as BlobPart], { type: "audio/wav" }), {
    headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" },
  });
}
