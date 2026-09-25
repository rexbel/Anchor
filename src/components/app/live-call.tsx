"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Flag,
  Headphones,
  ListChecks,
  Loader2,
  Mic,
  MicOff,
  Phone,
  PhoneIncoming,
  PhoneOff,
  PhoneOutgoing,
  Send,
  ShieldCheck,
  Volume2,
} from "lucide-react";

import { TierBadge } from "@/components/app/tier";
import { useDictation, useSpeaker, type SpeakEngine } from "@/components/app/voice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type PatientDetail, type Status, type VoiceState } from "@/lib/client/api";
import { OUTBOUND_OPENER, formatDuration, summarizeCall, type CallSummary, type CallTurn } from "@/lib/call/summary";
import { SAMPLE_UTTERANCES } from "@/lib/data/seed";
import { cn } from "@/lib/utils";

type Direction = "outbound" | "inbound";
type Phase = "idle" | "ringing" | "dialing" | "live" | "ended";
type Line =
  | { id: string; who: "anchor"; text: string }
  | { id: string; who: "patient"; text: string; tier: 1 | 2 | 3; escalated: boolean; gated: boolean }
  | { id: string; who: "system"; text: string };

const ENGINE_LABEL: Record<SpeakEngine, string> = {
  twin: "Digital Twin (cloned voice)",
  kokoro: "Kokoro (standard voice)",
  browser: "Browser voice",
  none: "No voice available",
};

let lineSeq = 0;
const lineId = () => `l${++lineSeq}`;

export function LiveCall({ patientId, initialDirection }: { patientId: string; initialDirection: Direction }) {
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [voice, setVoice] = useState<VoiceState | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>(initialDirection);
  const [phase, setPhase] = useState<Phase>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [turns, setTurns] = useState<CallTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [summary, setSummary] = useState<CallSummary | null>(null);
  const [openerEngine, setOpenerEngine] = useState<SpeakEngine | null>(null);
  const [selfHearingOn, setSelfHearingOn] = useState<boolean | null>(null);
  const transcriptRef = useRef<HTMLOListElement | null>(null);
  const dialTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const twin = voice?.profile ?? null;
  const selfHearing = useMemo(
    () => (twin ? { ...twin.selfHearing, enabled: selfHearingOn ?? twin.selfHearing.enabled } : null),
    [twin, selfHearingOn],
  );
  const speaker = useSpeaker({ patientId, selfHearing });
  const dictation = useDictation(useCallback((text: string) => setDraft(text), []));
  const { prefetch } = speaker;

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.patient(patientId), api.voice(patientId), api.status()])
      .then(([d, v, s]) => {
        if (cancelled) return;
        setDetail(d);
        setVoice(v);
        setStatus(s);
      })
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : "Could not load this patient."));
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  // Render the opener ahead of time so the call starts without a wait.
  useEffect(() => {
    if (!voice || direction !== "outbound" || phase !== "idle") return;
    let cancelled = false;
    void prefetch(OUTBOUND_OPENER).then((engine) => !cancelled && setOpenerEngine(engine));
    return () => {
      cancelled = true;
    };
  }, [voice, direction, phase, prefetch]);

  // Call timer.
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    transcriptRef.current?.lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [lines]);

  useEffect(
    () => () => {
      if (dialTimer.current) clearTimeout(dialTimer.current);
    },
    [],
  );

  const name = detail?.plan.displayName ?? "the patient";
  const firstName = name.split(" ")[0];

  function begin() {
    setLines([]);
    setTurns([]);
    setSummary(null);
    setTurnError(null);
    setDraft("");
    if (direction === "outbound") {
      setPhase("ringing");
    } else {
      setPhase("dialing");
      dialTimer.current = setTimeout(() => connect("inbound"), 1400);
    }
  }

  function connect(dir: Direction) {
    const t = Date.now();
    setStartedAt(t);
    setNow(t);
    setPhase("live");
    if (dir === "outbound") {
      setLines([{ id: lineId(), who: "anchor", text: OUTBOUND_OPENER }]);
      void speaker.speak(OUTBOUND_OPENER);
    } else {
      setLines([{ id: lineId(), who: "system", text: `Connected. OpenClaw authenticated the call. ${firstName} speaks first.` }]);
    }
  }

  async function send(text: string) {
    const utterance = text.trim();
    if (!utterance || busy || phase !== "live") return;
    dictation.stop();
    speaker.stop();
    setBusy(true);
    setTurnError(null);
    setDraft("");
    try {
      const result = await api.checkin({ patientId, direction, utterance });
      const turn: CallTurn = {
        tier: result.triage.tier,
        escalated: !!result.escalation,
        gated: !!result.gateRequest,
      };
      setTurns((prev) => [...prev, turn]);
      setLines((prev) => [
        ...prev,
        { id: lineId(), who: "patient", text: utterance, ...turn },
        { id: lineId(), who: "anchor", text: result.reply },
      ]);
      void speaker.speak(result.reply);
    } catch (e) {
      setTurnError(e instanceof Error ? e.message : "That turn didn't go through. Try again.");
      setDraft(utterance);
    } finally {
      setBusy(false);
    }
  }

  function hangUp() {
    dictation.stop();
    speaker.stop();
    if (dialTimer.current) clearTimeout(dialTimer.current);
    const end = Date.now();
    setSummary(summarizeCall(turns, startedAt ?? end, end));
    setPhase("ended");
  }

  function decline() {
    setPhase("idle");
    setLines([]);
  }

  if (loadError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not open the call</AlertTitle>
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  }

  const cloningReady = status?.twin.cloning === "configured";
  const escalatedNow = turns.some((t) => t.escalated);
  const heardEngine = speaker.engine ?? openerEngine;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Dashboard
      </Link>

      <div className="grid gap-6 lg:grid-cols-[400px_1fr] lg:items-start">
        {/* ---------- Phone ---------- */}
        <section
          aria-label="Call"
          className="mx-auto flex h-[640px] w-full max-w-[400px] flex-col overflow-hidden rounded-[2rem] border-8 border-[#111] bg-[#111] text-white shadow-xl"
        >
          <div className="flex items-center justify-between px-5 pb-2 pt-3 text-xs text-white/60">
            <span>{phase === "live" && startedAt ? formatDuration((now - startedAt) / 1000) : "Anchor"}</span>
            <span className="flex items-center gap-1">
              <span className={cn("size-1.5 rounded-full", phase === "live" ? "bg-brand" : "bg-white/40")} aria-hidden />
              {phase === "live" ? "Connected" : phase === "ringing" ? "Incoming call" : phase === "dialing" ? "Calling" : phase === "ended" ? "Call ended" : "Ready"}
            </span>
          </div>

          {!detail || !voice ? (
            <div className="flex flex-1 flex-col gap-3 p-6">
              <Skeleton className="h-20 rounded-xl bg-white/10" />
              <Skeleton className="h-40 rounded-xl bg-white/10" />
            </div>
          ) : phase === "idle" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
              <Avatar label={firstName} />
              <div>
                <p className="text-xl font-semibold">{name}</p>
                <p className="mt-1 text-sm text-white/60">
                  {twin ? `Digital Twin voice ready · consented by ${twin.consent.consentedBy}` : "No Digital Twin voice yet"}
                </p>
              </div>
              <div role="radiogroup" aria-label="Call direction" className="grid w-full grid-cols-2 gap-2 rounded-xl bg-white/10 p-1">
                {(["outbound", "inbound"] as const).map((d) => (
                  <button
                    key={d}
                    role="radio"
                    aria-checked={direction === d}
                    onClick={() => setDirection(d)}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand",
                      direction === d ? "bg-white text-[#111]" : "text-white/70 hover:text-white",
                    )}
                  >
                    {d === "outbound" ? <PhoneOutgoing className="size-4" /> : <PhoneIncoming className="size-4" />}
                    {d === "outbound" ? "Anchor calls" : `${firstName} calls`}
                  </button>
                ))}
              </div>
              <p className="text-xs text-white/60">
                {direction === "outbound"
                  ? "Outbound: Anchor rings the patient and opens with the clinician-approved line."
                  : "Inbound: the patient calls Anchor and speaks first."}
              </p>
              <Button size="lg" variant="brand" className="w-full rounded-full" onClick={begin}>
                <Phone /> {direction === "outbound" ? "Place the call" : "Call Anchor"}
              </Button>
            </div>
          ) : phase === "ringing" ? (
            <div className="flex flex-1 flex-col items-center justify-between px-6 py-10 text-center">
              <div className="flex flex-col items-center gap-4">
                <p className="text-sm text-white/60">Incoming call on {firstName}&apos;s phone</p>
                <Avatar label="A" ring />
                <p className="text-2xl font-semibold">Anchor</p>
                <p className="text-sm text-white/60">Your Digital Twin · synthetic voice</p>
              </div>
              <div className="flex w-full justify-around">
                <RoundButton label="Decline" tone="danger" onClick={decline}>
                  <PhoneOff />
                </RoundButton>
                <RoundButton label="Answer" tone="accept" onClick={() => connect("outbound")} autoFocus>
                  <Phone />
                </RoundButton>
              </div>
            </div>
          ) : phase === "dialing" ? (
            <div className="flex flex-1 flex-col items-center justify-between px-6 py-10 text-center">
              <div className="flex flex-col items-center gap-4">
                <Avatar label="A" ring />
                <p className="text-2xl font-semibold">Calling Anchor…</p>
                <p className="text-sm text-white/60">OpenClaw authenticates the caller and hands off to the Digital Twin.</p>
              </div>
              <RoundButton label="Cancel" tone="danger" onClick={hangUp}>
                <PhoneOff />
              </RoundButton>
            </div>
          ) : phase === "live" ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <ol ref={transcriptRef} aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-2">
                {lines.map((l) => (
                  <Bubble key={l.id} line={l} firstName={firstName} />
                ))}
                {busy ? (
                  <li className="flex items-center gap-2 self-start text-xs text-white/60">
                    <Loader2 className="size-3 animate-spin" /> Anchor is classifying on the box…
                  </li>
                ) : null}
              </ol>
              {escalatedNow ? (
                <p role="status" className="mx-4 mb-2 rounded-lg bg-tier-3 px-3 py-2 text-xs text-white">
                  <AlertTriangle className="mr-1 inline size-3.5" /> Clinician notified. escalate_to_clinician() fired with no gate.
                </p>
              ) : null}
              {turnError ? <p className="mx-4 mb-2 text-xs text-red-300">{turnError}</p> : null}
              <form
                className="flex items-center gap-2 border-t border-white/10 p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(draft);
                }}
              >
                {dictation.supported ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className={cn("shrink-0 rounded-full text-white hover:bg-white/10 hover:text-white", dictation.listening && "bg-tier-3 hover:bg-tier-3")}
                    aria-label={dictation.listening ? "Stop dictation" : "Speak"}
                    onClick={dictation.listening ? dictation.stop : dictation.start}
                  >
                    {dictation.listening ? <MicOff /> : <Mic />}
                  </Button>
                ) : null}
                <Input
                  aria-label={`What ${firstName} says`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={`${firstName} says…`}
                  className="border-white/20 bg-white/10 text-white placeholder:text-white/40"
                  disabled={busy}
                />
                <Button type="submit" size="icon" variant="brand" className="shrink-0 rounded-full" aria-label="Send" disabled={busy || !draft.trim()}>
                  <Send />
                </Button>
              </form>
              <div className="flex justify-center pb-4">
                <RoundButton label="Hang up" tone="danger" onClick={hangUp} small>
                  <PhoneOff />
                </RoundButton>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
              <Avatar label="A" />
              <p className="text-xl font-semibold">Call complete</p>
              {summary ? (
                <dl className="grid w-full grid-cols-2 gap-3 text-left text-sm">
                  <Stat label="Duration" value={formatDuration(summary.durationSec)} />
                  <Stat label="Patient turns" value={String(summary.turns)} />
                  <Stat label="Highest tier" value={summary.highestTier ? `Tier ${summary.highestTier}` : "None"} />
                  <Stat label="Escalations" value={String(summary.escalations)} />
                  <Stat label="Held at the gate" value={String(summary.gateRequests)} />
                  <Stat label="Voice" value={heardEngine ? ENGINE_LABEL[heardEngine].split(" (")[0] : "None"} />
                </dl>
              ) : null}
              <div className="flex w-full flex-col gap-2">
                <Button variant="brand" className="rounded-full" onClick={() => setPhase("idle")}>
                  <Phone /> Call again
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button asChild variant="outline" className="rounded-full border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white">
                    <Link href="/clinician">Clinician queue</Link>
                  </Button>
                  <Button asChild variant="outline" className="rounded-full border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white">
                    <Link href={`/audit`}>Audit log</Link>
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ---------- What Anchor is doing ---------- */}
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Live call{detail ? ` with ${name}` : ""}</h1>
            <p className="mt-1 max-w-2xl text-muted-foreground">
              Every turn is classified on the box and routed through the same safety path as a scheduled check-in.
              Anchor speaks only clinician-vetted lines, in the patient&apos;s Digital Twin voice.
            </p>
          </div>

          <Card className="gap-4">
            <CardHeader>
              <CardTitle role="heading" aria-level={2} className="flex items-center gap-2 text-lg">
                <Headphones className="size-5" /> Voice
              </CardTitle>
              <CardDescription>
                {twin
                  ? `Synthetic copy of ${twin.consent.consentedBy}'s voice, used with ${twin.source === "deployment" ? "consent attested at deployment" : "recorded consent"}.`
                  : "Record a short sample to hear Anchor in the patient's own voice."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div className="flex flex-wrap gap-1.5">
                <Badge variant={twin ? "brand" : "outline"}>{twin ? "Digital Twin enrolled" : "Not enrolled"}</Badge>
                <Badge variant={cloningReady ? "brand" : "outline"}>{cloningReady ? "Cloning server connected" : "No cloning server"}</Badge>
                {heardEngine ? (
                  <Badge variant="outline" className="gap-1">
                    <Volume2 className="size-3" aria-hidden /> {ENGINE_LABEL[heardEngine]}
                  </Badge>
                ) : null}
              </div>
              {twin && !cloningReady ? (
                <p className="text-muted-foreground">
                  The voice is enrolled, but no cloning server is configured, so Anchor falls back to the standard voice.
                  Start the Digital Twin TTS on the GB10 and set ANCHOR_TWIN_TTS_URL.
                </p>
              ) : null}
              {twin ? (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand"
                    checked={selfHearing?.enabled ?? false}
                    onChange={(e) => setSelfHearingOn(e.target.checked)}
                  />
                  Play it as they hear themselves
                </label>
              ) : null}
              <Button asChild size="sm" variant="outline" className="w-fit">
                <Link href={`/twin/${patientId}`}>
                  <ShieldCheck /> {twin ? "Manage the Digital Twin voice" : "Create the Digital Twin voice"}
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="gap-4">
            <CardHeader>
              <CardTitle role="heading" aria-level={2} className="flex items-center gap-2 text-lg">
                <ListChecks className="size-5" /> Routing this call
              </CardTitle>
              <CardDescription>Tier 1 resolves in conversation. Tier 2 waits at the OpenShell gate. Tier 3 escalates, never gated.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {turns.length === 0 ? (
                <p className="text-muted-foreground">No patient turns yet.</p>
              ) : (
                <ol className="flex flex-col gap-2">
                  {turns.map((t, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2">
                      <span className="w-14 text-muted-foreground">Turn {i + 1}</span>
                      <TierBadge tier={t.tier} />
                      {t.escalated ? <Badge variant="tier3">Escalated</Badge> : null}
                      {t.gated ? (
                        <Badge variant="tier2" className="gap-1">
                          <Flag className="size-3" aria-hidden /> Held at the gate
                        </Badge>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
              {phase === "live" ? (
                <div className="flex flex-col gap-2 pt-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sample lines</p>
                  <div className="flex flex-wrap gap-2">
                    {SAMPLE_UTTERANCES.map((s) => (
                      <Button key={s.label} size="sm" variant="outline" disabled={busy} onClick={() => void send(s.text)}>
                        {s.label}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
              <p className="pt-2 text-xs text-muted-foreground">
                {direction === "outbound"
                  ? "In production, place_checkin_call runs only after a clinician approves the script at the gate. This demo simulates an approved call."
                  : "Inbound calls are authenticated by OpenClaw before the Digital Twin answers."}{" "}
                Synthetic patients only. Calls are simulated in the browser.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Avatar({ label, ring = false }: { label: string; ring?: boolean }) {
  return (
    <span className="relative grid size-24 place-items-center">
      {ring ? <span className="absolute inset-0 animate-ping rounded-full bg-brand/40 motion-reduce:animate-none" aria-hidden /> : null}
      <span className="relative grid size-24 place-items-center rounded-full bg-brand text-3xl font-semibold text-brand-foreground">
        {label.slice(0, 1).toUpperCase()}
      </span>
    </span>
  );
}

function RoundButton({
  label,
  tone,
  onClick,
  children,
  small = false,
  autoFocus = false,
}: {
  label: string;
  tone: "accept" | "danger";
  onClick: () => void;
  children: React.ReactNode;
  small?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <span className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        autoFocus={autoFocus}
        className={cn(
          "grid place-items-center rounded-full text-white outline-none transition-transform focus-visible:ring-4 focus-visible:ring-white/60 active:scale-95 [&_svg]:size-6",
          small ? "size-12" : "size-16",
          tone === "accept" ? "bg-[#1f9d55] hover:bg-[#1a8a4a]" : "bg-[#d93025] hover:bg-[#c1271d]",
        )}
      >
        {children}
      </button>
      {small ? null : <span className="text-xs text-white/70">{label}</span>}
    </span>
  );
}

function Bubble({ line, firstName }: { line: Line; firstName: string }) {
  if (line.who === "system") {
    return <li className="self-center px-2 text-center text-xs text-white/50">{line.text}</li>;
  }
  const mine = line.who === "patient";
  return (
    <li className={cn("flex max-w-[85%] flex-col gap-1", mine ? "self-end items-end" : "self-start items-start")}>
      <span className="text-[11px] text-white/50">{mine ? firstName : "Anchor · Digital Twin"}</span>
      <p className={cn("rounded-2xl px-3 py-2 text-sm leading-relaxed", mine ? "rounded-br-sm bg-white text-[#111]" : "rounded-bl-sm bg-white/15")}>
        {line.text}
      </p>
      {line.who === "patient" ? <TierBadge tier={line.tier} className="text-[11px]" /> : null}
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/10 px-3 py-2">
      <dt className="text-[11px] text-white/60">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
