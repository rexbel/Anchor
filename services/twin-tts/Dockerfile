# Anchor Digital Twin TTS (Sesame CSM-1B or XTTS-v2) for the Dell Pro Max with NVIDIA GB10 (aarch64, CUDA 13).
# Also builds on x86_64 + NVIDIA. Run with GPU access: see README.md.
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    TWIN_HOST=0.0.0.0 TWIN_PORT=8020 TWIN_ENGINE=csm \
    HF_HOME=/models TTS_HOME=/models XDG_DATA_HOME=/models

# Matching torch/torchaudio pair from PyTorch's CUDA 13 index (aarch64 + x86_64 wheels).
ARG TORCH_VERSION=2.11.0
ARG TORCH_INDEX=https://download.pytorch.org/whl/cu130
RUN pip install torch==${TORCH_VERSION} torchaudio==${TORCH_VERSION} --index-url ${TORCH_INDEX}

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY server.py .

RUN useradd --system --uid 1001 twin && mkdir -p /models && chown twin /models
USER twin
VOLUME ["/models"]
EXPOSE 8020
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8020/health').status==200 else 1)"
CMD ["python", "server.py"]
