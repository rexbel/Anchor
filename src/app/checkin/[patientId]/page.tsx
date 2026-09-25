import { CheckinFlow } from "@/components/app/checkin-flow";

export default async function CheckinPage(props: PageProps<"/checkin/[patientId]">) {
  const { patientId } = await props.params;
  const { direction } = await props.searchParams;
  return (
    <CheckinFlow
      key={patientId}
      patientId={patientId}
      initialDirection={direction === "inbound" ? "inbound" : "outbound"}
    />
  );
}
