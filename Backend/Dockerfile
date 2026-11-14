# syntax=docker/dockerfile:1.10
#
# TavetaHQ backend API image.
#
# Build context is the REPOSITORY ROOT (the npm workspace lockfile lives there):
#   docker build -f Backend/Dockerfile -t devhq-backend .
# Context filtering: Backend/Dockerfile.dockerignore (BuildKit picks it over the
# root .dockerignore for this Dockerfile).
#
# The backend runs TypeScript directly with Node's type stripping, so there is
# no compile step: the build stage only resolves production dependencies.
#
# Base image is pinned by digest. To bump it:
#   docker buildx imagetools inspect node:22-alpine | grep Digest
# then replace the digest below (Dependabot's `docker` ecosystem proposes the
# same change as a PR). Keep the tag in front of the digest for readability.
ARG NODE_IMAGE=node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202

# ---------------------------------------------------------------------------
# deps: production dependencies only, lifecycle scripts disabled.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# npm validates the lockfile against every workspace manifest, so all three
# package.json files are needed even though only Backend is installed.
COPY package.json package-lock.json .npmrc ./
COPY Backend/package.json Backend/package.json
COPY Frontend/package.json Frontend/package.json
COPY Models/package.json Models/package.json
# Railway requires an id on cache mounts, scoped to the service; empty off Railway.
ARG RAILWAY_SERVICE_ID=local
RUN --mount=type=cache,id=s/${RAILWAY_SERVICE_ID}-npm,target=/root/.npm,sharing=locked \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
      --workspace=Backend --include-workspace-root=false \
 && mkdir -p node_modules Backend/node_modules

# ---------------------------------------------------------------------------
# runtime: no npm/yarn/corepack, non-root, read-only-rootfs compatible.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

ARG VERSION=dev
ARG REVISION=unknown
ARG CREATED=unknown
LABEL org.opencontainers.image.title="devhq-backend" \
      org.opencontainers.image.description="TavetaHQ API server (Node.js, TypeScript via type stripping)" \
      org.opencontainers.image.source="https://github.com/devhq/devhq" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="TavetaHQ" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.created="${CREATED}"

# tini reaps zombies and forwards SIGTERM so server.ts can drain gracefully.
# The same image runs the API (default CMD), the worker and the cron service
# (worker.ts, see infra/railway/).
# npm, npx, corepack and yarn are removed: they are not needed at runtime and
# their bundled dependencies are a recurring source of scanner findings.
# su-exec: infra/docker/entrypoint.sh drops root after fixing the ownership of
# a root-owned volume (Railway); unused when the container starts as 10001.
# hadolint ignore=DL3018
RUN apk add --no-cache tini su-exec \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
 && addgroup -S -g 10001 devhq \
 && adduser -S -D -H -u 10001 -G devhq -s /sbin/nologin devhq \
 && mkdir -p /var/lib/devhq/audit /var/lib/devhq/backups \
 && chown -R 10001:10001 /var/lib/devhq \
 && chmod 0750 /var/lib/devhq

WORKDIR /app/Backend

# Application code is owned by root and not writable by the runtime user.
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/Backend/node_modules /app/Backend/node_modules
COPY package.json /app/package.json
COPY Backend/ /app/Backend/
COPY --chmod=0755 infra/docker/entrypoint.sh /usr/local/bin/devhq-entrypoint

# Writable state lives under /var/lib/devhq (mount a volume there); everything
# else can be mounted read-only.
ENV NODE_ENV=production \
    PORT=8080 \
    AUDIT_LOG_FILE=/var/lib/devhq/audit/audit.jsonl \
    BACKUP_DIR=/var/lib/devhq/backups

USER 10001:10001
EXPOSE 8080

# Liveness only: readiness (/api/ready) is gated by the deploy workflow.
HEALTHCHECK --interval=15s --timeout=4s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/devhq-entrypoint"]
CMD ["node", "--experimental-strip-types", "--disable-warning=ExperimentalWarning", "server.ts"]
