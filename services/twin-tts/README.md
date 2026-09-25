# Anchor Digital Twin TTS (XTTS-v2)

A small voice-cloning server that speaks Anchor's twin contract, so `ANCHOR_TWIN_TTS_URL` can point at it.

```
POST /twin    {"text": "...", "language": "en", "speaker_wav": "<base64 16-bit PCM WAV>"}  ->  audio/wav, 24 kHz mono
GET  /health  {"engine": "xtts-v2", "device": "cuda", "ready": true, "cached_speakers": 1}
```

## License first

The XTTS-v2 weights are under the **Coqui Public Model License, which is non-commercial**. The server won't load them until you set `COQUI_TOS_AGREED=1`, which confirms you accept those terms. That covers a demo or research. A commercial product needs a different cloning model or its own license.

## Run on the GB10 (Docker)

From the Anchor repo root:

```bash
COQUI_TOS_AGREED=1 docker compose --profile twin up -d --build
docker compose logs -f twin-tts     # first start downloads ~1.8 GB of weights into the twin-models volume
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
COQUI_TOS_AGREED=1 python server.py        # listens on 127.0.0.1:8020
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
| `TWIN_ENGINE` | `xtts` | `stub` returns a tone, for contract tests without a GPU. |

## Privacy behavior

- The voice sample is never written to disk. XTTS reads it from an in-memory file (`memfd`).
- Logs record only text length and timings, never the text or audio.
- Latents are cached by the sample's SHA-256 and expire after `TWIN_CACHE_TTL_S`. Once consent is withdrawn in Anchor, the sample is deleted and never sent again, so the cached copy ages out.

## Tests

```bash
TWIN_ENGINE=stub python -m unittest test_server.py   # needs only numpy
```

## Why not torchaudio.load

XTTS normally loads references through `torchaudio.load`. From torchaudio 2.9 that requires TorchCodec and FFmpeg, which are fragile on aarch64. Anchor always sends 16-bit PCM WAV, so the server decodes it with the standard library and uses torchaudio only for resampling.
