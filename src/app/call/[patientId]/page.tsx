import type { Metadata } from "next";

import { LiveCall } from "@/components/app/live-call";

export const metadata: Metadata = { title: "Live call | Anchor" };

export default async function CallPage(props: PageProps<"/call/[patientId]">) {
  const { patientId } = await props.params;
  const { direction } = await props.searchParams;
  return <LiveCall key={patientId} patientId={patientId} initialDirection={direction === "inbound" ? "inbound" : "outbound"} />;
}
