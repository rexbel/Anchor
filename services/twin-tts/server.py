"""
Anchor Digital Twin TTS: an XTTS-v2 voice-cloning server that speaks Anchor's
twin contract.

    POST /twin    {"text": str, "language": "en", "speaker_wav": <base64 16-bit PCM WAV>,
                   "speaker_text": str (exact transcript; required by the csm engine)}
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
- TWIN_ENGINE picks the model:
    csm   Sesame CSM-1B (Apache-2.0). Conditions on a 3-12 s reference plus its
          exact transcript. The engine the hackathon GB10 build used.
    xtts  Coqui XTTS-v2. Non-commercial CPML: refuses to load unless
          COQUI_TOS_AGREED=1 is set explicitly.
    stub  a tone; needs only numpy. For contract tests without a GPU.
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
ENGINE = os.environ.get("TWIN_ENGINE", "csm")  # csm | xtts | stub
MODEL_NAME = os.environ.get("TWIN_MODEL", "tts_models/multilingual/multi-dataset/xtts_v2")
MAX_TEXT = int(os.environ.get("TWIN_MAX_TEXT", "1200"))
MAX_SAMPLE_BYTES = int(os.environ.get("TWIN_MAX_SAMPLE_BYTES", str(6 * 1024 * 1024)))
MAX_BODY_BYTES = MAX_SAMPLE_BYTES * 4 // 3 + 64 * 1024
CACHE_SIZE = int(os.environ.get("TWIN_CACHE_SIZE", "32"))
CACHE_TTL_S = float(os.environ.get("TWIN_CACHE_TTL_S", "600"))

# XTTS-v2 languages.
LANGUAGES = {"en", "es", "fr", "de", "it", "pt", "pl", "tr", "ru", "nl", "cs", "ar", "zh-cn", "hu", "ko", "ja", "hi"}


CSM_MIN_REF_S, CSM_MAX_REF_S, CSM_MAX_CHUNK = 3.0, 12.0, 400


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

    def __init__(self, require_transcript: bool = False) -> None:
        self.require_transcript = require_transcript

    def synthesize(self, text: str, language: str, sample: bytes, key: str, speaker_text: str | None = None) -> tuple[np.ndarray, int]:
        audio, rate = decode_wav(sample)  # validates the sample like the real engine
        if self.require_transcript:
            check_csm_reference(audio, rate, speaker_text)
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

    def synthesize(self, text: str, language: str, sample: bytes, key: str, speaker_text: str | None = None) -> tuple[np.ndarray, int]:
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


def check_csm_reference(audio: np.ndarray, rate: int, speaker_text: str | None) -> None:
    if not speaker_text:
        raise BadRequest("The csm engine needs speaker_text: the exact words spoken in speaker_wav.")
    seconds = audio.size / rate
    if not CSM_MIN_REF_S <= seconds <= CSM_MAX_REF_S:
        raise BadRequest(
            f"The csm engine needs a {CSM_MIN_REF_S:.0f}-{CSM_MAX_REF_S:.0f} s reference (got {seconds:.1f} s). "
            "Re-record the short reading passage."
        )


def split_for_csm(text: str, limit: int = CSM_MAX_CHUNK) -> list[str]:
    """Split on sentence ends so each generation stays short; CSM is best at a sentence or two."""
    import re

    sentences = [s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s]
    chunks: list[str] = []
    for sentence in sentences:
        while len(sentence) > limit:  # a run-on sentence: cut at the last space
            cut = sentence.rfind(" ", 0, limit)
            cut = cut if cut > 0 else limit
            chunks.append(sentence[:cut].strip())
            sentence = sentence[cut:].strip()
        if chunks and len(chunks[-1]) + 1 + len(sentence) <= limit:
            chunks[-1] = f"{chunks[-1]} {sentence}"
        elif sentence:
            chunks.append(sentence)
    return chunks


class CsmEngine:
    """Sesame CSM-1B through Transformers, BF16 on CUDA. Port of the GB10 hackathon backend."""

    name = "csm-1b"
    SAMPLE_RATE = 24000

    def __init__(self) -> None:
        import torch
        import torchaudio.functional as AF
        from transformers import AutoProcessor, CsmForConditionalGeneration

        self.torch, self.AF = torch, AF
        model_id = os.environ.get("TWIN_CSM_MODEL", "sesame/csm-1b")
        local_only = os.path.isdir(model_id)
        self.device = os.environ.get("TWIN_DEVICE") or ("cuda" if torch.cuda.is_available() else "cpu")
        dtype = torch.bfloat16 if self.device == "cuda" else torch.float32
        t0 = time.perf_counter()
        self.processor = AutoProcessor.from_pretrained(model_id, local_files_only=local_only)
        self.model = CsmForConditionalGeneration.from_pretrained(
            model_id, device_map=self.device, torch_dtype=dtype, local_files_only=local_only
        )
        self.dtype = next(self.model.parameters()).dtype
        log.info("CSM-1B loaded on %s (%s) in %.1fs", self.device, self.dtype, time.perf_counter() - t0)
        self.lock = threading.Lock()
        self.ready = True

    def _reference(self, sample: bytes, speaker_text: str | None) -> np.ndarray:
        audio, rate = decode_wav(sample)
        check_csm_reference(audio, rate, speaker_text)
        if rate != self.SAMPLE_RATE:
            tensor = self.AF.resample(self.torch.from_numpy(audio.copy()).unsqueeze(0), rate, self.SAMPLE_RATE)
            audio = tensor.squeeze(0).numpy()
        return np.clip(audio, -1.0, 1.0).astype(np.float32)

    def _generate(self, reference: np.ndarray, speaker_text: str, text: str) -> np.ndarray:
        conversation = [
            {"role": "0", "content": [{"type": "text", "text": speaker_text}, {"type": "audio", "path": reference}]},
            {"role": "0", "content": [{"type": "text", "text": text}]},
        ]
        inputs = self.processor.apply_chat_template(conversation, tokenize=True, return_dict=True).to(self.device)
        # GB10 fix from the hackathon build: floating inputs must match the BF16 weights.
        inputs = {k: v.to(dtype=self.dtype) if v.is_floating_point() else v for k, v in inputs.items()}
        out = self.model.generate(**inputs, output_audio=True)
        wav = out[0] if isinstance(out, (list, tuple)) else out
        return wav.detach().float().cpu().numpy().reshape(-1)

    def synthesize(self, text: str, language: str, sample: bytes, key: str, speaker_text: str | None = None) -> tuple[np.ndarray, int]:
        if language != "en":
            raise BadRequest("The csm engine speaks English only.")
        reference = self._reference(sample, speaker_text)
        pieces = []
        with self.lock, self.torch.inference_mode():
            for chunk in split_for_csm(text):
                pieces.append(self._generate(reference, speaker_text or "", chunk))
                pieces.append(np.zeros(int(self.SAMPLE_RATE * 0.12), dtype=np.float32))  # short breath between sentences
        return np.concatenate(pieces[:-1] if len(pieces) > 1 else pieces), self.SAMPLE_RATE

    def cached(self) -> int:
        return 0


# ---------- HTTP ----------

def parse_request(body: bytes) -> tuple[str, str, bytes, str | None]:
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
    speaker_text = payload.get("speaker_text")
    if speaker_text is not None and not isinstance(speaker_text, str):
        raise BadRequest("speaker_text must be a string.")
    speaker_text = " ".join(speaker_text.split())[:2000] if speaker_text else None
    return text.strip(), language, sample, speaker_text


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
                text, language, sample, speaker_text = parse_request(self.rfile.read(length))
                key = hashlib.sha256(sample + (speaker_text or "").encode()).hexdigest()
                t0 = time.perf_counter()
                audio, rate = engine.synthesize(text, language, sample, key, speaker_text)
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
    if ENGINE == "stub":
        return StubEngine()
    if ENGINE == "stub-csm":  # the csm engine's request rules, without the model
        return StubEngine(require_transcript=True)
    if ENGINE == "csm":
        return CsmEngine()
    if ENGINE == "xtts":
        return XttsEngine()
    raise SystemExit(f"Unknown TWIN_ENGINE '{ENGINE}'. Use csm, xtts, or stub.")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    engine = build_engine()
    server = ThreadingHTTPServer((HOST, PORT), make_handler(engine))
    log.info("Anchor twin TTS (%s on %s) listening on http://%s:%d/twin", engine.name, engine.device, HOST, PORT)
    server.serve_forever()


if __name__ == "__main__":
    main()
