import type { Metadata } from "next";

import { AuditLog } from "@/components/app/audit-log";

export const metadata: Metadata = { title: "Audit log | Anchor" };

export default function AuditPage() {
  return <AuditLog />;
}
