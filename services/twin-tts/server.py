"""
Anchor Digital Twin TTS: an XTTS-v2 voice-cloning server that speaks Anchor's
twin contract.

    POST /twin    {"text": str, "language": "en", "speaker_wav": <base64 16-bit PCM WAV>}
                  -> 200 audio/wav (24 kHz mono), or a JSON error
    GET  /health  -> {"engine", "device", "ready", "cached_speakers"}

Design notes
- Runs next to Anchor on the GB10 and binds to 127.0.0.1 by default.
- Never writes the speaker sample to disk and never logs text or audio; only
  sizes and timings. Conditioning latents are cached in memory by the sample's
  SHA-256 for TWIN_CACHE_TTL_S seconds, so a revoked voice ages out quickly
  (Anchor stops sending the sample the moment consent is withdrawn).
- XTTS normally loads references through torchaudio.load, which needs
  torchcodec/FFmpeg on torchaudio >= 2.9 and is fragile on aarch64. The
  reference is always PCM WAV here, so it is decoded with the stdlib instead.
- TWIN_ENGINE=stub answers with a tone and needs only numpy: use it to test the
  contract without a GPU or the model.

The XTTS-v2 weights are under the Coqui Public Model License (non-commercial).
The server refuses to load them unless COQUI_TOS_AGREED=1 is set explicitly.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import io
import json
import logging
import math
import os
import threading
import time
import wave
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

log = logging.getLogger("twin-tts")

HOST = os.environ.get("TWIN_HOST", "127.0.0.1")
PORT = int(os.environ.get("TWIN_PORT", "8020"))
ENGINE = os.environ.get("TWIN_ENGINE", "xtts")  # xtts | stub
MODEL_NAME = os.environ.get("TWIN_MODEL", "tts_models/multilingual/multi-dataset/xtts_v2")
MAX_TEXT = int(os.environ.get("TWIN_MAX_TEXT", "1200"))
MAX_SAMPLE_BYTES = int(os.environ.get("TWIN_MAX_SAMPLE_BYTES", str(6 * 1024 * 1024)))
MAX_BODY_BYTES = MAX_SAMPLE_BYTES * 4 // 3 + 64 * 1024
CACHE_SIZE = int(os.environ.get("TWIN_CACHE_SIZE", "32"))
CACHE_TTL_S = float(os.environ.get("TWIN_CACHE_TTL_S", "600"))

# XTTS-v2 languages.
LANGUAGES = {"en", "es", "fr", "de", "it", "pt", "pl", "tr", "ru", "nl", "cs", "ar", "zh-cn", "hu", "ko", "ja", "hi"}


class BadRequest(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


# ---------- WAV helpers (stdlib + numpy) ----------

def decode_wav(data: bytes) -> tuple[np.ndarray, int]:
    """16-bit PCM WAV -> mono float32 in [-1, 1], sample rate."""
    try:
        with wave.open(io.BytesIO(data), "rb") as w:
            if w.getsampwidth() != 2:
                raise BadRequest("speaker_wav must be 16-bit PCM WAV.")
            rate, channels = w.getframerate(), w.getnchannels()
            frames = w.readframes(w.getnframes())
    except (wave.Error, EOFError) as err:
        raise BadRequest("speaker_wav is not a valid WAV file.") from err
    audio = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    return audio, rate


def encode_wav(audio: np.ndarray, rate: int) -> bytes:
    pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


# ---------- Engines ----------

class StubEngine:
    """Contract-test engine: a short tone whose length tracks the text."""

    name = "stub"
    device = "cpu"
    ready = True

    def synthesize(self, text: str, language: str, sample: bytes, key: str) -> tuple[np.ndarray, int]:
        audio, rate = decode_wav(sample)  # validates the sample like the real engine
        if audio.size == 0:
            raise BadRequest("speaker_wav is empty.")
        out_rate = 24000
        seconds = min(10.0, 0.3 + 0.05 * len(text))
        t = np.arange(int(out_rate * seconds)) / out_rate
        return (0.2 * np.sin(2 * math.pi * 220 * t)).astype(np.float32), out_rate

    def cached(self) -> int:
        return 0


class XttsEngine:
    name = "xtts-v2"

    def __init__(self) -> None:
        if os.environ.get("COQUI_TOS_AGREED") != "1":
            raise SystemExit(
                "XTTS-v2 is licensed under the non-commercial Coqui Public Model License (https://coqui.ai/cpml).\n"
                "Set COQUI_TOS_AGREED=1 to confirm you accept it (or hold a commercial license), then restart."
            )
        import torch
        import torchaudio.functional as AF
        from TTS.api import TTS
        from TTS.tts.models import xtts as xtts_module

        self.torch = torch
        self.device = os.environ.get("TWIN_DEVICE") or ("cuda" if torch.cuda.is_available() else "cpu")

        # Replace torchaudio.load-based reference loading with a WAV reader.
        # XTTS calls load_audio(path, sr) -> tensor [1, samples] in [-1, 1].
        def load_audio(path, sampling_rate):
            with open(path, "rb") as f:
                audio, rate = decode_wav(f.read())
            tensor = torch.from_numpy(audio.copy()).unsqueeze(0)
            if rate != sampling_rate:
                tensor = AF.resample(tensor, rate, sampling_rate)
            return tensor.clamp_(-1, 1)

        xtts_module.load_audio = load_audio

        t0 = time.perf_counter()
        self.model = TTS(MODEL_NAME).to(self.device).synthesizer.tts_model
        self.output_rate = int(self.model.config.audio.output_sample_rate)
        log.info("XTTS-v2 loaded on %s in %.1fs", self.device, time.perf_counter() - t0)

        self.lock = threading.Lock()  # one GPU inference at a time
        self.cache: OrderedDict[str, tuple[float, object, object]] = OrderedDict()
        self.ready = True

    def _latents(self, sample: bytes, key: str):
        now = time.monotonic()
        hit = self.cache.get(key)
        if hit and now - hit[0] < CACHE_TTL_S:
            self.cache.move_to_end(key)
            return hit[1], hit[2]
        decode_wav(sample)  # validate before handing a path to XTTS
        # XTTS takes a path. Use an in-memory file where the OS offers one, so
        # the voice sample never lands on disk.
        fd = os.memfd_create("anchor-ref", 0) if hasattr(os, "memfd_create") else None
        if fd is None:
            raise RuntimeError("memfd_create is unavailable; run on Linux.")
        try:
            os.write(fd, sample)
            cfg = self.model.config
            gpt_cond_latent, speaker_embedding = self.model.get_conditioning_latents(
                audio_path=f"/proc/self/fd/{fd}",
                gpt_cond_len=cfg.gpt_cond_len,
                gpt_cond_chunk_len=cfg.gpt_cond_chunk_len,
                max_ref_length=cfg.max_ref_len,
                sound_norm_refs=cfg.sound_norm_refs,
            )
        finally:
            os.close(fd)
        self.cache[key] = (now, gpt_cond_latent, speaker_embedding)
        while len(self.cache) > CACHE_SIZE:
            self.cache.popitem(last=False)
        return gpt_cond_latent, speaker_embedding

    def synthesize(self, text: str, language: str, sample: bytes, key: str) -> tuple[np.ndarray, int]:
        with self.lock, self.torch.inference_mode():
            gpt_cond_latent, speaker_embedding = self._latents(sample, key)
            out = self.model.inference(
                text,
                language,
                gpt_cond_latent,
                speaker_embedding,
                enable_text_splitting=True,
            )
        wav = out["wav"]
        wav = wav.cpu().numpy() if hasattr(wav, "cpu") else np.asarray(wav)
        return wav.astype(np.float32).reshape(-1), self.output_rate

    def cached(self) -> int:
        return len(self.cache)


# ---------- HTTP ----------

def parse_request(body: bytes) -> tuple[str, str, bytes]:
    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError) as err:
        raise BadRequest("Body must be JSON.") from err
    if not isinstance(payload, dict):
        raise BadRequest("Body must be a JSON object.")
    text = payload.get("text")
    if not isinstance(text, str) or not text.strip():
        raise BadRequest("text is required.")
    if len(text) > MAX_TEXT:
        raise BadRequest(f"text is too long (max {MAX_TEXT} characters).", 413)
    language = str(payload.get("language") or "en").lower()
    if language not in LANGUAGES:
        raise BadRequest(f"Unsupported language '{language}'.")
    encoded = payload.get("speaker_wav")
    if not isinstance(encoded, str) or not encoded:
        raise BadRequest("speaker_wav (base64 WAV) is required.")
    try:
        sample = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as err:
        raise BadRequest("speaker_wav is not valid base64.") from err
    if len(sample) > MAX_SAMPLE_BYTES:
        raise BadRequest("speaker_wav is too large.", 413)
    return text.strip(), language, sample


def make_handler(engine):
    class Handler(BaseHTTPRequestHandler):
        server_version = "anchor-twin-tts/1"

        def log_message(self, fmt, *args):  # no request lines with paths/bodies in logs
            pass

        def _json(self, status: int, payload: dict) -> None:
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/health":
                return self._json(
                    200,
                    {"engine": engine.name, "device": engine.device, "ready": engine.ready, "cached_speakers": engine.cached()},
                )
            self._json(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/twin":
                return self._json(404, {"error": "not found"})
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0:
                return self._json(400, {"error": "Body is required."})
            if length > MAX_BODY_BYTES:
                return self._json(413, {"error": "Body is too large."})
            try:
                text, language, sample = parse_request(self.rfile.read(length))
                key = hashlib.sha256(sample).hexdigest()
                t0 = time.perf_counter()
                audio, rate = engine.synthesize(text, language, sample, key)
                data = encode_wav(audio, rate)
                log.info("twin: %d chars -> %.1fs audio in %.2fs", len(text), audio.size / rate, time.perf_counter() - t0)
            except BadRequest as err:
                return self._json(err.status, {"error": str(err)})
            except Exception:  # noqa: BLE001 - never leak internals or inputs
                log.exception("twin: synthesis failed")
                return self._json(500, {"error": "Synthesis failed."})
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

    return Handler


def build_engine():
    return StubEngine() if ENGINE == "stub" else XttsEngine()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    engine = build_engine()
    server = ThreadingHTTPServer((HOST, PORT), make_handler(engine))
    log.info("Anchor twin TTS (%s on %s) listening on http://%s:%d/twin", engine.name, engine.device, HOST, PORT)
    server.serve_forever()


if __name__ == "__main__":
    main()
