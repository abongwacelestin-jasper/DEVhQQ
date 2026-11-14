# syntax=docker/dockerfile:1.10
#
# TavetaHQ web app image: Vite build -> static files served by unprivileged Caddy.
#
# Build context is the REPOSITORY ROOT (the npm workspace lockfile lives there):
#   docker build -f Frontend/Dockerfile -t devhq-frontend .
# Context filtering: Frontend/Dockerfile.dockerignore.
#
# One image for both deployments (infra/frontend/Caddyfile):
#   Compose  behind the edge on :8081, API paths answer 404 (the edge routes them)
#   Railway  public service on $PORT, API_MODE=proxy -> backend.railway.internal
#
# Base images are pinned by digest. To bump one:
#   docker buildx imagetools inspect node:22-alpine | grep Digest
#   docker buildx imagetools inspect caddy:2.11-alpine | grep Digest
# and replace the digest (Dependabot's `docker` ecosystem opens the same PR).
ARG NODE_IMAGE=node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202
ARG CADDY_IMAGE=caddy:2.11-alpine@sha256:78bd35025c7ba85961dd149ae670315129954e77abe2383ac47c89106b35ade9

# ---------------------------------------------------------------------------
# deps: full Frontend dependency tree (build tooling lives in devDependencies).
# Also the base of the dev-mode container (docker-compose.dev.yml).
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY Frontend/package.json Frontend/package.json
COPY Backend/package.json Backend/package.json
COPY Models/package.json Models/package.json
# Railway requires an id on cache mounts, scoped to the service; empty off Railway.
ARG RAILWAY_SERVICE_ID=local
RUN --mount=type=cache,id=s/${RAILWAY_SERVICE_ID}-npm,target=/root/.npm,sharing=locked \
    npm ci --ignore-scripts --no-audit --no-fund \
      --workspace=Frontend --include-workspace-root=false \
 && mkdir -p Frontend/node_modules

# ---------------------------------------------------------------------------
# build: Vite production bundle, then pre-compress text assets (br + gzip) so
# the server never compresses static files per request, and write the shell's
# Link preload header (entry chunks, stylesheet, font) for this build's hashes.
# ---------------------------------------------------------------------------
FROM deps AS build
COPY Frontend/ Frontend/
COPY infra/frontend/precompress.mjs infra/frontend/preload-links.mjs infra/frontend/stamp-csp.mjs infra/frontend/Caddyfile /tmp/
RUN npm run build --workspace=Frontend \
 && node /tmp/preload-links.mjs Frontend/dist > /tmp/preload.caddy \
 && node /tmp/stamp-csp.mjs Frontend/dist /tmp/Caddyfile > /tmp/Caddyfile.stamped \
 && node /tmp/precompress.mjs Frontend/dist

# ---------------------------------------------------------------------------
# runtime: static files and one config file. No Node, no shell entrypoint.
# ---------------------------------------------------------------------------
FROM ${CADDY_IMAGE} AS runtime

ARG VERSION=dev
ARG REVISION=unknown
ARG CREATED=unknown
LABEL org.opencontainers.image.title="devhq-frontend" \
      org.opencontainers.image.description="TavetaHQ web app (static SPA on unprivileged Caddy)" \
      org.opencontainers.image.source="https://github.com/devhq/devhq" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="TavetaHQ" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.created="${CREATED}"

# The official binary carries the cap_net_bind_service file capability, which
# exec refuses under `cap_drop: [ALL]` + no-new-privileges (Compose). This
# server listens on an unprivileged port, so the capability is stripped.
# hadolint ignore=DL3018
RUN apk add --no-cache --virtual .setcap libcap \
 && setcap -r /usr/bin/caddy \
 && apk del .setcap \
 && addgroup -S -g 10003 web \
 && adduser -S -D -H -u 10003 -G web -s /sbin/nologin web \
 && rm -rf /srv/* /etc/caddy/Caddyfile

# Files are root-owned and read-only to the runtime user. Caddy's own state
# (unused: no TLS here) goes to /tmp, a tmpfs under Compose.
COPY --from=build /tmp/Caddyfile.stamped /etc/caddy/Caddyfile
COPY --from=build /tmp/preload.caddy /etc/caddy/preload.caddy
COPY --from=build /app/Frontend/dist/ /srv/

ENV PORT=8081 \
    XDG_DATA_HOME=/tmp/caddy-data \
    XDG_CONFIG_HOME=/tmp/caddy-config

USER 10003:10003
EXPOSE 8081

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["sh", "-c", "wget -q -O /dev/null http://127.0.0.1:${PORT:-8081}/healthz"]

ENTRYPOINT ["caddy"]
CMD ["run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
