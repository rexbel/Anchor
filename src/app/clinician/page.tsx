import type { Metadata } from "next";

import { ClinicianConsole } from "@/components/app/clinician-console";

export const metadata: Metadata = { title: "Clinician queue | Anchor" };

export default async function ClinicianPage(props: PageProps<"/clinician">) {
  const { tab } = await props.searchParams;
  return <ClinicianConsole initialTab={tab === "gate" ? "gate" : "escalations"} />;
}
