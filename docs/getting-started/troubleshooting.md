# Troubleshooting

Each entry gives the symptom as you will see it, the cause, and the fix. The
error texts were reproduced on Node 24.

## The API will not start

### `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`

```text
SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript parameter property is not supported in strip-only mode
SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript enum is not supported in strip-only mode
```

The backend runs TypeScript by erasing types, not compiling them
([ADR 0002](../architecture/adr/0002-strip-only-typescript.md)). Syntax that
needs code generation is rejected when the module loads:

| Rejected | Write instead |
|---|---|
| `enum Status { A, B }` | `const statuses = ['a', 'b'] as const; type Status = (typeof statuses)[number];` |
| `constructor(readonly code: string) {}` | declare `readonly code: string;` and assign `this.code = code` in the body (see `HttpError` in `Backend/types.ts`) |
| `namespace X { export const y = 1 }` | a module |
| decorators, `import x = require('y')`, `export =` | ES module syntax |

`npm run typecheck` does **not** catch these; only running the code does. Run
`npm run smoke` before you push.

### `does not provide an export named 'Foo'`

```text
SyntaxError: The requested module './t.ts' does not provide an export named 'Foo'
```

`Foo` is a type (interface or type alias) imported with a plain `import`.
After stripping there is no runtime binding to import. Write
`import type { Foo } from './t.ts'`, or `import { type Foo, bar } from …`.
`verbatimModuleSyntax` in `Backend/tsconfig.json` makes `npm run typecheck`
report this too.

### `ERR_MODULE_NOT_FOUND` for a path without an extension

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/store/db' imported from …/routes/x.routes.ts
```

Node's ESM loader does not guess extensions. Import `'../store/db.ts'`.

### `Missing required environment variable …`

In production (`NODE_ENV=production`) the API refuses to start without
`SESSION_SECRET`, `APP_ORIGIN`, `WEBAUTHN_RP_ID` and `DATA_ENCRYPTION_KEY`, with
a `SESSION_SECRET` shorter than 64 characters, or with demo settings:

```text
Error: Missing required environment variable WEBAUTHN_RP_ID
Error: SESSION_SECRET must be at least 32 bytes encoded as hex (64 chars) in production
Error: Demo settings are not allowed in production: DEMO_PASSWORD
```

Set or unset them (see [Configuration](../operations/configuration.md#production-fails-closed)).
With Docker, `make secrets` generates the secret files; the container entrypoint
also stops if both `NAME` and `NAME_FILE` are set or a secret file is
unreadable. Outside production the required values have development defaults.

### `EADDRINUSE`

```text
Error: listen EADDRINUSE: address already in use :::8080
```

Something already listens on the port. Find it with
`lsof -iTCP:8080 -sTCP:LISTEN` and stop it, or start the API elsewhere with
`PORT=8090 npm run dev`. If you move the API, point the web app's proxy at it:
`DEVHQ_API_URL=http://127.0.0.1:8090 npm run dev` in `Frontend/`.

The Vite dev server uses `strictPort`, so if 5173 is taken it exits instead of
picking another port. `npx vite --port 5174` overrides it, but then add the new
origin to the API's allow-list (next section).

### Node is too old

`node: bad option: --experimental-strip-types` means Node is older than 22.6.
Install Node 22.6 or newer (`node --version`).

## Signing in fails

### `403 bad_origin` on sign-in or any write

```json
{"error":{"code":"bad_origin","message":"Cross-origin request blocked","requestId":"…"}}
```

The browser's `Origin` is not in the API's allow-list. Outside production the
list is `APP_ORIGIN` (default `http://localhost:5173`), `PUBLIC_URL`,
`http://localhost:<PORT>`, `http://127.0.0.1:<PORT>` and anything in
`CORS_ORIGINS`. The match is exact: scheme, host and port.

The usual cause is opening `http://127.0.0.1:5173` (the address Vite prints)
instead of `http://localhost:5173`. Either open `localhost`, or start the API
with `CORS_ORIGINS=http://127.0.0.1:5173`. `GET /api/_config` (signed in)
shows the effective `allowedOrigins`.

### Signed in, but every call is `401`

The session cookie is `__Host-devhq_session` with `Secure`, `HttpOnly`,
`SameSite=Strict`, `Path=/` and no `Domain`. Browsers store a `Secure` cookie
only from a secure context: `https://…`, or a loopback origin such as
`http://localhost` / `http://127.0.0.1` (Chromium and Firefox treat those as
secure). Behind any other plain-`http` hostname — a LAN IP, a container name,
`http://devhq.local` — the cookie is silently dropped.

- Local development: use `localhost` through the Vite proxy.
- Anywhere else: serve over HTTPS (the edge terminates TLS).
- Calling the API from a different origin than the page (`VITE_API_BASE`
  pointing elsewhere) also loses the cookie, because it is `SameSite=Strict`
  and host-only. Keep the app and the API on one origin.

The web app relies on the cookie alone
([ADR 0006](../architecture/adr/0006-cookie-only-browser-sessions.md)), so a
dropped cookie shows up immediately as a sign-out.

### `401 mfa_required`

The password step succeeded but the second factor has not. The session is
partial and can only reach the MFA and enrolment routes and sign-out. Submit
the code, or enrol a first authenticator if the sign-in response said
`enrollRequired: true`.

### `401 mfa_invalid` with the demo code

`246810` works only in demo mode and only for the seeded demo accounts that
have no factor of their own. Invited members, and every account in production,
must use their own authenticator or passkey. A member with no factor yet must
enrol one ([Authentication](../api/authentication.md#first-factor-enrolment)).

### Nobody can sign in to a new production deployment

Production never creates demo accounts. `GET /api/ready` shows
`"bootstrapRequired": true`. Create the first Owner with `bootstrap-owner`
([Deployment and first run](../operations/deployment.md#first-run-production-setup)).
If the command says an Owner exists but you cannot see one, the backend was
running while you ran it: restart the backend so it reloads the collections.

### `401 session_context_changed`

The session was used with a different `User-Agent` from the one it was
created with, so the API revoked it. This happens when a token is copied
between tools (for example from a browser to curl). Sign in again from the
client that will use the session.

### `401 step_up_required` (with header `X-Step-Up-Required: 1`)

A sensitive action needs a strong verification in the last 5 minutes, and
either too much time has passed, the session went idle (15 min), or the client
IP changed. Re-verify with `POST /api/auth/step-up` (the web app opens its
re-verification dialog automatically). See [Step-up](../concepts/step-up.md).

### `423 locked`

Five wrong passwords in a row lock the account for 15 minutes. The response
says how long: `details.retryAfterSec`. Restarting a development server also
clears it.

### `429 rate_limited`

You hit a token bucket. Development buckets are generous (600 burst for the
API, 60 for auth routes); production is much tighter (10 burst for auth,
refilling one every 10 s). Wait for `Retry-After` seconds. See
[Rate limits](../api/rate-limits.md).

### `403 risk_blocked`

The location risk engine scored the sign-in at 70 or more (Tor, impossible
travel, …). Locally this only happens if you send `X-Forwarded-For` with
`TRUST_PROXY=1`. See [Location risk](../concepts/location-risk.md).

## The web app

### "Couldn't reach the DevHQ API. Is the backend running on :8080?"

The proxy could not connect. Start the API, or point the proxy at it with
`DEVHQ_API_URL`. Check with `curl -s http://127.0.0.1:5173/api/health`.

### A page shows "demo" or "sample data"

The GitHub-backed pages (repositories, pull requests, CI, code security) show
labelled demo data outside production when no GitHub credentials are set; see
[Webhooks](../api/webhooks.md#inbound-github-app). The assistant and model
insights say `integration_unconfigured` / `source: "heuristic"` without the
models service.

### Everything I created is gone

Without `DATABASE_URL` the API keeps data in memory and reseeds it on restart.
Use the Docker stack (or set `DATABASE_URL`) to persist
([Storage](../operations/storage.md)).

## Docker

- **Ports 80/443 busy:** `EDGE_HTTP_PORT=8880 EDGE_HTTPS_PORT=8443 make up`.
- **Browser warns about the certificate on <https://localhost>:** the edge uses
  Caddy's local CA. Copy it out and trust it:
  `docker compose cp edge:/data/caddy/pki/authorities/local/root.crt ./devhq-local-ca.crt`.
- **A service is unhealthy:** `docker compose ps -a`, then
  `make logs SERVICE=backend` (or `migrate`, `minio-init`, `models`).
- **Changed a secret file and nothing happened:** secrets are read at
  container start; `docker compose up -d --force-recreate <service>`.
- More in the [runbook](../deploy/RUNBOOK.md#useful-commands).

### Proxy or network surprises

- The proxy target uses `127.0.0.1`, not `localhost`, so it does not depend on
  how the OS resolves `localhost` (IPv6 first on some systems).
- If your shell sets `http_proxy` / `HTTP_PROXY` (corporate networks), curl
  sends requests for the API to that proxy too. Add `localhost,127.0.0.1` to
  `NO_PROXY` / `no_proxy`.
- The API trusts `X-Forwarded-For` only with `TRUST_PROXY=1`. Set it only when
  a proxy you control sits in front and overwrites that header; otherwise
  clients can choose their own IP for rate limiting and risk scoring.
