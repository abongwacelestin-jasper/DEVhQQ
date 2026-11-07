# DevHQ deployment architecture

Two supported deployments built from the same images:

- **Compose** (this page's first half): one host, everything behind a single
  edge. Source of truth: `docker-compose.yml` (prod-like) and
  `docker-compose.dev.yml` (dev override).
- **Railway + Cloudflare R2** ([Railway topology](#railway-topology) below;
  runbook: [RAILWAY.md](RAILWAY.md)).

## Services and networks

```mermaid
flowchart LR
  user([Browser / API client])
  gh([GitHub webhooks])
  ext([GitHub API · SMTP · Anthropic API])

  subgraph host[Docker host — ufw: 22, 80, 443 only]
    subgraph public_net[public_net]
      edge[edge · Caddy 2<br/>:80 :443 tcp+udp<br/>TLS · HSTS · HTTP/3]
    end
    subgraph edge_net[edge_net · internal]
      frontend[frontend · Caddy<br/>:8081 static SPA]
      backend[backend · Node 22<br/>:8080 API + /console]
    end
    subgraph app_net[app_net · internal]
      migrate[[migrate · one-shot]]
      minioinit[[minio-init · one-shot]]
      postgres[(postgres 17<br/>:5432)]
      minio[(MinIO<br/>:9000)]
      models[models · FastAPI<br/>:8000]
    end
    subgraph egress_net[egress_net · outbound only]
    end
  end

  user -- HTTPS --> edge
  gh -- HTTPS /api/github/webhook --> edge
  edge -- "/api/*, /console" --> backend
  edge -- "everything else" --> frontend
  backend --> postgres
  backend --> minio
  backend -- HMAC-signed --> models
  migrate --> postgres
  minioinit --> minio
  backend -. egress_net .-> ext
  models -. egress_net .-> ext
```

ASCII view of the same thing:

```
 Internet ──443/tcp+udp, 80──▶ [edge: Caddy]              public_net (published)
                                   │  TLS ends here; XFF overwritten
                 ┌─────────────────┴─────────────────┐    edge_net (internal)
                 ▼                                   ▼
       [frontend: caddy :8081]            [backend: node :8080] ──▶ egress_net ──▶ GitHub/SMTP
                                                     │
                 ┌───────────────┬───────────────────┼──────────────┐  app_net (internal)
                 ▼               ▼                   ▼              ▼
          [postgres :5432]  [minio :9000]     [models :8000] ──▶ egress_net ──▶ Anthropic
                 ▲               ▲
            [migrate]      [minio-init]        (one-shot, before backend)
```

| Network | `internal` | Members | Why |
|---|---|---|---|
| `public_net` | no | edge | the only network with published ports; ACME egress |
| `edge_net` | yes | edge, frontend, backend | edge reaches upstreams; upstreams cannot reach the internet through it |
| `app_net` | yes | backend, migrate, postgres, minio, minio-init, models | data plane; no route out, never published |
| `egress_net` | no | backend, models | outbound calls only; nothing listens on it |

The dev override sets `edge_net`/`app_net` to non-internal so ports can be
published on `127.0.0.1` for host tools.

## Trust boundaries

1. **Internet → edge.** Only TLS (and an HTTP→HTTPS redirect) is accepted.
   Caddy enforces header/body size limits and read timeouts, adds HSTS, strips
   `Server`, and **overwrites** `X-Forwarded-For` / `X-Real-IP` with the TCP
   peer address (drops `Forwarded`). No upstream proxy is trusted, so a
   client cannot spoof its IP.
2. **Edge → backend.** The backend runs with `TRUST_PROXY=1` and takes the
   first XFF entry, which is always the edge's value. It still enforces
   everything that must hold if the edge is bypassed: security headers, CSRF
   origin checks, rate limits, authn/z, validation, audit.
3. **Same origin.** The SPA and `/api` share one origin, so the `__Host-`
   `SameSite=Strict` session cookie works with no CORS.
4. **Backend → data plane.** Postgres, MinIO and models are reachable only on
   `app_net`. The backend connects to Postgres as `devhq_app` (DML only); the
   one-shot `migrate` service uses the schema owner `devhq`. MinIO access uses
   a bucket-scoped application user, never the root credentials. Calls to
   `models` are HMAC-signed with `ML_SERVICE_TOKEN`.
5. **Secrets.** Files in `infra/secrets/` (0700 dir, 0640 files), mounted per
   service at `/run/secrets/<name>`; each container receives only the secrets
   it needs. Never in images, compose env or git.

## Container hardening (every service)

`read_only: true` root filesystem with tmpfs for scratch paths, `cap_drop:
[ALL]`, `no-new-privileges`, non-root uid (backend 10001, edge 10002, frontend
10003, postgres 70, MinIO 65532), CPU/memory/pids limits, healthchecks with
`depends_on: service_healthy`, `restart: unless-stopped`, json-file log
rotation (5 × 10 MB). The edge binds :80/:443 without
`CAP_NET_BIND_SERVICE` through the namespaced sysctl
`net.ipv4.ip_unprivileged_port_start=0`.

## Startup order

`postgres` (healthy) → `migrate` (exit 0) ┐
`minio` (healthy) → `minio-init` (exit 0) ┼→ `backend` (healthy) ┐
`frontend` (healthy) ─────────────────────┴──────────────────────┴→ `edge`

`models` starts independently; the backend degrades to heuristics when it is
unavailable.

## Images and supply chain

| Image | Base (pinned by digest) | Notes |
|---|---|---|
| backend | `node:22-alpine` | `npm ci --omit=dev --ignore-scripts`; npm/corepack removed from runtime; tini; `*_FILE` entrypoint |
| frontend | `node:22-alpine` → `caddy:2.11-alpine` | pre-compressed (Brotli + gzip) assets, SPA fallback, CSP; optional same-origin `/api` proxy (Railway) |
| edge | `caddy:2.10-alpine` | file capability stripped, non-root |
| models | ML lane (`Models/Dockerfile`) | |
| postgres | `postgres:17-alpine` | |
| minio, minio-init | `cgr.dev/chainguard/minio{,-client}:latest-dev` | MinIO stopped publishing images to Docker Hub/Quay |

CI (`images.yml`) builds each image, gates on Trivy (HIGH/CRITICAL with a
fix), and on `develop`/`main`/`v*` pushes to GHCR by full-SHA tag, generates a
Syft SPDX SBOM, signs with cosign keyless, and attaches SBOM + SLSA build
provenance attestations. `deploy.yml` verifies the signatures before rolling
out.

## Headers: who sets what

| Header | SPA (frontend Caddy) | API (backend) | Edge |
|---|---|---|---|
| `Strict-Transport-Security` | `HSTS_VALUE` (the only source on Railway) | prod only | always (Compose) |
| `Content-Security-Policy` | `infra/frontend/Caddyfile` | `Backend/security/headers.ts` | — |
| nosniff, frame DENY, referrer, permissions, COOP, CORP | yes | yes | — |
| `Cache-Control` | `immutable` for `/assets/*`, `no-cache` for the shell | `no-store` | — |

The SPA's CSP adds what the bundle needs beyond the API policy: Google Fonts,
jsDelivr (Monaco loader), `worker-src blob:` (code runner) and, when
`S3_PUBLIC_ORIGIN` is set, the object-storage origin for presigned uploads.

## Railway topology

Runbook, variables and decisions: [RAILWAY.md](RAILWAY.md). Config as code:
`infra/railway/*.railway.json`.

```mermaid
flowchart LR
  user(["Browser"])
  gh(["GitHub webhooks"])
  ext(["GitHub API · Resend · Anthropic API"])

  subgraph cf["Cloudflare"]
    cfedge["DNS + proxy<br/>TLS Full strict"]
    r2[("R2<br/>uploads · backups · audit · models<br/>bucket locks on backups, audit")]
  end

  subgraph railway["Railway project · private network *.railway.internal"]
    redge["Railway edge · TLS"]
    frontend["frontend · Caddy<br/>SPA + /api proxy<br/>public: app domain"]
    backend["backend · Node API<br/>replicas = 1 · volume /var/lib/devhq<br/>pre-deploy: migrate"]
    cron[["cron · worker.ts --once backup,drill<br/>03:17 UTC daily"]]
    worker["worker · worker.ts<br/>phase 2, not deployed"]
    models["models · FastAPI<br/>private only"]
    pg[("Postgres<br/>devhq_migrator · devhq_app · devhq_jobs")]
    redis[("Redis<br/>provisioned, unused until the queue wave")]
  end

  user -- "HTTPS" --> cfedge --> redge --> frontend
  gh -- "HTTPS /api/github/webhook" --> cfedge
  frontend -- "/api/*, /console<br/>backend.railway.internal:8080" --> backend
  user -. "presigned PUT/GET" .-> r2
  backend -- "devhq_app" --> pg
  backend -- "S3 API" --> r2
  backend -- "HMAC-signed" --> models
  backend -.-> redis
  cron -- "devhq_jobs (read + audit insert)" --> pg
  cron -- "encrypted snapshots" --> r2
  worker -.-> pg
  worker -.-> redis
  models -- "own token, models bucket" --> r2
  backend -.-> ext
  models -.-> ext
```

| Boundary | Railway | Compose equivalent |
|---|---|---|
| Internet → app | Cloudflare (proxied) → Railway edge → `frontend`; only `frontend` has a public domain | `edge` on `public_net` |
| Client IP | `frontend` computes it from `X-Forwarded-For` (trusted: private, CGNAT, Cloudflare ranges) or `CF-Connecting-IP`, and overwrites `X-Forwarded-For` | `edge` overwrites `X-Forwarded-For` |
| App → data | private networking; Postgres roles `devhq_app` (API), `devhq_jobs` (cron), `devhq_migrator` (pre-deploy only) | `app_net`, roles `devhq_app` / `devhq` |
| Object storage | R2 tokens scoped to buckets; bucket locks (not Object Lock COMPLIANCE, see [WORM on R2](RAILWAY.md#worm-on-r2)) | MinIO users + Object Lock |
| Secrets | Railway (sealed) variables | files under `/run/secrets` |
| Periodic jobs | `backend` (monitors, digests), `cron` (backups, drill) | `backend` (all) |
