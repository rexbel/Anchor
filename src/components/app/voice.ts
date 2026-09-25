"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { SelfHearing } from "@/lib/domain/schemas";
import { playProcessed, type Playback } from "./self-hearing";

/**
 * Voice I/O for the demo console.
 *
 * Output through /api/tts, in order: the patient's Digital Twin (cloned voice),
 * Kokoro on the GB10, then the browser's own speech synthesis. Rendered audio
 * can be played "as you hear yourself" (see self-hearing.ts).
 * Input: the browser's speech recognition where available. Typing always works.
 */

export type SpeakEngine = "twin" | "kokoro" | "browser" | "none";

export function useSpeaker(options: { patientId?: string; selfHearing?: SelfHearing | null } = {}) {
  const [speaking, setSpeaking] = useState(false);
  const [engine, setEngine] = useState<SpeakEngine | null>(null);
  const playbackRef = useRef<Playback | null>(null);
  const { patientId, selfHearing } = options;

  const stop = useCallback(() => {
    playbackRef.current?.stop();
    playbackRef.current = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    async (text: string): Promise<SpeakEngine> => {
      stop();
      setSpeaking(true);
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, patientId }),
        });
        if (res.ok && res.headers.get("Content-Type")?.startsWith("audio/")) {
          const used: SpeakEngine = res.headers.get("X-Anchor-Voice-Engine") === "twin" ? "twin" : "kokoro";
          const playback = await playProcessed(
            await res.blob(),
            selfHearing ?? { enabled: false, lowShelfDb: 0, highShelfDb: 0, reverbMix: 0 },
          );
          playbackRef.current = playback;
          void playback.ended.then(() => {
            if (playbackRef.current === playback) setSpeaking(false);
          });
          setEngine(used);
          return used;
        }
      } catch {
        // fall through to the browser voice
      }
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.98;
        utterance.onend = () => setSpeaking(false);
        utterance.onerror = () => setSpeaking(false);
        window.speechSynthesis.speak(utterance);
        setEngine("browser");
        return "browser";
      }
      setSpeaking(false);
      setEngine("none");
      return "none";
    },
    [stop, patientId, selfHearing],
  );

  useEffect(() => stop, [stop]);
  return { speak, stop, speaking, engine };
}

type RecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function getRecognitionCtor(): (new () => RecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => RecognitionLike;
    webkitSpeechRecognition?: new () => RecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useDictation(onText: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<RecognitionLike | null>(null);

  useEffect(() => {
    // Feature detection has to run after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(getRecognitionCtor() !== null);
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    setError(null);
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      const text = Array.from(e.results)
        .map((r) => r[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (text) onText(text);
    };
    rec.onerror = (e) => setError(e.error === "not-allowed" ? "Microphone permission was denied." : `Dictation error: ${e.error}`);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }, [onText]);

  const stop = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  return { supported, listening, error, start, stop };
}
