"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, type AuditRow, type PatientSummary } from "@/lib/client/api";

const KIND_LABEL: Record<AuditRow["kind"], string> = {
  checkin_received: "Turn received",
  triage_scored: "Triage scored",
  escalation_committed: "Escalation committed",
  handoff_sent: "Handoff sent",
  handoff_queued_locally: "Handoff queued",
  gate_requested: "Gate requested",
  gate_decision: "Gate decision",
  action_executed: "Action executed",
  escalation_resolved: "Escalation resolved",
  demo_reset: "Demo reset",
  voice_enrolled: "Twin voice enrolled",
  voice_updated: "Twin voice updated",
  voice_revoked: "Twin voice revoked",
};

export function AuditLog() {
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [patientId, setPatientId] = useState("");
  const [events, setEvents] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    try {
      setEvents(null);
      const res = await api.audit(id || undefined);
      setEvents(res.events);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the audit log.");
      setEvents([]);
    }
  }, []);

  useEffect(() => {
    api.patients().then((r) => setPatients(r.patients)).catch(() => undefined);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(patientId);
  }, [load, patientId]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Audit log</h1>
        <p className="max-w-3xl text-muted-foreground">
          Every call transcript, triage score, escalation, handoff, and gate decision, in commit order. Sequence numbers
          prove an escalation was committed before its handoff was sent.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="patient-filter">Patient</Label>
          <select
            id="patient-filter"
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="">All patients</option>
            {patients.map((p) => (
              <option key={p.patientId} value={p.patientId}>
                {p.displayName}
              </option>
            ))}
          </select>
        </div>
        <Button variant="outline" onClick={() => void load(patientId)}>
          <RefreshCw /> Refresh
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Audit log didn&apos;t load</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16 pl-4">Seq</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Event</TableHead>
              <TableHead className="pr-4">Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events === null ? (
              <TableRow>
                <TableCell colSpan={5} className="p-4">
                  <Skeleton className="h-24" />
                </TableCell>
              </TableRow>
            ) : events.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="p-8 text-center text-muted-foreground">
                  No events yet. Run a check-in from the dashboard and they&apos;ll appear here in commit order.
                </TableCell>
              </TableRow>
            ) : (
              events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="pl-4 font-mono text-xs">{e.seq}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(e.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{e.displayName}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        e.escalationFlag ? "tier3" : e.kind === "gate_requested" || e.kind === "gate_decision" ? "tier2" : "outline"
                      }
                    >
                      {KIND_LABEL[e.kind]}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-xl pr-4 text-sm">
                    {e.detail}
                    {e.transcript && e.kind === "checkin_received" ? (
                      <span className="mt-1 block text-muted-foreground">&ldquo;{e.transcript}&rdquo;</span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
