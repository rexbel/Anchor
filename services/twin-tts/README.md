# Anchor Digital Twin TTS

A small voice-cloning server that speaks Anchor's twin contract, so `ANCHOR_TWIN_TTS_URL` can point at it.

```
POST /twin    {"text": "...", "language": "en", "speaker_wav": "<base64 16-bit PCM WAV>", "speaker_text": "..."}  ->  audio/wav, 24 kHz mono
GET  /health  {"engine": "csm-1b", "device": "cuda", "ready": true, "cached_speakers": 0}
```

## Engines (`TWIN_ENGINE`)

| Engine | Model | License | Needs |
|---|---|---|---|
| `csm` (default) | Sesame CSM-1B, BF16 on CUDA | Apache-2.0 | a 3 to 12 s reference **and its exact transcript** (`speaker_text`). English only. |
| `xtts` | Coqui XTTS-v2 | Coqui Public Model License: **non-commercial**. Won't load until `COQUI_TOS_AGREED=1`. | a reference of 6 s or more; 17 languages |
| `stub` / `stub-csm` | none (a tone) | n/a | nothing; for contract tests |

`csm` is a port of the backend the hackathon GB10 build (`anchor-nvidia-gb10`) ran: same conversation format and the same fix of casting floating inputs to the BF16 weights. Long replies are split into sentences and joined with short pauses. CSM-1B is gated on Hugging Face. Accept its terms and either set `HF_TOKEN`, or copy the weights into the `twin-models` volume and set `TWIN_CSM_MODEL=/models/sesame-csm-1b` (the hackathon T7 bundle has them).

## Run on the GB10 (Docker)

From the Anchor repo root:

```bash
ANCHOR_TWIN_TTS_URL=http://twin-tts:8020/twin HF_TOKEN=... docker compose --profile twin up -d --build
docker compose logs -f twin-tts     # wait for "CSM-1B loaded on cuda"
curl -s localhost:8020/health
```

Compose wires Anchor to it (`ANCHOR_TWIN_TTS_URL=http://twin-tts:8020/twin`) and only publishes port 8020 on 127.0.0.1.

The image installs a matching `torch`/`torchaudio` pair from PyTorch's CUDA 13 index, which has aarch64 wheels for the GB10. PyTorch may warn that the GPU's compute capability (12.1) is newer than it expects. The cu130 wheels run on it; the warning is cosmetic. To try a different pair: `--build-arg TORCH_VERSION=...`.

## Run without Docker

```bash
cd services/twin-tts
python3 -m venv .venv && . .venv/bin/activate
pip install torch==2.11.0 torchaudio==2.11.0 --index-url https://download.pytorch.org/whl/cu130
pip install -r requirements.txt
python server.py                           # TWIN_ENGINE=csm by default; listens on 127.0.0.1:8020
```

Then start Anchor with `ANCHOR_TWIN_TTS_URL=http://127.0.0.1:8020/twin`.

## Settings

| Variable | Default | Purpose |
|---|---|---|
| `TWIN_HOST`, `TWIN_PORT` | `127.0.0.1`, `8020` | Bind address. Keep it local. |
| `TWIN_DEVICE` | `cuda` if available | Force `cpu` for testing (slow). |
| `TWIN_CACHE_TTL_S` | `600` | How long a speaker's conditioning latents stay in memory. |
| `TWIN_CACHE_SIZE` | `32` | Max speakers cached. |
| `TWIN_MAX_TEXT` | `1200` | Matches Anchor's TTS limit. |
| `TWIN_ENGINE` | `csm` | `csm`, `xtts`, `stub`, or `stub-csm`. |
| `TWIN_CSM_MODEL` | `sesame/csm-1b` | Hugging Face id or a local directory. |

## Privacy behavior

- The voice sample is never written to disk. CSM takes it as an array in memory; XTTS reads it from an in-memory file (`memfd`).
- Logs record only text length and timings, never the text or audio.
- Latents are cached by the sample's SHA-256 and expire after `TWIN_CACHE_TTL_S`. Once consent is withdrawn in Anchor, the sample is deleted and never sent again, so the cached copy ages out.

## Tests

```bash
TWIN_ENGINE=stub python -m unittest test_server.py   # needs only numpy; covers the csm request rules too
```

## Why not torchaudio.load

XTTS normally loads references through `torchaudio.load`. From torchaudio 2.9 that requires TorchCodec and FFmpeg, which are fragile on aarch64. Anchor always sends 16-bit PCM WAV, so the server decodes it with the standard library and uses torchaudio only for resampling.
