# Local development

Two ways to run DevHQ on your machine:

- **Docker (the whole platform).** `make secrets && make up-dev` starts the
  edge, the Vite dev server with hot reload, the backend from your checkout
  (`node --watch`, demo mode, seed data), PostgreSQL, MinIO and the models
  service. The backend is published on `127.0.0.1:8080`, the app on
  <http://localhost:5173> and behind the edge on <https://localhost>. See the
  root [README.md](../../README.md#development-mode) and the
  [runbook](../deploy/RUNBOOK.md). Requires Docker Engine 24+ with Compose,
  `make` and `openssl`.
- **Two processes, no Docker** (below). The API keeps everything in memory and
  reseeds demo data on every start; storage uses a local directory; insights
  fall back to heuristics and the assistant answers
  `503 integration_unconfigured`. This is the fastest loop for backend and
  frontend work, and what the examples in these docs were captured against.

## Prerequisites (two-process setup)

| Tool | Version | Why |
|---|---|---|
| Node.js | ≥ 22.6 | The API runs TypeScript with `--experimental-strip-types` ([ADR 0002](../architecture/adr/0002-strip-only-typescript.md)). |
| npm | ≥ 10 | Workspaces. |
| curl | any | Optional, for the API examples. |
| Python 3.12 + uv | optional | Only to run the models service outside Docker ([Models/README.md](../../Models/README.md#quick-start)). |

## 1. Install

```bash
git clone <repository-url> devhq && cd devhq
npm install                     # root workspaces: Backend, Frontend, Models
```

`.npmrc` sets `ignore-scripts=true`, so dependency install scripts never run
and git hooks are not installed automatically. Install them once with
`npm run hooks:install` if you want the `lint-staged` pre-commit hook.

The backend's only runtime dependency is the PostgreSQL driver, loaded only
when `DATABASE_URL` is set, so you can start the API in memory without
installing anything.

## 2. Start the API

```bash
cd Backend
npm run dev                     # node --experimental-strip-types server.ts
```

It listens on port 8080 and logs one JSON line per request:

```json
{"t":"2026-11-07T05:40:07.408Z","level":"info","msg":"listening","url":"http://localhost:8080","env":"development","routes":181,"console":"http://localhost:8080/console","demo":true}
```

Check it:

```console
$ curl -s http://localhost:8080/api/health
{"ok":true,"uptimeSec":4}
$ curl -s http://localhost:8080/api/ready
{"ready":true,"database":"up","persistence":{"mode":"memory","pending":0,"saturated":false},"members":12,"bootstrapRequired":false,"auditChain":"intact"}
```

Outside production the API needs no configuration: it uses a development
session secret and a data key derived from it, `APP_ORIGIN=http://localhost:5173`,
writes the audit log to `./.audit/audit.jsonl` and object storage (backups,
uploads, the audit archive) under `./.backups/object-store/` (both relative to
the directory you start it from, both git-ignored), and takes a first snapshot
two seconds after boot. Every variable is listed in the
[configuration reference](../operations/configuration.md).

## 3. Start the web app

In a second terminal:

```bash
cd Frontend
npm run dev                     # vite, on http://127.0.0.1:5173
```

Vite proxies every `/api/*` request to `http://127.0.0.1:8080`
(`Frontend/vite.config.ts`; override the target with `DEVHQ_API_URL`), so the
app and the API share one origin, exactly as they do behind the edge in
production. There is no CORS preflight and the session cookie behaves
normally.

**Open <http://localhost:5173>**, not the `127.0.0.1` address Vite prints. The
API only accepts state-changing requests from allow-listed origins, and the
default allow-list contains `http://localhost:5173`, not
`http://127.0.0.1:5173`. From `127.0.0.1` every sign-in fails with
`403 bad_origin`:

```console
$ curl -s -X POST http://localhost:8080/api/auth/demo -H 'content-type: application/json' \
    -H 'Origin: http://127.0.0.1:5173' -d '{"role":"developer"}'
{"error":{"code":"bad_origin","message":"Cross-origin request blocked","requestId":"234fa2e4-…"}}
```

If you have to use `127.0.0.1`, start the API with
`CORS_ORIGINS=http://127.0.0.1:5173 npm run dev`. Passkeys still need the
`localhost` hostname, because a WebAuthn relying-party ID cannot be an IP
address.

## 4. Sign in with a demo account

Outside production six demo accounts exist, one per role. They all use the
password `devhq-demo` and the MFA code `246810` (the code works only for these
seeded accounts; anyone you invite must enrol a real authenticator):

| Demo key | Role | Member | Email | Products |
|---|---|---|---|---|
| `admin` | Owner | Amara Okafor (`m1`) | amara@techorg.io | all three |
| `pm` | Project manager | Daniel Reyes (`m2`) | daniel@techorg.io | renewberry |
| `developer` | Developer | Kofi Mensah (`m4`) | kofi@techorg.io | renewberry |
| `designer` | Designer | Inès Moreau (`m9`) | ines@techorg.io | renewberry, mirror |
| `tester` | Tester | Ravi Patel (`m10`) | ravi@techorg.io | renewberry, mirror |
| `operations` | Operations | Grace Liu (`m11`) | grace@techorg.io | all three |

Five more seeded members (`m3`, `m5`–`m8`) sign in with the same password and
code; `m12` is seeded in the `invited` state and cannot sign in. The seed is in
`Backend/store/db.ts`. In the web app use the role buttons on the sign-in page, or
type an email and password and then the code. The API lists the accounts at
`GET /api/auth/demo-accounts`.

From the command line, a one-step demo sign-in with a cookie jar:

```console
$ curl -s -c jar -b jar -X POST http://localhost:8080/api/auth/demo \
    -H 'content-type: application/json' -d '{"role":"pm"}'
{"ok":true,"member":{"id":"m2","name":"Daniel Reyes","email":"daniel@techorg.io","role":"Project manager","products":["renewberry"],"status":"active","mfa":true,"passkeys":0}}
$ curl -s -b jar http://localhost:8080/api/products
[{"id":"renewberry","name":"RenewBerry","code":"RB","projects":3,"openTasks":6,"lateTasks":5,"members":8}]
```

curl sends the `Secure` cookie to `http://localhost`, like browsers do. The
full password + MFA flow and the bearer-token option are in the
[authentication guide](../api/authentication.md).

Demo mode is off when `NODE_ENV=production` or `DEMO_DISABLED=1`: the demo
routes answer `404` and seeded members have no usable password. **Turn it off
on any server reachable from the internet**
([Known limits](../operations/known-limits.md#disable-demo-mode-on-anything-internet-facing)).

## 5. The backend console

Open <http://localhost:8080/console> (also `/backend.html`; `/` redirects
there). It is a single page served by the API (`Backend/backend.html`) that
signs in against the same endpoints and shows, for the signed-in member:

- the route inventory with a request workbench for any endpoint;
- the JSON query runner over allow-listed collections (`POST /api/_query`);
- metrics, latency percentiles, recent logs and the live event stream;
- deployments and incidents, JIT access grants, sign-ins and location risk;
- the audit trail with an integrity check, backups and rate-limit state,
  security posture and the redacted runtime configuration.

Every action goes through the same authorisation and audit as the web app. Any
signed-in member can open the console today; see the note in
`Backend/routes/system.routes.ts`. The console signs in with the same cookie as
the web app and does not yet restore the session after a page reload. The web
app has its own developer console at `/console/*`
(`Frontend/src/pages/console/`), which can also run against an in-browser
preview server; it is a different program.

## 6. Run the checks

```bash
cd Backend  && npm run typecheck && npm run lint && npm run smoke
cd Frontend && npm run typecheck && npm run lint && npm run build
cd docs     && npm run check
```

`npm run smoke` boots the app in-process on a random port and runs the
end-to-end checks; on the merged Wave 4 branch it prints `157 checks passed`
and exits 0. With Docker, `make test` runs the package checks and `make smoke`
checks the running stack through the edge.

## Resetting state

Without a database, stop the API and start it again: all data, sessions and
grants are reseeded. The audit JSONL file and the local object store are kept;
delete `.audit/` and `.backups/` in `Backend/` to clear them. With Docker,
`make down-v` deletes every data volume.

Next: [Troubleshooting](troubleshooting.md) ·
[Architecture](../architecture/overview.md) ·
[User guide](../user-guide/index.md)
