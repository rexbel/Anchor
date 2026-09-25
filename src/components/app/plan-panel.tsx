import { FileHeart, ShieldCheck, Stethoscope } from "lucide-react";

import { TierBadge } from "@/components/app/tier";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { PatientDetail } from "@/lib/client/api";

export function PlanPanel({ detail }: { detail: PatientDetail }) {
  const { plan, history, copingPlan, fhir } = detail;
  const openEscalations = plan.escalationHistory.filter((e) => !e.resolved);
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          <FileHeart className="size-4" aria-hidden /> Recovery Plan · get_recovery_plan()
        </CardDescription>
        <CardTitle role="heading" aria-level={2} className="text-lg">{plan.displayName}</CardTitle>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">
            {plan.diagnosis.system} {plan.diagnosis.code}
          </Badge>
          {plan.diagnosis.source === "fhir" ? <Badge variant="brand">Read from FHIR R4</Badge> : null}
          {openEscalations.length ? <Badge variant="tier3">{openEscalations.length} open escalation</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <p className="text-muted-foreground">{plan.diagnosis.display}</p>

        <Section title="Clinician-authored goals">
          <ul className="flex flex-col gap-1.5">
            {plan.goals.map((g) => (
              <li key={g.id} className="flex items-start justify-between gap-2">
                <span>{g.description}</span>
                {g.missesThisWindow > 0 ? (
                  <span className="shrink-0 text-xs text-tier-2">missed {g.missesThisWindow}x</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Known triggers">
          <ul className="list-inside list-disc text-muted-foreground">
            {plan.knownTriggers.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Section>

        <Section title="Coping plan">
          <div className="flex flex-wrap gap-1.5">
            {copingPlan.map((c) => (
              <Badge key={c.id} variant="secondary">
                {c.title}
              </Badge>
            ))}
          </div>
        </Section>

        {plan.programMatch ? (
          <Section title="Program match">
            <p>
              {plan.programMatch.programName}
              <br />
              <span className="text-muted-foreground">
                Intake {plan.programMatch.intakeDate} · {plan.programMatch.intakeStatus}
              </span>
            </p>
          </Section>
        ) : null}

        <Separator />

        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <Stethoscope className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {plan.clinician.name}, {plan.clinician.role}
          </span>
        </div>
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Consent: AI check-ins {plan.consent.aiCheckins ? "yes" : "no"}. Voice clone{" "}
            {plan.consent.voiceClone ? "consented separately" : "not consented, default voice"}.
          </span>
        </div>

        {fhir ? (
          <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
            Crosswalk: FHIR Patient.identifier <code className="font-mono">{fhir.patientIdentifier}</code> in{" "}
            <code className="font-mono">{fhir.bundle}</code>
            {fhir.synthetic ? " (tagged synthetic)" : ""}. Diagnosis resolved from the Condition resource, not
            duplicated in the plan.
          </p>
        ) : null}

        {history.length ? (
          <Section title="Recent check-ins">
            <ul className="flex flex-col gap-2">
              {history.slice(0, 4).map((c) => (
                <li key={c.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <TierBadge tier={c.triage.tier} />
                    <time className="text-xs text-muted-foreground" dateTime={c.at}>
                      {new Date(c.at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}
                    </time>
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">&ldquo;{c.utterance}&rdquo;</p>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}
