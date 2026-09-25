"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, LockKeyhole, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, type EscalationRow, type GateRow } from "@/lib/client/api";
import type { ReferenceLibraryEntry } from "@/lib/domain/schemas";

function when(iso: string) {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ClinicianConsole({ initialTab }: { initialTab: "escalations" | "gate" }) {
  const [clinician, setClinician] = useState("Dr. M. Alvarez (fictional)");
  const [escalations, setEscalations] = useState<EscalationRow[] | null>(null);
  const [reference, setReference] = useState<ReferenceLibraryEntry[]>([]);
  const [gate, setGate] = useState<GateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [e, g] = await Promise.all([api.escalations(), api.gate()]);
      setEscalations(e.escalations);
      setReference(e.clinicianReference);
      setGate(g.requests);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the queue.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const openCount = escalations?.filter((e) => !e.resolved).length ?? 0;
  const pendingCount = gate?.filter((g) => g.status === "pending").length ?? 0;
  const nameMissing = clinician.trim().length === 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Clinician queue</h1>
        <p className="max-w-3xl text-muted-foreground">
          Escalations arrive here the moment they&apos;re committed, with no gate in front of them. Gated actions wait
          here until a named clinician approves. Anchor never resolves or approves anything on its own.
        </p>
      </div>

      <Card className="gap-3 py-4">
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-4">
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="clinician">Acting clinician</Label>
            <Input
              id="clinician"
              value={clinician}
              onChange={(e) => setClinician(e.target.value)}
              aria-invalid={nameMissing || undefined}
              aria-describedby="clinician-help"
            />
          </div>
          <p id="clinician-help" className="text-xs text-muted-foreground sm:max-w-xs">
            Every decision and resolution is written to the audit log under this name. Demo only: there is no login.
          </p>
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Queue didn&apos;t load</AlertTitle>
          <AlertDescription>
            <p>{error}</p>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs defaultValue={initialTab}>
        <TabsList>
          <TabsTrigger value="escalations">
            <AlertTriangle /> Escalations {openCount ? <Badge variant="tier3">{openCount}</Badge> : null}
          </TabsTrigger>
          <TabsTrigger value="gate">
            <LockKeyhole /> OpenShell gate {pendingCount ? <Badge variant="tier2">{pendingCount}</Badge> : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="escalations" className="flex flex-col gap-4">
          {escalations === null ? (
            <Skeleton className="h-48 rounded-xl" />
          ) : escalations.length === 0 ? (
            <Empty
              title="No escalations"
              body="When a check-in reaches Tier 3, it appears here immediately. Run the Tier 3 demo from the dashboard to see one."
            />
          ) : (
            escalations.map((e) => (
              <EscalationCard
                key={e.id}
                escalation={e}
                reference={reference}
                clinician={clinician}
                onChanged={load}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="gate" className="flex flex-col gap-4">
          {gate === null ? (
            <Skeleton className="h-48 rounded-xl" />
          ) : gate.length === 0 ? (
            <Empty
              title="Nothing waiting at the gate"
              body="Drafting a check-in script from the queue, or a Tier 2 pattern, creates a request here."
            />
          ) : (
            gate.map((g) => <GateCard key={g.id} request={g} clinician={clinician} onChanged={load} />)
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <Card className="items-center py-10 text-center">
      <CardHeader className="w-full justify-items-center">
        <ShieldCheck className="size-8 text-muted-foreground" aria-hidden />
        <CardTitle>{title}</CardTitle>
        <CardDescription className="max-w-md">{body}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function EscalationCard({
  escalation: e,
  reference,
  clinician,
  onChanged,
}: {
  escalation: EscalationRow;
  reference: ReferenceLibraryEntry[];
  clinician: string;
  onChanged: () => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function resolve() {
    setBusy(true);
    try {
      await api.resolve(e.id, { patientId: e.patientId, clinician, note });
      toast.success(`Escalation for ${e.displayName} resolved by ${clinician}.`);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resolve.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={e.resolved ? "opacity-80" : "border-tier-3/50"}>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={e.resolved ? "secondary" : "tier3"}>{e.resolved ? "Resolved" : "Open"}</Badge>
          <Badge variant="outline">Tier 3</Badge>
          <Badge variant="outline">
            Handoff: {e.handoff === "sent" ? "sent to OpenClaw" : e.handoff === "queued_locally" ? "local queue" : e.handoff.replace("_", " ")}
          </Badge>
        </div>
        <CardTitle role="heading" aria-level={3} className="pt-1 text-lg">{e.displayName}</CardTitle>
        <CardDescription>
          Committed {when(e.at)} · <code className="font-mono">{e.id}</code> · care team: {e.clinician.name}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p>
          <span className="font-medium">Signals:</span> {e.reason}
        </p>
        <blockquote className="border-l-2 pl-3 text-muted-foreground">&ldquo;{e.transcriptExcerpt}&rdquo;</blockquote>
        {!e.resolved && reference.length ? (
          <div className="rounded-md border border-dashed p-3 text-xs">
            <p className="font-medium">Clinician reference (never read to the patient by Anchor)</p>
            <ul className="mt-1 list-inside list-disc text-muted-foreground">
              {reference.map((r) => (
                <li key={r.id}>
                  {r.title}: {r.summary}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {e.resolved ? (
          <p className="text-muted-foreground">
            Resolved by {e.resolvedBy} {e.resolvedAt ? `on ${when(e.resolvedAt)}` : ""}
            {e.resolutionNote ? `: ${e.resolutionNote}` : "."}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor={`note-${e.id}`}>Resolution note</Label>
            <Textarea
              id={`note-${e.id}`}
              value={note}
              onChange={(ev) => setNote(ev.target.value)}
              placeholder="For example: reached the patient by phone, safety plan reviewed."
              rows={2}
              maxLength={500}
            />
          </div>
        )}
      </CardContent>
      {!e.resolved ? (
        <CardFooter className="justify-end border-t">
          <Button onClick={() => void resolve()} disabled={busy || !clinician.trim()}>
            <Check /> Mark resolved
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

function GateCard({
  request: g,
  clinician,
  onChanged,
}: {
  request: GateRow;
  clinician: string;
  onChanged: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(g.draft);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = g.status === "pending";
  const label = g.action === "place_checkin_call" ? "place_checkin_call()" : "flag_pattern_for_clinician()";

  async function decide(decision: "approved" | "rejected") {
    setBusy(true);
    try {
      await api.decide(g.id, { decision, clinician, draft, note: note || undefined });
      toast.success(
        decision === "approved"
          ? `${label} approved and executed for ${g.displayName}.`
          : `${label} rejected. Nothing was executed.`,
      );
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record the decision.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={pending ? "border-tier-2/50" : "opacity-80"}>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={pending ? "tier2" : g.status === "approved" ? "tier1" : "secondary"}>
            {pending ? "Pending" : g.status === "approved" ? "Approved" : "Rejected"}
          </Badge>
          <Badge variant="outline" className="font-mono">
            {label}
          </Badge>
        </div>
        <CardTitle role="heading" aria-level={3} className="pt-1 text-lg">{g.displayName}</CardTitle>
        <CardDescription>
          {g.summary} · requested {when(g.createdAt)}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {pending ? (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`draft-${g.id}`}>
                {g.action === "place_checkin_call" ? "Opening line Anchor will say (edit before approving)" : "Pattern summary for the chart (edit before approving)"}
              </Label>
              <Textarea
                id={`draft-${g.id}`}
                value={draft}
                onChange={(ev) => setDraft(ev.target.value)}
                rows={3}
                maxLength={1000}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`gnote-${g.id}`}>Note (optional)</Label>
              <Input id={`gnote-${g.id}`} value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={500} />
            </div>
          </>
        ) : (
          <>
            <blockquote className="border-l-2 pl-3">&ldquo;{g.draft}&rdquo;</blockquote>
            <p className="text-muted-foreground">
              {g.status === "approved" ? "Approved" : "Rejected"} by {g.decidedBy}
              {g.decidedAt ? ` on ${when(g.decidedAt)}` : ""}
              {g.note ? `. Note: ${g.note}` : "."}
            </p>
          </>
        )}
      </CardContent>
      {pending ? (
        <CardFooter className="justify-end gap-2 border-t">
          <Button variant="outline" onClick={() => void decide("rejected")} disabled={busy || !clinician.trim()}>
            <X /> Reject
          </Button>
          <Button variant="brand" onClick={() => void decide("approved")} disabled={busy || !clinician.trim() || !draft.trim()}>
            <Check /> Approve and execute
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}
