import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowRight, Database, LockKeyhole, Mic, Server, ShieldAlert, Waypoints } from "lucide-react";

import { TierBadge } from "@/components/app/tier";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "How it works | Anchor" };

const FLOW = [
  {
    icon: Database,
    title: "Queue and plan",
    body: "A check-in comes due in the MongoDB queue, or the patient calls in. get_recovery_plan() reads the clinician-authored plan.",
  },
  {
    icon: Waypoints,
    title: "Handoff",
    body: "OpenClaw authenticates the call and hands it to the Digital Twin. Outbound scripts wait at the OpenShell gate first.",
  },
  {
    icon: Server,
    title: "Classify on the box",
    body: "Deterministic rules set a floor. The local model on the GB10 can raise the tier, never lower it.",
  },
  {
    icon: ShieldAlert,
    title: "Route",
    body: "Tier 1 resolves in conversation. Tier 2 holds a pattern flag at the gate. Tier 3 escalates with no gate at all.",
  },
];

const GUARANTEES = [
  ["Escalation is never gated and never waits on the model", "tests/pipeline.test.ts: never waits on the reasoning model"],
  ["The escalation is committed before any handoff leaves the store", "tests/pipeline.test.ts: commits before the OpenClaw handoff"],
  ["The model can raise a tier but never lower it", "tests/triage.test.ts: route up, never down"],
  ["An unclassifiable answer routes up when no model can read it", "tests/triage.test.ts: unclassifiable answer routes up"],
  ["Tier 3 replies are vetted lines, verbatim; crisis resources are for clinicians only", "tests/pipeline.test.ts: vetted Tier 3 line"],
  ["Gated actions execute only on a named clinician's approval", "tests/pipeline.test.ts: OpenShell-gated"],
  ["Only a clinician can resolve an escalation; nothing self-resolves", "tests/pipeline.test.ts: named clinician"],
];

const STACK = [
  ["Dell Pro Max with NVIDIA GB10", "Runs everything: model, voice, database, app.", "docker-compose.yml, docs/DEPLOY_GB10.md"],
  ["OpenClaw", "Orchestration. Receives a bounded review task after an escalation commits.", "src/lib/integrations/openclaw.ts"],
  ["NVIDIA OpenShell", "Sandbox for tools and the approval gate for place_checkin_call and flag_pattern_for_clinician.", "src/lib/tools/index.ts, /clinician"],
  ["Local reasoning model", "Qwen 3.8 27B by default, any OpenAI-compatible server (vLLM, Ollama, NIM) including Nemotron.", "src/lib/ai/provider.ts"],
  ["MongoDB", "System of record: plans, library, queue, transcripts, gate requests, audit log.", "src/lib/store/mongo.ts"],
  ["Kokoro", "Local text to speech for the Digital Twin voice, with a browser fallback.", "src/app/api/tts/route.ts"],
];

export default function HowItWorks() {
  return (
    <div className="flex flex-col gap-12">
      <section className="flex max-w-3xl flex-col gap-3">
        <h1 className="text-4xl font-bold tracking-tight">How Anchor works</h1>
        <p className="text-lg text-muted-foreground">
          A clinician-governed digital twin that checks in with patients in substance use disorder recovery, in a voice
          they already trust. It proposes check-in content and routes what it hears. It never diagnoses, never changes
          treatment, and never counsels through a disclosure.
        </p>
      </section>

      <section aria-labelledby="flow" className="flex flex-col gap-4">
        <h2 id="flow" className="text-xl font-semibold">
          One check-in, end to end
        </h2>
        <ol className="grid gap-3 md:grid-cols-4">
          {FLOW.map((step, i) => (
            <li key={step.title} className="relative">
              <Card className="h-full gap-3">
                <CardHeader>
                  <span className="grid size-9 place-items-center rounded-full border-2 border-foreground">
                    <step.icon className="size-4" aria-hidden />
                  </span>
                  <CardTitle className="pt-1">
                    {i + 1}. {step.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">{step.body}</CardContent>
              </Card>
              {i < FLOW.length - 1 ? (
                <>
                  <ArrowRight className="absolute -right-3 top-1/2 z-10 hidden size-5 -translate-y-1/2 md:block" aria-hidden />
                  <ArrowDown className="mx-auto my-1 size-5 md:hidden" aria-hidden />
                </>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="tiers" className="flex flex-col gap-4">
        <div>
          <h2 id="tiers" className="text-xl font-semibold">
            Three tiers, one rule
          </h2>
          <p className="text-sm text-muted-foreground">On any doubt about which tier a response belongs to, route up, never down.</p>
        </div>
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Tier</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Action</TableHead>
                <TableHead className="pr-4">Gated?</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="pl-4"><TierBadge tier={1} /></TableCell>
                <TableCell>A single, clearly described moment: on track, or one craving or stressor.</TableCell>
                <TableCell>Surface coping or psychoeducation content as relevant.</TableCell>
                <TableCell className="pr-4">No</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="pl-4"><TierBadge tier={2} /></TableCell>
                <TableCell>The same issue across three consecutive check-ins, or a goal missed more than once.</TableCell>
                <TableCell className="font-mono text-xs">flag_pattern_for_clinician()</TableCell>
                <TableCell className="pr-4"><Badge variant="tier2"><LockKeyhole /> OpenShell</Badge></TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="pl-4"><TierBadge tier={3} /></TableCell>
                <TableCell>Any safety-relevant disclosure, or anything too ambiguous to classify.</TableCell>
                <TableCell className="font-mono text-xs">escalate_to_clinician()</TableCell>
                <TableCell className="pr-4 font-medium text-tier-3">Never</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
      </section>

      <section aria-labelledby="guarantees" className="flex flex-col gap-4">
        <div>
          <h2 id="guarantees" className="text-xl font-semibold">
            Safety guarantees, backed by tests
          </h2>
          <p className="text-sm text-muted-foreground">Each one is an automated test in the repository, not a slide claim.</p>
        </div>
        <ul className="grid gap-3 md:grid-cols-2">
          {GUARANTEES.map(([claim, test]) => (
            <li key={claim}>
              <Card className="h-full gap-2 py-4">
                <CardHeader>
                  <CardTitle className="text-base">{claim}</CardTitle>
                  <CardDescription className="font-mono text-xs">{test}</CardDescription>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="stack" className="flex flex-col gap-4">
        <div>
          <h2 id="stack" className="text-xl font-semibold">
            The stack, and where it lives in the code
          </h2>
          <p className="text-sm text-muted-foreground">
            Every adapter has a fallback, so the demo runs anywhere and switches to the GB10 through environment variables.
          </p>
        </div>
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Component</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="pr-4">In this repo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {STACK.map(([name, role, where]) => (
                <TableRow key={name}>
                  <TableCell className="whitespace-nowrap pl-4 font-medium">{name}</TableCell>
                  <TableCell>{role}</TableCell>
                  <TableCell className="pr-4 font-mono text-xs">{where}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </section>

      <section aria-labelledby="limits" className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle id="limits">What Anchor deliberately doesn&apos;t do</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <ul className="list-inside list-disc space-y-1">
              <li>No diagnosis, medication guidance, or treatment decisions.</li>
              <li>No crisis counseling. At Tier 3 its job is to route, not to talk the patient through it.</li>
              <li>Not a care team member; the FHIR CareTeam records say so explicitly.</li>
              <li>No HIPAA compliance claim. Local processing is a head start on data protection, not a guarantee.</li>
              <li>No login in this demo. The clinician name is typed in and recorded in the audit log.</li>
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mic className="size-4" aria-hidden /> Voice
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p>
              Anchor speaks through Kokoro on the GB10. Cloning a patient&apos;s own voice needs its own explicit consent,
              separate from consenting to AI check-ins, and each Recovery Plan records both.
            </p>
            <p>Patient speech comes in through the browser&apos;s dictation, or typed text, and is treated as data.</p>
            <Button asChild variant="brand" className="w-fit">
              <Link href="/checkin/demo-patient-edge?direction=inbound">Run the Tier 3 demo</Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
