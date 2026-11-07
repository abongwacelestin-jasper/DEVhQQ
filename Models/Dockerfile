# syntax=docker/dockerfile:1.7
# DevHQ ML service — FastAPI on uvicorn, Python 3.12, non-root, internal network only.
#
#   docker build -t devhq-models Models/
#   docker run --rm -e ML_SERVICE_TOKEN=... -p 8000:8000 devhq-models
#
# Dependencies are installed from requirements.lock with --require-hashes, so
# the image only ever contains the exact, hash-pinned wheels from uv.lock.

ARG PYTHON_IMAGE=python:3.12-slim-bookworm

# ── build: resolve wheels into an isolated virtualenv ─────────────────────────
FROM ${PYTHON_IMAGE} AS build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /src
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
COPY requirements.lock ./
RUN pip install --require-hashes --only-binary=:all: -r requirements.lock \
 && python -c "import sklearn, fastapi, anthropic, boto3"

# ── runtime ───────────────────────────────────────────────────────────────────
FROM ${PYTHON_IMAGE} AS runtime
LABEL org.opencontainers.image.title="devhq-models" \
      org.opencontainers.image.description="DevHQ ML service (internal)" \
      org.opencontainers.image.licenses="MIT"
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    ML_TRAIN_THREADS=2 \
    MODEL_DIR=/var/lib/devhq-models \
    HOST=0.0.0.0 \
    PORT=8000
RUN groupadd --system --gid 10001 devhq \
 && useradd --system --uid 10001 --gid devhq --home-dir /nonexistent --shell /usr/sbin/nologin devhq \
 && mkdir -p /var/lib/devhq-models \
 && chown devhq:devhq /var/lib/devhq-models
COPY --from=build /opt/venv /opt/venv
WORKDIR /app
COPY --chown=root:root devhq_models ./devhq_models
ENV PYTHONPATH=/app
USER 10001:10001
VOLUME ["/var/lib/devhq-models"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).status == 200 else 1)"]
ENTRYPOINT ["python", "-m", "devhq_models"]
CMD ["serve"]
