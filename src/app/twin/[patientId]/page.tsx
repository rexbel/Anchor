import type { Metadata } from "next";

import { TwinVoice } from "@/components/app/twin-voice";

export const metadata: Metadata = { title: "Digital Twin voice | Anchor" };

export default async function TwinPage(props: PageProps<"/twin/[patientId]">) {
  const { patientId } = await props.params;
  return <TwinVoice key={patientId} patientId={patientId} />;
}
