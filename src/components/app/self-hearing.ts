"use client";

import type { SelfHearing } from "@/lib/domain/schemas";

/**
 * "As you hear yourself": Web Audio playback of rendered speech with a
 * bone-conduction approximation. A low-shelf boost adds the warmth your skull
 * carries, a high-shelf cut softens the air-conducted brightness, and a very
 * short, quiet convolution reverb adds the sense of sound inside the head.
 * Works on audio blobs only; the browser's speechSynthesis cannot be routed
 * through Web Audio.
 */

export type Playback = { stop: () => void; ended: Promise<void> };

let sharedCtx: AudioContext | null = null;
function context(): AudioContext {
  sharedCtx ??= new AudioContext();
  return sharedCtx;
}

/** A short, dense, exponentially decaying stereo impulse (~180 ms). Deterministic. */
function headImpulse(ctx: BaseAudioContext, seconds = 0.18): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const ir = ctx.createBuffer(2, length, ctx.sampleRate);
  let seed = 0x2f6b1d;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0xffffffff) * 2 - 1;
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] = rand() * Math.pow(1 - i / length, 3);
  }
  return ir;
}

/** Builds the processing chain between `source` and `destination`. Exported for tests. */
export function buildSelfHearingChain(ctx: BaseAudioContext, source: AudioNode, destination: AudioNode, s: SelfHearing) {
  const low = ctx.createBiquadFilter();
  low.type = "lowshelf";
  low.frequency.value = 300;
  low.gain.value = s.lowShelfDb;

  const high = ctx.createBiquadFilter();
  high.type = "highshelf";
  high.frequency.value = 3500;
  high.gain.value = s.highShelfDb;

  const dry = ctx.createGain();
  dry.gain.value = 1 - s.reverbMix / 2;
  const wet = ctx.createGain();
  wet.gain.value = s.reverbMix;
  const reverb = ctx.createConvolver();
  reverb.buffer = headImpulse(ctx);

  // A low-shelf boost adds level; trim so peaks don't clip.
  const trim = ctx.createGain();
  trim.gain.value = Math.pow(10, -s.lowShelfDb / 2 / 20);

  source.connect(low).connect(high);
  high.connect(dry).connect(trim);
  high.connect(reverb).connect(wet).connect(trim);
  trim.connect(destination);
  return { low, high, dry, wet, reverb, trim };
}

export async function playProcessed(blob: Blob, settings: SelfHearing): Promise<Playback> {
  const ctx = context();
  if (ctx.state === "suspended") await ctx.resume();
  const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  if (settings.enabled) buildSelfHearingChain(ctx, source, ctx.destination, settings);
  else source.connect(ctx.destination);
  const ended = new Promise<void>((resolve) => (source.onended = () => resolve()));
  source.start();
  return {
    stop: () => {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    },
    ended,
  };
}

/** Decode any browser-playable recording to 16-bit mono PCM WAV at 22.05 kHz (the XTTS reference rate). */
export async function toReferenceWav(blob: Blob, encode: (s: Float32Array, rate: number) => Uint8Array): Promise<{ wav: Uint8Array; seconds: number }> {
  const rate = 22050;
  const decoded = await context().decodeAudioData(await blob.arrayBuffer());
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return { wav: encode(rendered.getChannelData(0), rate), seconds: rendered.duration };
}
