"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Headphones, ListChecks, PhoneIncoming, PhoneOutgoing, RotateCcw, Send, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { StatusStrip } from "@/components/app/status-strip";
import { TierBadge } from "@/components/app/tier";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, type Metrics, type PatientSummary, type QueueRow } from "@/lib/client/api";

const SCENARIO_META: Record<PatientSummary["scenario"], { title: string; tier: 1 | 2 | 3; direction: "inbound" | "outbound" }> = {
  edge: { title: "Inbound disclosure", tier: 3, direction: "inbound" },
  complex: { title: "After-work cravings", tier: 1, direction: "outbound" },
  bridge: { title: "Waiting for intake", tier: 2, direction: "outbound" },
  ideal: { title: "On track", tier: 1, direction: "outbound" },
};
const ORDER: PatientSummary["scenario"][] = ["edge", "complex", "bridge", "ideal"];

function timeUntil(iso: string) {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (Math.abs(mins) < 1) return "now";
  if (mins < 0) return `${Math.abs(mins) >= 60 ? `${Math.round(-mins / 60)} h` : `${-mins} min`} overdue`;
  return `in ${mins >= 60 ? `${Math.round(mins / 60)} h` : `${mins} min`}`;
}

export function Dashboard() {
  const [patients, setPatients] = useState<PatientSummary[] | null>(null);
  const [featuredId, setFeaturedId] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueRow[] | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const [p, q, m] = await Promise.all([api.patients(), api.queue(), api.metrics()]);
      setPatients(p.patients);
      setFeaturedId(p.featured);
      setQueue(q.queue);
      setMetrics(m);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the dashboard.");
    }
  }, []);

  useEffect(() => {
    // Initial fetch on mount; state updates happen after the awaited calls.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function propose(row: QueueRow) {
    setBusy(row.id);
    try {
      const res = await api.propose(row.id);
      toast.success("Script drafted and held at the OpenShell gate", {
        description: `A clinician must approve before the call to ${row.displayName} is placed. Drafted by ${res.source === "model" ? "the local model" : "the clinic template"}.`,
        action: { label: "Review", onClick: () => router.push("/clinician?tab=gate") },
      });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not draft the script.");
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    setBusy("reset");
    try {
      await api.reset();
      toast.success("Demo reset to the seeded scenarios.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reset failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-end">
        <div className="flex flex-col gap-4">
          <Badge variant="outline" className="gap-1.5">
            <span className="size-1.5 rounded-full bg-brand" aria-hidden /> Dell Pro Max with NVIDIA GB10 · 100% local
          </Badge>
          <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl">
            Your agentic life alert. Care gaps closed locally.
          </h1>
          <p className="max-w-2xl text-pretty text-lg text-muted-foreground">
            Patient need is outpacing the support available. Anchor gives clinical teams back the time to assess,
            address, and align support consistently for every patient, through check-ins in a voice the patient
            already trusts, and a safety path nothing is allowed to gate off.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg" variant="brand">
              <Link href="/call">
                <Headphones /> Start a live call
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/call/demo-patient-edge?direction=inbound">
                <PhoneIncoming /> Tier 3 inbound demo
              </Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link href="/how-it-works">How it works</Link>
            </Button>
          </div>
        </div>
        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Measured this session</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-4">
            {metrics ? (
              <>
                <Stat label="Turns handled" value={String(metrics.turnsHandled)} />
                <Stat label="Escalations committed" value={String(metrics.escalationsCommitted)} />
                <Stat
                  label="Median time to escalation"
                  value={metrics.medianMsToEscalation === null ? "none yet" : `${metrics.medianMsToEscalation} ms`}
                />
              </>
            ) : (
              [0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)
            )}
          </CardContent>
          <CardFooter className="text-xs text-muted-foreground">
            From the audit log: turn received to escalation committed.
          </CardFooter>
        </Card>
      </section>

      <TwinHero patient={patients?.find((p) => p.patientId === featuredId) ?? null} loading={patients === null} />

      <StatusStrip />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Dashboard didn&apos;t load</AlertTitle>
          <AlertDescription>
            <p>{error}</p>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <section aria-labelledby="scenarios" className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="scenarios" className="text-xl font-semibold">
              Seeded scenarios
            </h2>
            <p className="text-sm text-muted-foreground">Synthetic patients. Each one exercises a different routing path.</p>
          </div>
          <Button variant="ghost" size="sm" onClick={reset} disabled={busy === "reset"}>
            <RotateCcw /> Reset demo
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {patients
            ? ORDER.map((scenario) => patients.find((p) => p.scenario === scenario))
                .filter(Boolean)
                .map((p) => {
                  const meta = SCENARIO_META[p!.scenario];
                  return (
                    <Card key={p!.patientId} className="gap-3">
                      <CardHeader>
                        <TierBadge tier={meta.tier} />
                        <CardTitle role="heading" aria-level={3} className="pt-1">{meta.title}</CardTitle>
                        <CardDescription>
                          {p!.displayName} · {p!.diagnosis.code}
                          {p!.diagnosis.source === "fhir" ? " (FHIR)" : ""}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex-1 text-sm text-muted-foreground">{p!.scenarioBlurb}</CardContent>
                      <CardFooter className="flex flex-col items-stretch gap-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={p!.twin.active ? "brand" : "outline"} className="gap-1">
                            <Headphones className="size-3" aria-hidden />
                            {p!.twin.active ? "Twin voice" : "No twin voice"}
                          </Badge>
                          {p!.openEscalations > 0 ? (
                            <Badge variant="tier3">{p!.openEscalations} open</Badge>
                          ) : p!.patternFlags > 0 ? (
                            <Badge variant="tier2">{p!.patternFlags} flagged</Badge>
                          ) : null}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Button asChild size="sm" variant={meta.direction === "outbound" ? "brand" : "outline"}>
                            <Link href={`/call/${p!.patientId}?direction=outbound`}>
                              <PhoneOutgoing /> Outbound
                            </Link>
                          </Button>
                          <Button asChild size="sm" variant={meta.direction === "inbound" ? "brand" : "outline"}>
                            <Link href={`/call/${p!.patientId}?direction=inbound`}>
                              <PhoneIncoming /> Inbound
                            </Link>
                          </Button>
                        </div>
                        <Link
                          href={`/checkin/${p!.patientId}?direction=${meta.direction}`}
                          className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                        >
                          <ListChecks className="size-3.5" aria-hidden /> Step-by-step pipeline view
                        </Link>
                      </CardFooter>
                    </Card>
                  );
                })
            : [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-60 rounded-xl" />)}
        </div>
      </section>

      <section aria-labelledby="queue" className="flex flex-col gap-4">
        <div>
          <h2 id="queue" className="text-xl font-semibold">
            Check-in queue
          </h2>
          <p className="text-sm text-muted-foreground">
            get_checkin_queue(). Drafting a script is ungated; placing the call waits for clinician approval.
          </p>
        </div>
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Patient</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Cadence</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue === null ? (
                <TableRow>
                  <TableCell colSpan={5} className="p-4">
                    <Skeleton className="h-6" />
                  </TableCell>
                </TableRow>
              ) : queue.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="p-6 text-center text-muted-foreground">
                    Nothing due. The queue refills on the next cadence.
                  </TableCell>
                </TableRow>
              ) : (
                queue.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="pl-4 font-medium">{row.displayName}</TableCell>
                    <TableCell>{timeUntil(row.dueAt)}</TableCell>
                    <TableCell className="capitalize">{row.cadence.replaceAll("-", " ")}</TableCell>
                    <TableCell>
                      <QueueStatus status={row.status} />
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      {row.status === "due" ? (
                        <Button size="sm" variant="outline" disabled={busy === row.id} onClick={() => void propose(row)}>
                          <Send /> {busy === row.id ? "Drafting…" : "Draft script"}
                        </Button>
                      ) : row.status === "awaiting_approval" ? (
                        <Button asChild size="sm" variant="ghost">
                          <Link href="/clinician?tab=gate">
                            Review at gate <ArrowRight />
                          </Link>
                        </Button>
                      ) : row.status === "call_placed" ? (
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/call/${row.patientId}?direction=outbound`}>
                            Take the call <ArrowRight />
                          </Link>
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </section>
    </div>
  );
}

function TwinHero({ patient, loading }: { patient: PatientSummary | null; loading: boolean }) {
  if (loading) return <Skeleton className="h-48 rounded-xl" />;
  if (!patient) return null;
  const first = patient.displayName.split(" ")[0];
  return (
    <section
      aria-labelledby="twin-hero"
      className="grid gap-6 overflow-hidden rounded-2xl bg-[#111] p-6 text-white sm:p-8 lg:grid-cols-[1.2fr_1fr] lg:items-center"
    >
      <div className="flex flex-col gap-3">
        <Badge className="w-fit gap-1.5 border-white/20 bg-white/10 text-white">
          <Headphones className="size-3.5" aria-hidden /> Digital Twin voice
        </Badge>
        <h2 id="twin-hero" className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">
          Hear Anchor in the patient&apos;s own voice.
        </h2>
        <p className="max-w-xl text-pretty text-white/70">
          With consent, {first} records a few seconds of their voice. Anchor then calls, or answers, as their Digital
          Twin: the same clinician-vetted lines and safety routing, in a voice they already trust.
        </p>
        <p className="flex items-center gap-1.5 text-sm text-white/70">
          <ShieldCheck className="size-4" aria-hidden />
          {patient.twin.active
            ? `${patient.displayName}: voice enrolled, consent ${patient.twin.source === "deployment" ? "attested at deployment" : "recorded"} (${patient.twin.consentedBy}).`
            : `${patient.displayName}: no voice yet. Record one in under a minute.`}
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Button asChild size="lg" variant="brand" className="rounded-full">
            <Link href={`/call/${patient.patientId}?direction=outbound`}>
              <PhoneOutgoing /> Anchor calls {first}
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="rounded-full border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white">
            <Link href={`/call/${patient.patientId}?direction=inbound`}>
              <PhoneIncoming /> {first} calls Anchor
            </Link>
          </Button>
        </div>
        <Button asChild variant="ghost" className="text-white/80 hover:bg-white/10 hover:text-white">
          <Link href={`/twin/${patient.patientId}`}>
            {patient.twin.active ? "Manage the Digital Twin voice" : "Create the Digital Twin voice"} <ArrowRight />
          </Link>
        </Button>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function QueueStatus({ status }: { status: QueueRow["status"] }) {
  const map = {
    due: { label: "Due", variant: "outline" as const },
    awaiting_approval: { label: "Awaiting approval", variant: "tier2" as const },
    call_placed: { label: "Call placed", variant: "tier1" as const },
    done: { label: "Done", variant: "secondary" as const },
  };
  const m = map[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}
