# Local development

Run the API and the web app on your machine, sign in with a demo account, and
use the backend console. Everything here was run on Node 22/24 on macOS with
the outputs shown.

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | ≥ 22.6 | The API runs TypeScript with `--experimental-strip-types` ([ADR 0002](../architecture/adr/0002-strip-only-typescript.md)). |
| npm | ≥ 10 | Workspaces. |
| curl | any | Optional, for the API examples. |

No database, object store or Python is needed today: the API keeps its data in
memory and seeds demo data on every start.

> [!NOTE]
> **Planned: Wave 4 (INFRA).** A Docker Compose stack (`docker-compose.yml`,
> services `edge`, `frontend`, `backend`, `models`, `postgres`, `minio`) and a
> rewritten `.env.example` will become the recommended way to run the whole
> platform. Until INFRA lands, use the two-process setup below. The deploy
> guide will live in `docs/deploy/`.

## 1. Install

```bash
git clone <repository-url> devhq && cd devhq
npm install                     # root workspaces: Backend, Frontend, Models
```

`.npmrc` sets `ignore-scripts=true`, so dependency install scripts never run
and git hooks are not installed automatically. Install them once with
`npm run hooks:install` if you want the `lint-staged` pre-commit hook.

The backend has **no runtime dependencies**; `npm install` only brings dev tools
(TypeScript, ESLint, Prettier). You can start the API without installing
anything.

## 2. Start the API

```bash
cd Backend
npm run dev                     # node --experimental-strip-types server.ts
```

It listens on port 8080 and logs one JSON line per request:

```json
{"t":"2026-11-07T00:35:57.602Z","level":"info","msg":"listening","url":"http://localhost:8080","env":"development","routes":90,"console":"http://localhost:8080/console","demo":true}
```

Check it:

```console
$ curl -s http://localhost:8080/api/health
{"ok":true,"uptimeSec":4}
$ curl -s http://localhost:8080/api/ready
{"ready":true,"members":12,"auditChain":"intact"}
```

Outside production the API needs no configuration: it uses a development
session secret, `APP_ORIGIN=http://localhost:5173`, writes the audit log to
`./.audit/audit.jsonl` and backup snapshots to `./.backups/` (both relative to
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
app and the API share one origin, exactly as they will behind the edge in
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
password `devhq-demo` and the MFA code `246810`:

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
routes answer `404` and seeded members have no usable password.

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
`Backend/routes/system.routes.ts`. The web app has its own developer console at
`/console/*` (`Frontend/src/pages/console/`), which can also run against an
in-browser preview server; it is a different program.

## 6. Run the checks

```bash
cd Backend  && npm run typecheck && npm run lint && npm run smoke
cd Frontend && npm run typecheck && npm run lint && npm run build
cd docs     && npm run check
```

`npm run smoke` boots the app in-process on a random port and runs 32
end-to-end checks; it prints `32 checks passed` and exits 0.

## Resetting state

Stop the API and start it again: all data, sessions and grants are reseeded.
The audit JSONL file and snapshots on disk are kept; delete `.audit/` and
`.backups/` in `Backend/` to clear them (snapshots are read-only files, so use
`rm -rf`).

Next: [Troubleshooting](troubleshooting.md) ·
[Architecture](../architecture/overview.md) ·
[User guide](../user-guide/index.md)
