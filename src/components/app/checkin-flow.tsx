"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Database,
  Headphones,
  Loader2,
  Mic,
  MicOff,
  PhoneIncoming,
  PhoneOutgoing,
  RotateCcw,
  Send,
  Square,
  Volume2,
} from "lucide-react";

import { PlanPanel } from "@/components/app/plan-panel";
import { TIER_META, TierBadge } from "@/components/app/tier";
import { useDictation, useSpeaker } from "@/components/app/voice";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, type CheckinResult, type PatientDetail, type VoiceState } from "@/lib/client/api";
import { SAMPLE_UTTERANCES, SCENARIO_DEFAULT_SAMPLE } from "@/lib/data/seed";
import { cn } from "@/lib/utils";

type Step = "input" | "processing" | "result" | "done";
const STEPS: { key: Step; label: string }[] = [
  { key: "input", label: "Call" },
  { key: "processing", label: "Process" },
  { key: "result", label: "Result" },
  { key: "done", label: "Done" },
];

const STAGE_PLACEHOLDERS = [
  "Read Recovery Plan",
  "Classify locally",
  "Commit",
  "Route",
];

const OUTBOUND_OPENER = "Hey, it's me. How'd today go with the plan?";

export function CheckinFlow({
  patientId,
  initialDirection,
}: {
  patientId: string;
  initialDirection: "inbound" | "outbound";
}) {
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("input");
  const [direction, setDirection] = useState(initialDirection);
  const [utterance, setUtterance] = useState("");
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [voice, setVoice] = useState<VoiceState | null>(null);
  const [selfHearingOn, setSelfHearingOn] = useState<boolean | null>(null);
  const twin = voice?.profile ?? null;
  const selfHearing = useMemo(
    () => (twin ? { ...twin.selfHearing, enabled: selfHearingOn ?? twin.selfHearing.enabled } : null),
    [twin, selfHearingOn],
  );
  const speaker = useSpeaker({ patientId, selfHearing });
  const dictation = useDictation(useCallback((text: string) => setUtterance(text), []));

  const loadDetail = useCallback(async () => {
    try {
      const d = await api.patient(patientId);
      setDetail(d);
      setLoadError(null);
      return d;
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load this patient.");
      return null;
    }
  }, [patientId]);

  useEffect(() => {
    let cancelled = false;
    void api
      .voice(patientId)
      .then((v) => !cancelled && setVoice(v))
      .catch(() => undefined);
    // Initial fetch on mount; state is set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDetail().then((d) => {
      if (!cancelled && d) setUtterance(SAMPLE_UTTERANCES[SCENARIO_DEFAULT_SAMPLE[d.plan.scenario]].text);
    });
    return () => {
      cancelled = true;
    };
  }, [loadDetail, patientId]);

  // Reveal the real pipeline stages one at a time once they come back.
  useEffect(() => {
    if (step !== "processing" || !result) return;
    if (revealed >= result.stages.length) {
      const t = setTimeout(() => setStep("result"), 450);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setRevealed((r) => r + 1), 380);
    return () => clearTimeout(t);
  }, [step, result, revealed]);

  // Anchor speaks its reply when the result lands.
  const { speak } = speaker;
  useEffect(() => {
    if (step === "result" && result) void speak(result.reply);
  }, [step, result, speak]);

  const canSubmit = utterance.trim().length > 0 && step === "input";

  async function submit() {
    if (!canSubmit) return;
    dictation.stop();
    speaker.stop();
    setSubmitError(null);
    setResult(null);
    setRevealed(0);
    setStep("processing");
    const t0 = performance.now();
    try {
      const res = await api.checkin({ patientId, direction, utterance: utterance.trim() });
      setElapsedMs(Math.round(performance.now() - t0));
      setResult(res);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "The check-in could not be processed.");
      setStep("input");
    }
  }

  async function again() {
    speaker.stop();
    setResult(null);
    setStep("input");
    await loadDetail();
  }

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  if (loadError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t open this check-in</AlertTitle>
        <AlertDescription>
          <p>{loadError}</p>
          <Button asChild size="sm" variant="outline">
            <Link href="/">Back to dashboard</Link>
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/">
            <ArrowLeft /> Dashboard
          </Link>
        </Button>
        <ol className="flex items-center gap-2 text-xs" aria-label="Check-in progress">
          {STEPS.map((s, i) => (
            <li
              key={s.key}
              aria-current={i === stepIndex ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1",
                i < stepIndex && "border-brand/40 text-foreground",
                i === stepIndex && "border-foreground bg-foreground text-background",
                i > stepIndex && "text-muted-foreground",
              )}
            >
              {i < stepIndex ? <CheckCircle2 className="size-3.5" aria-hidden /> : <span aria-hidden>{i + 1}</span>}
              {s.label}
            </li>
          ))}
        </ol>
      </div>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        Check-in{detail ? ` with ${detail.plan.displayName}` : ""}
      </h1>
      <Progress value={((stepIndex + 1) / STEPS.length) * 100} aria-label="Check-in progress" />

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="order-2 lg:sticky lg:top-20 lg:order-1 lg:self-start" aria-label="Recovery Plan">
          {detail ? <PlanPanel detail={detail} /> : <Skeleton className="h-[520px] rounded-xl" />}
        </aside>

        <div className="order-1 flex min-w-0 flex-col gap-6 lg:order-2">
          {step === "input" ? (
            <Card>
              <CardHeader>
                <CardTitle role="heading" aria-level={2} className="flex items-center gap-2 text-xl">
                  {direction === "inbound" ? <PhoneIncoming className="size-5" /> : <PhoneOutgoing className="size-5" />}
                  {direction === "inbound" ? "Inbound call" : "Scheduled check-in"}
                </CardTitle>
                <CardDescription>
                  {direction === "inbound"
                    ? "The patient calls Anchor. OpenClaw authenticates the call and hands it to the Digital Twin. The patient speaks first."
                    : "Anchor calls on the plan's cadence, in the Digital Twin voice, and opens with a clinician-approved line."}
                </CardDescription>
                <Link
                  href={`/twin/${patientId}`}
                  className="flex w-fit items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
                >
                  <Headphones className="size-4" />
                  {twin ? "Digital Twin voice: active" : "Create the Digital Twin voice"}
                </Link>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 text-sm font-medium">Call direction</legend>
                  <RadioGroup
                    value={direction}
                    onValueChange={(v) => setDirection(v as typeof direction)}
                    className="grid-cols-2"
                  >
                    {(["inbound", "outbound"] as const).map((d) => (
                      <Label
                        key={d}
                        htmlFor={`dir-${d}`}
                        className="cursor-pointer rounded-md border p-3 font-normal has-[[data-state=checked]]:border-foreground"
                      >
                        <RadioGroupItem id={`dir-${d}`} value={d} />
                        {d === "inbound" ? "Inbound: patient calls in" : "Outbound: Anchor calls"}
                      </Label>
                    ))}
                  </RadioGroup>
                </fieldset>

                {direction === "outbound" ? (
                  <div className="flex items-start justify-between gap-3 rounded-lg bg-muted p-3">
                    <p className="text-sm">
                      <span className="font-medium">Anchor:</span> &ldquo;{OUTBOUND_OPENER}&rdquo;
                    </p>
                    <Button size="sm" variant="outline" onClick={() => void speaker.speak(OUTBOUND_OPENER)}>
                      <Volume2 /> Play
                    </Button>
                  </div>
                ) : null}

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="utterance">What the patient says</Label>
                    {dictation.supported ? (
                      <Button
                        type="button"
                        size="sm"
                        variant={dictation.listening ? "destructive" : "outline"}
                        onClick={dictation.listening ? dictation.stop : dictation.start}
                        aria-pressed={dictation.listening}
                      >
                        {dictation.listening ? <MicOff /> : <Mic />}
                        {dictation.listening ? "Stop" : "Dictate"}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Dictation isn&apos;t available in this browser. Type instead.</span>
                    )}
                  </div>
                  <Textarea
                    id="utterance"
                    value={utterance}
                    onChange={(e) => setUtterance(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
                    }}
                    rows={4}
                    maxLength={2000}
                    placeholder="Type or dictate the patient's response"
                    aria-describedby="utterance-help"
                    aria-invalid={Boolean(submitError) || undefined}
                    className="text-base"
                  />
                  <p id="utterance-help" className="text-xs text-muted-foreground">
                    Synthetic lines only. Press Ctrl or ⌘ + Enter to send.
                  </p>
                  {dictation.error ? <p className="text-xs text-destructive">{dictation.error}</p> : null}
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium" id="samples-label">
                    Vetted example lines
                  </span>
                  <div className="flex flex-wrap gap-2" role="group" aria-labelledby="samples-label">
                    {SAMPLE_UTTERANCES.map((s) => (
                      <button
                        key={s.label}
                        type="button"
                        onClick={() => setUtterance(s.text)}
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/60",
                          utterance === s.text && "border-foreground bg-accent",
                        )}
                      >
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            s.tierHint === 1 && "bg-tier-1",
                            s.tierHint === 2 && "bg-tier-2",
                            s.tierHint === 3 && "bg-tier-3",
                          )}
                          aria-hidden
                        />
                        {s.label}
                        <span className="sr-only">(expected Tier {s.tierHint})</span>
                      </button>
                    ))}
                  </div>
                </div>

                {submitError ? (
                  <Alert variant="destructive">
                    <AlertTitle>That didn&apos;t go through</AlertTitle>
                    <AlertDescription>{submitError} Nothing was saved; you can send it again.</AlertDescription>
                  </Alert>
                ) : null}
              </CardContent>
              <CardFooter className="justify-end border-t">
                <Button size="lg" variant="brand" onClick={() => void submit()} disabled={!canSubmit}>
                  <Send /> Send to Anchor
                </Button>
              </CardFooter>
            </Card>
          ) : null}

          {step === "processing" ? (
            <Card aria-live="polite" aria-busy={!result}>
              <CardHeader>
                <CardTitle role="heading" aria-level={2} className="text-xl">Processing on the GB10</CardTitle>
                <CardDescription>Real pipeline stages with measured timings. Nothing leaves the box.</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="flex flex-col gap-3">
                  {STAGE_PLACEHOLDERS.map((placeholder, i) => {
                    const stage = result && i < revealed ? result.stages[i] : null;
                    const active = !stage && (result ? i === revealed : i === 0);
                    return (
                      <li key={placeholder} className="flex items-start gap-3 rounded-lg border p-3">
                        {stage ? (
                          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-tier-1" aria-hidden />
                        ) : active ? (
                          <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
                        ) : (
                          <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground/40" aria-hidden />
                        )}
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{stage?.label ?? placeholder}</span>
                            {stage ? <span className="font-mono text-xs text-muted-foreground">{stage.ms} ms</span> : null}
                          </div>
                          {stage ? (
                            <p className="text-sm text-muted-foreground">{stage.detail}</p>
                          ) : (
                            <Skeleton className="h-4 w-2/3" />
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </CardContent>
            </Card>
          ) : null}

          {step === "result" && result ? (
            <ResultView
              result={result}
              utterance={result.record.utterance}
              direction={direction}
              speaking={speaker.speaking}
              engine={speaker.engine}
              selfHearing={twin ? (selfHearing?.enabled ?? false) : null}
              onSelfHearing={setSelfHearingOn}
              onPlay={() => void speaker.speak(result.reply)}
              onStop={speaker.stop}
              onAgain={() => void again()}
              onFinish={() => {
                speaker.stop();
                setStep("done");
              }}
            />
          ) : null}

          {step === "done" && result ? (
            <DoneView result={result} elapsedMs={elapsedMs} onAgain={() => void again()} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ResultView({
  result,
  utterance,
  direction,
  speaking,
  engine,
  selfHearing,
  onSelfHearing,
  onPlay,
  onStop,
  onAgain,
  onFinish,
}: {
  result: CheckinResult;
  utterance: string;
  direction: "inbound" | "outbound";
  speaking: boolean;
  engine: string | null;
  selfHearing: boolean | null;
  onSelfHearing: (on: boolean) => void;
  onPlay: () => void;
  onStop: () => void;
  onAgain: () => void;
  onFinish: () => void;
}) {
  const { triage } = result;
  const meta = TIER_META[triage.tier];
  const spoken = useMemo(() => result.references.filter((r) => r.audience === "patient"), [result.references]);
  const clinicianOnly = useMemo(() => result.references.filter((r) => r.audience === "clinician"), [result.references]);

  return (
    <div className="flex flex-col gap-6" aria-live="polite">
      <Card
        className={cn(
          "gap-4 border-2",
          triage.tier === 1 && "border-tier-1/40",
          triage.tier === 2 && "border-tier-2/50",
          triage.tier === 3 && "border-tier-3/60",
        )}
      >
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <TierBadge tier={triage.tier} className="text-sm" />
            <Badge variant="outline">
              {result.model.status === "live"
                ? `${result.model.name} + deterministic floor`
                : result.model.status === "skipped"
                  ? "Deterministic floor (model not needed)"
                  : "Deterministic rules"}
            </Badge>
          </div>
          <CardTitle role="heading" aria-level={2} className="text-2xl">{triage.label}</CardTitle>
          <CardDescription className="text-base">{triage.rationale}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="rounded-lg bg-muted p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Patient ({direction === "inbound" ? "called in" : "answered"})
            </p>
            <p className="mt-1">&ldquo;{utterance}&rdquo;</p>
          </div>
          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Anchor (Digital Twin voice)</p>
              <Button size="sm" variant="outline" onClick={speaking ? onStop : onPlay}>
                {speaking ? <Square /> : <Volume2 />}
                {speaking ? "Stop" : "Play"}
              </Button>
            </div>
            <p className="mt-1 text-lg leading-relaxed">&ldquo;{result.reply}&rdquo;</p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              {engine ? (
                <p>
                  Voice:{" "}
                  {engine === "twin"
                    ? "Digital Twin (cloned, with consent)"
                    : engine === "kokoro"
                      ? "Kokoro on the GB10"
                      : engine === "browser"
                        ? "browser fallback"
                        : "unavailable"}
                </p>
              ) : (
                <span />
              )}
              {selfHearing !== null ? (
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-brand"
                    checked={selfHearing}
                    onChange={(e) => onSelfHearing(e.target.checked)}
                  />
                  As they hear themselves
                </label>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      {triage.tier === 3 && result.escalation ? (
        <Alert variant="tier3">
          <meta.Icon />
          <AlertTitle>escalate_to_clinician() fired. Always open, never gated.</AlertTitle>
          <AlertDescription>
            <ol className="list-inside list-decimal space-y-0.5">
              <li>Patient turn scored on the box.</li>
              <li>
                Escalation <code className="font-mono">{result.escalation.id}</code> committed to{" "}
                <Database className="inline size-3.5 align-[-2px]" aria-hidden />{" "}
                {result.store === "mongodb" ? "MongoDB" : "the store (seeded memory fallback)"} first.
              </li>
              <li>
                {result.escalation.handoff === "sent" ? (
                  <>Bounded review task <strong>delivered</strong> to the authenticated OpenClaw hook.</>
                ) : result.escalation.handoff === "queued_locally" ? (
                  <>No OpenClaw hook configured, so the review task is <strong>waiting in the local clinician queue</strong>.</>
                ) : (
                  <>OpenClaw hook didn&apos;t accept the task. <strong>Retrying</strong>; the escalation stays committed.</>
                )}
              </li>
            </ol>
            <p>Nothing self-resolves. Only a clinician can close this escalation.</p>
            <Button asChild size="sm" variant="outline" className="mt-1">
              <Link href="/clinician?tab=escalations">Open the clinician queue</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {triage.tier === 2 && result.gateRequest ? (
        <Alert variant="tier2">
          <meta.Icon />
          <AlertTitle>flag_pattern_for_clinician() is held at the OpenShell gate</AlertTitle>
          <AlertDescription>
            <p>&ldquo;{result.gateRequest.draft}&rdquo;</p>
            <p>The flag is written to the Recovery Plan only after a clinician approves it. The in-call response still happened.</p>
            <Button asChild size="sm" variant="outline" className="mt-1">
              <Link href="/clinician?tab=gate">Review at the gate</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {triage.tier === 1 ? (
        <Alert variant="tier1">
          <meta.Icon />
          <AlertTitle>Resolved in conversation</AlertTitle>
          <AlertDescription>
            {spoken.length
              ? `Surfaced "${spoken[0].title}" from the clinic-vetted reference library.`
              : "Acknowledgment only. No reference content needed."}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="gap-2 py-3">
        <CardContent>
          <Accordion type="multiple" defaultValue={["why"]}>
            <AccordionItem value="why">
              <AccordionTrigger>Why this tier</AccordionTrigger>
              <AccordionContent className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-1.5">
                  {triage.signals.map((s, i) => (
                    <Badge key={`${s.phrase}-${i}`} variant={`tier${s.tierHint}` as "tier1" | "tier2" | "tier3"}>
                      &ldquo;{s.phrase}&rdquo; · {s.kind.replace("_", " ")}
                    </Badge>
                  ))}
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Deterministic floor</dt>
                  <dd>Tier {triage.deterministicTier}</dd>
                  <dt className="text-muted-foreground">Model reading</dt>
                  <dd>
                    {triage.modelTier
                      ? `Tier ${triage.modelTier} (${result.model.name})`
                      : result.model.status === "skipped"
                        ? "Not consulted: explicit Tier 3 signal"
                        : "Unavailable, deterministic only"}
                  </dd>
                  <dt className="text-muted-foreground">Final</dt>
                  <dd>Tier {triage.tier}. The higher reading always wins; nothing routes down.</dd>
                  {triage.patternSummary ? (
                    <>
                      <dt className="text-muted-foreground">Pattern</dt>
                      <dd>{triage.patternSummary}</dd>
                    </>
                  ) : null}
                  <dt className="text-muted-foreground">Topics</dt>
                  <dd>{triage.topics.length ? triage.topics.join(", ") : "none"}</dd>
                </dl>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="refs">
              <AccordionTrigger>Reference content ({result.references.length})</AccordionTrigger>
              <AccordionContent className="flex flex-col gap-3">
                {result.references.length === 0 ? <p className="text-muted-foreground">None used.</p> : null}
                {spoken.map((r) => (
                  <div key={r.id} className="rounded-md border p-3">
                    <p className="font-medium">
                      {r.title} <Badge variant="secondary">{r.category.replace("_", " ")}</Badge>
                    </p>
                    <p className="text-muted-foreground">{r.summary}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{r.source}</p>
                  </div>
                ))}
                {clinicianOnly.length ? (
                  <div className="rounded-md border border-dashed p-3">
                    <p className="font-medium">Attached to the escalation for the clinician. Never spoken by Anchor.</p>
                    <ul className="mt-1 list-inside list-disc text-muted-foreground">
                      {clinicianOnly.map((r) => (
                        <li key={r.id}>
                          {r.title}: {r.summary}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="trace">
              <AccordionTrigger>Pipeline trace</AccordionTrigger>
              <AccordionContent>
                <ol className="flex flex-col gap-2">
                  {result.stages.map((s) => (
                    <li key={s.key} className="flex items-start justify-between gap-3">
                      <span>
                        <span className="font-medium">{s.label}.</span> <span className="text-muted-foreground">{s.detail}</span>
                      </span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{s.ms} ms</span>
                    </li>
                  ))}
                </ol>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="outline" onClick={onAgain}>
          <RotateCcw /> Try another response
        </Button>
        <Button variant="brand" onClick={onFinish}>
          Finish check-in
        </Button>
      </div>
    </div>
  );
}

function DoneView({ result, elapsedMs, onAgain }: { result: CheckinResult; elapsedMs: number | null; onAgain: () => void }) {
  const commit = result.stages.find((s) => s.key === "commit");
  const changed =
    result.triage.tier === 3
      ? [
          `Escalation ${result.escalation?.id} added to the Recovery Plan's escalation history (open).`,
          "Audit Log: turn received, triage scored, escalation committed, handoff recorded.",
        ]
      : result.triage.tier === 2
        ? [
            `Gate request ${result.gateRequest?.id} is pending clinician approval.`,
            "Audit Log: turn received, triage scored, gate requested.",
          ]
        : ["Check-in saved to history for future pattern checks.", "Audit Log: turn received, triage scored."];
  const next =
    result.triage.tier === 3
      ? "A clinician reaches the patient and resolves the escalation. Anchor never closes it."
      : result.triage.tier === 2
        ? "The clinician approves or rejects the pattern flag at the gate before the next review."
        : "The next check-in follows the plan's cadence.";

  return (
    <Card>
      <CardHeader>
        <TierBadge tier={result.triage.tier} withAction />
        <CardTitle role="heading" aria-level={2} className="pt-1 text-2xl">Check-in complete</CardTitle>
        <CardDescription>
          Record <code className="font-mono">{result.record.id}</code> saved.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">What changed</h3>
          <ul className="list-inside list-disc text-sm text-muted-foreground">
            {changed.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <h3 className="mt-2 font-semibold">What happens next</h3>
          <p className="text-sm text-muted-foreground">{next}</p>
        </div>
        <div className="flex flex-col gap-3 rounded-lg bg-muted p-4">
          <h3 className="font-semibold">Impact</h3>
          <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
            <dt>Round trip, turn to routed</dt>
            <dd className="font-mono">{elapsedMs ?? "n/a"} ms</dd>
            <dt>Store commit</dt>
            <dd className="font-mono">{commit?.ms ?? "n/a"} ms</dd>
            <dt>Reasoning model</dt>
            <dd className="font-mono">{result.model.status.replace("_", " ")}</dd>
          </dl>
          <p className="text-xs text-muted-foreground">Measured in this browser session, not estimated.</p>
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap justify-end gap-3 border-t">
        <Button variant="outline" onClick={onAgain}>
          <RotateCcw /> Another check-in
        </Button>
        <Button asChild variant="outline">
          <Link href="/audit">View audit log</Link>
        </Button>
        <Button asChild variant="brand">
          <Link href="/clinician">Clinician queue</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
