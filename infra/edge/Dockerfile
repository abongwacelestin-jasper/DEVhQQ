# syntax=docker/dockerfile:1.10
#
# TavetaHQ edge: Caddy 2 running as a non-root user with no Linux capabilities.
#
# Build context: infra/edge
#   docker build -t devhq-edge infra/edge
#
# The official image grants /usr/bin/caddy the cap_net_bind_service file
# capability. With `cap_drop: [ALL]` + `no-new-privileges` that capability can
# never be granted and exec fails with EPERM, so it is stripped here; binding
# :80/:443 as non-root is instead allowed per container with the namespaced
# sysctl net.ipv4.ip_unprivileged_port_start=0 (see docker-compose.yml).
#
# Base image is pinned by digest. To bump it:
#   docker buildx imagetools inspect caddy:2.10-alpine | grep Digest
ARG CADDY_IMAGE=caddy:2.10-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d

FROM ${CADDY_IMAGE}

ARG VERSION=dev
ARG REVISION=unknown
ARG CREATED=unknown
LABEL org.opencontainers.image.title="devhq-edge" \
      org.opencontainers.image.description="TavetaHQ edge proxy (Caddy 2, automatic TLS, HTTP/3)" \
      org.opencontainers.image.source="https://github.com/devhq/devhq" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="TavetaHQ" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.created="${CREATED}"

# hadolint ignore=DL3018
RUN apk add --no-cache --virtual .setcap libcap \
 && setcap -r /usr/bin/caddy \
 && apk del .setcap \
 && addgroup -S -g 10002 edge \
 && adduser -S -D -H -u 10002 -G edge -s /sbin/nologin edge \
 && mkdir -p /data/caddy /config/caddy /etc/caddy/sites \
 && chown -R 10002:10002 /data /config

COPY Caddyfile /etc/caddy/Caddyfile

ENV XDG_DATA_HOME=/data \
    XDG_CONFIG_HOME=/config

USER 10002:10002
EXPOSE 80 443 443/udp

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8088/healthz"]

ENTRYPOINT ["caddy"]
CMD ["run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
