# Deploying Anchor on the Dell Pro Max with NVIDIA GB10

Anchor is local-first: the app, MongoDB, the reasoning model, the voice, and OpenClaw all run on the one box, and patient data never leaves it. This guide assumes the GB10 already runs its model and voice servers.

## 1. What runs where

| Service | Default | How Anchor reaches it |
|---|---|---|
| Anchor (this app) | port 3000 | `docker compose up` |
| MongoDB | port 27017 | started by `docker-compose.yml` |
| Reasoning model | any OpenAI-compatible server (vLLM, Ollama, NIM) | `ANCHOR_LLM_BASE_URL`, `ANCHOR_LLM_MODEL` |
| Kokoro TTS | an OpenAI-compatible `/audio/speech` server such as Kokoro-FastAPI | `ANCHOR_TTS_BASE_URL`, `ANCHOR_TTS_VOICE` |
| OpenClaw | your OpenClaw hook endpoint | `OPENCLAW_HOOK_URL`, `OPENCLAW_HOOK_TOKEN` |
| Digital Twin TTS (optional) | Sesame CSM-1B (or XTTS-v2) in `services/twin-tts`, port 8020 | `ANCHOR_TWIN_TTS_URL` (compose profile `twin`) |

The default model id is `qwen-3.8-27b`, the team's whiteboard choice. Set `ANCHOR_LLM_MODEL` to the exact name your server reports at `/v1/models`. Nemotron served through the same kind of endpoint works the same way.

## 2. Start it

```bash
cp .env.example .env         # then fill in the service URLs
docker compose up -d --build
open http://localhost:3000
```

From inside the container, services on the host are at `http://host.docker.internal:<port>`.

To add Digital Twin voice cloning, see [`services/twin-tts/README.md`](../services/twin-tts/README.md). It is opt-in:

```bash
ANCHOR_TWIN_TTS_URL=http://twin-tts:8020/twin HF_TOKEN=... docker compose --profile twin up -d --build
```

To run the demo in the hackathon's consented voice, mount the T7 bundle into the `anchor` container (for example with a `docker-compose.override.yml` that adds `- /media/dell/T7/hackathon-2026-08-22:/bundle:ro` under `volumes`), then set `ANCHOR_DEMO_TWIN_WAV=/bundle/<path>/self_ref.wav`, `ANCHOR_DEMO_TWIN_TEXT=/bundle/<path>/self_ref.txt`, `ANCHOR_DEMO_TWIN_PATIENT`, and `ANCHOR_DEMO_TWIN_CONSENTED_BY`.

## 3. Check it

The status strip on the dashboard shows each adapter: live, or its fallback.

```bash
curl -s localhost:3000/api/status
```

A healthy GB10 deployment reports `"model": {"status": "reachable"}`, `"store": {"kind": "mongodb"}`, `"tts": {"engine": "kokoro"}`, and `"openclaw": {"hook": "configured"}`.

## 4. Without the box

`npm run mock:gb10` starts stand-ins for the model, Kokoro, and the OpenClaw hook on port 8765, so every live adapter path can be exercised on a laptop:

```bash
npm run mock:gb10 &
ANCHOR_LLM_BASE_URL=http://localhost:8765/v1 \
ANCHOR_TTS_BASE_URL=http://localhost:8765/v1 \
OPENCLAW_HOOK_URL=http://localhost:8765/hook OPENCLAW_HOOK_TOKEN=dev-token \
npm run dev
```

## 5. Before any real use

This is a hackathon build with synthetic data. Real patients require clinical validation of the triage rules, authentication and roles, a security review, and a compliance review. Local processing is a head start on data protection, not a HIPAA guarantee.
