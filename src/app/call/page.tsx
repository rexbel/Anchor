import { redirect } from "next/navigation";

import { featuredPatientId } from "@/lib/call/featured";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** "Live call" in the header: open the featured patient's call screen. */
export default async function CallIndex() {
  redirect(`/call/${await featuredPatientId(await getStore())}`);
}
