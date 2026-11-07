# syntax=docker/dockerfile:1.10
#
# DevHQ web app image: Vite build -> static files served by unprivileged nginx.
#
# Build context is the REPOSITORY ROOT (the npm workspace lockfile lives there):
#   docker build -f Frontend/Dockerfile -t devhq-frontend .
# Context filtering: Frontend/Dockerfile.dockerignore.
#
# Base images are pinned by digest. To bump one:
#   docker buildx imagetools inspect node:22-alpine | grep Digest
#   docker buildx imagetools inspect nginxinc/nginx-unprivileged:1.29-alpine | grep Digest
# and replace the digest (Dependabot's `docker` ecosystem opens the same PR).
ARG NODE_IMAGE=node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6

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
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --ignore-scripts --no-audit --no-fund \
      --workspace=Frontend --include-workspace-root=false \
 && mkdir -p Frontend/node_modules

# ---------------------------------------------------------------------------
# build: Vite production bundle, then pre-compress text assets for gzip_static.
# ---------------------------------------------------------------------------
FROM deps AS build
COPY Frontend/ Frontend/
RUN npm run build --workspace=Frontend \
 && find Frontend/dist -type f \
      \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.svg' \
         -o -name '*.json' -o -name '*.txt' -o -name '*.wasm' \) \
      -size +1k -exec gzip -9 -k -n {} +

# ---------------------------------------------------------------------------
# runtime: static files only. No Node, no shell entrypoint scripts.
# ---------------------------------------------------------------------------
FROM ${NGINX_IMAGE} AS runtime

ARG VERSION=dev
ARG REVISION=unknown
ARG CREATED=unknown
LABEL org.opencontainers.image.title="devhq-frontend" \
      org.opencontainers.image.description="DevHQ web app (static SPA on unprivileged nginx)" \
      org.opencontainers.image.source="https://github.com/devhq/devhq" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="DevHQ" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.created="${CREATED}"

COPY infra/nginx/nginx.conf /etc/nginx/nginx.conf
COPY infra/nginx/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/Frontend/dist/ /usr/share/nginx/html/

# The image's own uid (101). Files above are root-owned and read-only to it.
USER 101:101
EXPOSE 8081

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8081/healthz"]

# Skip /docker-entrypoint.sh: its scripts rewrite config files, which a
# read-only root filesystem (and this explicit config) make unnecessary.
STOPSIGNAL SIGQUIT
ENTRYPOINT ["nginx", "-g", "daemon off;"]
