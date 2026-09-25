"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Headphones, Loader2, Mic, Play, ShieldCheck, Square, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { playProcessed, toReferenceWav, type Playback } from "@/components/app/self-hearing";
import { useSpeaker } from "@/components/app/voice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type PatientDetail, type VoiceState } from "@/lib/client/api";
import type { SelfHearing } from "@/lib/domain/schemas";
import { encodeWav } from "@/lib/voice/wav";

const READING_PASSAGE =
  "Most mornings I make coffee, check the weather, and take the long way to work. " +
  "I like quiet streets, a good song on the radio, and talking with people I trust. " +
  "When the day gets hard, I slow down, take a breath, and remember what I'm working toward.";

const PREVIEW_LINE = "Hey, it's me. Checking in like we planned. How did today go?";

type Pending = { wav: Uint8Array; seconds: number; url: string };

export function TwinVoice({ patientId }: { patientId: string }) {
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [voice, setVoice] = useState<VoiceState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, v] = await Promise.all([api.patient(patientId), api.voice(patientId)]);
      setDetail(d);
      setVoice(v);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this patient.");
    }
  }, [patientId]);

  useEffect(() => {
    // Initial fetch on mount; state is set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load the Digital Twin voice</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Link href={`/checkin/${patientId}`} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to check-in
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Digital Twin voice{detail ? ` for ${detail.plan.displayName}` : ""}
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          The patient records a short sample of their own voice and consents to a synthetic copy. Anchor then speaks
          check-ins in that voice, optionally shaped to sound the way they hear themselves.
        </p>
        <p className="text-xs text-muted-foreground">
          Demo build with synthetic patients. Not a medical device, and no HIPAA compliance claim.
        </p>
      </div>

      {!voice ? (
        <Skeleton className="h-80 rounded-xl" />
      ) : voice.profile ? (
        <ProfileCard patientId={patientId} voice={voice} onChange={load} />
      ) : (
        <EnrollCard patientId={patientId} voice={voice} onEnrolled={load} />
      )}
    </div>
  );
}

/* ---------- Enrollment ---------- */

function EnrollCard({ patientId, voice, onEnrolled }: { patientId: string; voice: VoiceState; onEnrolled: () => void }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [consentName, setConsentName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { minSec, maxSec } = voice.limits;

  const accept = useCallback(
    async (blob: Blob) => {
      setProblem(null);
      try {
        const { wav, seconds } = await toReferenceWav(blob, encodeWav);
        if (seconds < minSec || seconds > maxSec) {
          setProblem(`The recording is ${seconds.toFixed(1)} s. It needs to be ${minSec} to ${maxSec} seconds.`);
          return;
        }
        setPending((prev) => {
          if (prev) URL.revokeObjectURL(prev.url);
          return { wav, seconds, url: URL.createObjectURL(new Blob([wav as BlobPart], { type: "audio/wav" })) };
        });
      } catch {
        setProblem("That file couldn't be read as audio. Try a WAV, MP3, or M4A recording.");
      }
    },
    [minSec, maxSec],
  );

  async function startRecording() {
    setProblem(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void accept(new Blob(chunks, { type: rec.mimeType }));
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
      setElapsed(0);
      const t0 = Date.now();
      timerRef.current = setInterval(() => {
        const s = (Date.now() - t0) / 1000;
        setElapsed(s);
        if (s >= maxSec) stopRecording();
      }, 200);
    } catch {
      setProblem("Microphone permission was denied, or no microphone is available. You can upload a file instead.");
    }
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    setRecording(false);
  }

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  async function submit() {
    if (!pending) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.enrollVoice({ patientId, wav: pending.wav, consentName });
      toast.success("Digital Twin voice created.");
      onEnrolled();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Enrollment failed.");
    } finally {
      setBusy(false);
    }
  }

  const ready = !!pending && consent && consentName.trim().length > 0 && !busy;

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="flex items-center gap-2 text-xl">
          <Mic className="size-5" /> Record a reference sample
        </CardTitle>
        <CardDescription>
          {minSec} to {maxSec} seconds in a quiet room. Reading the passage below out loud, at a normal pace, takes about 20 seconds.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <blockquote className="rounded-lg bg-muted p-4 text-base leading-relaxed">{READING_PASSAGE}</blockquote>

        <div className="flex flex-wrap items-center gap-3">
          {recording ? (
            <Button variant="destructive" onClick={stopRecording}>
              <Square /> Stop ({elapsed.toFixed(0)} s)
            </Button>
          ) : (
            <Button onClick={() => void startRecording()}>
              <Mic /> {pending ? "Record again" : "Start recording"}
            </Button>
          )}
          <Label className="cursor-pointer rounded-md border px-3 py-2 text-sm font-normal hover:bg-muted">
            <Upload className="size-4" /> Upload a file
            <input
              type="file"
              accept="audio/*"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void accept(f);
                e.target.value = "";
              }}
            />
          </Label>
          {pending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <audio controls src={pending.url} className="h-9" />
              {pending.seconds.toFixed(1)} s
            </div>
          ) : null}
        </div>

        <fieldset className="flex flex-col gap-3 rounded-lg border p-4">
          <legend className="px-1 text-sm font-medium">Consent</legend>
          <p className="text-sm">{voice.consentStatement}</p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-brand" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            I have read this and I agree.
          </label>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="consent-name">Patient types their full name</Label>
            <Input id="consent-name" value={consentName} onChange={(e) => setConsentName(e.target.value)} autoComplete="off" className="max-w-sm" />
          </div>
        </fieldset>

        {problem ? (
          <Alert variant="destructive">
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter>
        <Button disabled={!ready} onClick={() => void submit()}>
          {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Create Digital Twin voice
        </Button>
      </CardFooter>
    </Card>
  );
}

/* ---------- Active profile ---------- */

function ProfileCard({ patientId, voice, onChange }: { patientId: string; voice: VoiceState; onChange: () => void }) {
  const profile = voice.profile!;
  const [settings, setSettings] = useState<SelfHearing>(profile.selfHearing);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [sampleMode, setSampleMode] = useState<"raw" | "self" | null>(null);
  const playbackRef = useRef<Playback | null>(null);
  const speaker = useSpeaker({ patientId, selfHearing: settings });

  const stopSample = useCallback(() => {
    playbackRef.current?.stop();
    playbackRef.current = null;
    setSampleMode(null);
  }, []);
  useEffect(() => stopSample, [stopSample]);

  async function playSample(mode: "raw" | "self") {
    stopSample();
    speaker.stop();
    const res = await fetch(`/api/voices/${profile.id}/sample`, { cache: "no-store" });
    if (!res.ok) return toast.error("The sample could not be loaded.");
    const playback = await playProcessed(await res.blob(), mode === "self" ? { ...settings, enabled: true } : { ...settings, enabled: false });
    playbackRef.current = playback;
    setSampleMode(mode);
    void playback.ended.then(() => playbackRef.current === playback && setSampleMode(null));
  }

  async function save(next: SelfHearing) {
    try {
      await api.updateVoice(profile.id, next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the settings.");
    }
  }

  async function revoke() {
    try {
      await api.revokeVoice(profile.id);
      toast.success("Consent withdrawn. The recording was deleted.");
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not withdraw consent.");
    }
  }

  const set = (patch: Partial<SelfHearing>, persist = false) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    if (persist) void save(next);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2} className="flex items-center gap-2 text-xl">
            <ShieldCheck className="size-5" /> Active Digital Twin
          </CardTitle>
          <CardDescription>
            Consent given by <span className="font-medium text-foreground">{profile.consent.consentedBy}</span> on{" "}
            {new Date(profile.consent.attestedAt).toLocaleString()}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline">{profile.sample.durationSec} s reference sample</Badge>
            <Badge variant="outline">{(profile.sample.sampleRate / 1000).toFixed(2)} kHz WAV</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => (sampleMode === "raw" ? stopSample() : void playSample("raw"))}>
              {sampleMode === "raw" ? <Square /> : <Play />} Sample as recorded
            </Button>
            <Button variant="outline" size="sm" onClick={() => (sampleMode === "self" ? stopSample() : void playSample("self"))}>
              {sampleMode === "self" ? <Square /> : <Headphones />} Sample as they hear themselves
            </Button>
          </div>
          <div className="flex flex-col gap-2 rounded-lg bg-muted p-3">
            <p>&ldquo;{PREVIEW_LINE}&rdquo;</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => (speaker.speaking ? speaker.stop() : void speaker.speak(PREVIEW_LINE))}>
                {speaker.speaking ? <Square /> : <Play />} Preview check-in line
              </Button>
              {speaker.engine ? (
                <span className="text-xs text-muted-foreground">
                  Voice: {speaker.engine === "twin" ? "Digital Twin (cloned)" : speaker.engine === "kokoro" ? "Kokoro (no clone server configured)" : "browser fallback (effect not applied)"}
                </span>
              ) : null}
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          {confirmRevoke ? (
            <>
              <Button variant="destructive" size="sm" onClick={() => void revoke()}>
                <Trash2 /> Yes, withdraw consent and delete the recording
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmRevoke(false)}>
                Keep it
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setConfirmRevoke(true)}>
              <Trash2 /> Withdraw consent
            </Button>
          )}
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2} className="flex items-center gap-2 text-xl">
            <Headphones className="size-5" /> As they hear themselves
          </CardTitle>
          <CardDescription>
            Your own voice reaches you through your skull as well as the air, so it sounds fuller and lower than a
            recording. These settings shape rendered speech toward that sound.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-brand" checked={settings.enabled} onChange={(e) => set({ enabled: e.target.checked }, true)} />
            Apply to check-ins for this patient
          </label>
          <Slider label="Warmth (bone conduction)" unit="dB" min={0} max={12} step={0.5} value={settings.lowShelfDb} format={(v) => `+${v}`} onChange={(v) => set({ lowShelfDb: v })} onCommit={() => void save(settings)} />
          <Slider label="Softer highs" unit="dB" min={-12} max={0} step={0.5} value={settings.highShelfDb} format={(v) => `${v}`} onChange={(v) => set({ highShelfDb: v })} onCommit={() => void save(settings)} />
          <Slider label="Inside-the-head reverb" unit="%" min={0} max={0.5} step={0.01} value={settings.reverbMix} format={(v) => `${Math.round(v * 100)}`} onChange={(v) => set({ reverbMix: v })} onCommit={() => void save(settings)} />
          <p className="text-xs text-muted-foreground">
            Applies to rendered voices (Digital Twin or Kokoro). The browser&apos;s built-in voice can&apos;t be processed.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Slider({
  label,
  unit,
  min,
  max,
  step,
  value,
  format,
  onChange,
  onCommit,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  onCommit: () => void;
}) {
  const id = `slider-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between">
        <Label htmlFor={id}>{label}</Label>
        <span className="tabular-nums text-muted-foreground">
          {format(value)} {unit}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        className="accent-brand"
      />
    </div>
  );
}
