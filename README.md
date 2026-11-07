# DevHQ

Developer operations platform: a React SPA (`Frontend/`), a Node.js API with no
build step (`Backend/`), a Python ML service (`Models/`), PostgreSQL and
S3-compatible object storage, served from one origin behind a Caddy edge.

## Quick start (Docker, prod-like)

Requires Docker Engine 24+ with the Compose plugin, `make`, `openssl`.

```bash
make secrets      # infra/secrets/* + .env (idempotent, never committed)
make up           # build images, start the stack, wait until healthy
make smoke        # end-to-end checks through the edge
```

Open <https://localhost>. Locally Caddy issues the certificate from its own
CA; to trust it, copy it out and add it to your OS/browser trust store:

```bash
docker compose cp edge:/data/caddy/pki/authorities/local/root.crt ./devhq-local-ca.crt
```

Ports 80/443 busy? `EDGE_HTTP_PORT=8880 EDGE_HTTPS_PORT=8443 make up`.

`make help` lists everything: `up`, `up-dev`, `down`, `down-v`, `logs`,
`migrate`, `secrets`, `test`, `smoke`, `scan`, `sbom`, `backup`,
`restore-drill`, `lint-infra`.

## Development mode

```bash
make secrets && make up-dev
```

- Backend runs from your checkout with `node --watch`, `NODE_ENV=development`
  (demo sign-in, seed data), published on `127.0.0.1:8080` (`/console`).
- Frontend is the Vite dev server with HMR on <http://localhost:5173>, also
  behind the edge at <https://localhost>.
- Postgres `127.0.0.1:5432`, MinIO API `:9000` and console
  <http://localhost:9001> (root credentials in `infra/secrets/minio_root_*`).

Without Docker (in-memory store, no database):

```bash
npm ci                                  # lifecycle scripts stay disabled (.npmrc)
npm run dev --workspace=Backend         # http://localhost:8080
npm run dev --workspace=Frontend        # http://localhost:5173, proxies /api
```

## Checks

```bash
make test         # backend typecheck/lint/smoke + frontend typecheck/lint/build
make lint-infra   # hadolint, actionlint, shellcheck, compose config
make scan         # Trivy on images + repository
```

CI runs the same checks plus Postgres smoke, models (ruff/mypy/pytest),
CodeQL, gitleaks, dependency review and OpenSSF Scorecard. Images are signed
with cosign and carry SBOM + SLSA provenance attestations.

## Layout

| Path | What |
|---|---|
| `Backend/` | API server, `Dockerfile` |
| `Frontend/` | SPA, `Dockerfile` (Caddy runtime) |
| `Models/` | ML service |
| `infra/edge/` | Caddy edge image + `Caddyfile` |
| `infra/frontend/` | SPA server config (Caddy), security headers, pre-compression |
| `infra/railway/` | Railway config as code, setup scripts, Postgres roles |
| `infra/scripts/` | secrets, backup/restore, smoke, deploy |
| `docker-compose.yml`, `docker-compose.dev.yml` | stack definitions |
| `docs/deploy/` | [RUNBOOK](docs/deploy/RUNBOOK.md), [ARCHITECTURE](docs/deploy/ARCHITECTURE.md), [RAILWAY](docs/deploy/RAILWAY.md) |

Security policy: [SECURITY.md](SECURITY.md). Contributing:
[CONTRIBUTING.md](CONTRIBUTING.md).
