# Backend tests

Dependency-free: `node:test` + `node:assert`, run by Node's strip-only
TypeScript (`--experimental-strip-types`). No test framework, no new packages.

```bash
cd Backend
npm run test:unit       # unit + integration suites (node --test)
npm run smoke           # the 32+ HTTP smoke checks (scripts/smoke.ts)
npm test                # test:unit, then smoke
npm run test:redis      # Redis suites (test/redis/): real Redis 7 in a throwaway Docker container, or REDIS_TEST_URL
npm run test:coverage   # suites under coverage + per-area thresholds, writes coverage/lcov.info
```

Run one file: `node --experimental-strip-types --test test/unit/totp.test.ts`
(every test file imports `test/setup.ts` first, so it works standalone). Filter
by name: add `--test-name-pattern="step-up"`.

## Layout

| Path                    | What                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup.ts`              | Process env for tests: `NODE_ENV=test`, temp `AUDIT_LOG_FILE`/`BACKUP_DIR`, `LOG_LEVEL=error`, `TRUST_PROXY=1`, demo secrets cleared. Must load before any app module.                                                                                                                                                                                                                          |
| `helpers/server.ts`     | `startApp()` boots `buildApp()` on an ephemeral port; `startRouter(router)` does the same for a hand-built `Router`. `Client` sends JSON as a CLI client (`X-DevHQ-Client: cli`, no `Origin`, so sign-in responses carry a body token) with its own IP (`X-Forwarded-For`) and User-Agent. `errorCode(res)`. Browsers are cookie-only: adding an `Origin` header to a call means no body token. |
| `helpers/auth.ts`       | `DEMO_ACCOUNTS` (seeded roles), `signInAs(app, 'pm')`, `signInAll(app)`, `passwordOnly`, `fullSignIn`, `forceStepUp(client, newIp)`, `stepUp(client)`.                                                                                                                                                                                                                                          |
| `helpers/webauthn.ts`   | Software authenticator: real ES256 / RS256 / EdDSA keys, a minimal CBOR encoder and `coseKey()`, attested credential data for registration, `makeAssertion`, `makeRegistration`, with overrides for every field the verifier checks.                                                                                                                                                            |
| `helpers/random.ts`     | Seeded PRNG (`rng(seed)`) for property-style loops — failures always reproduce.                                                                                                                                                                                                                                                                                                                 |
| `unit/*.test.ts`        | One file per module: crypto, validate, query, http, rbac, totp, sessions, webauthn, geo, auditLog, rateLimit, collection, authenticate.                                                                                                                                                                                                                                                         |
| `integration/*.test.ts` | Real app over HTTP: auth, authz (generated role × route matrix), tasks, docs, operations, team, security, locations, system, totp-mfa.                                                                                                                                                                                                                                                          |
| `coverage.ts`           | Runs the suites with `--experimental-test-coverage`, parses lcov, prints per-area coverage and enforces `THRESHOLDS`.                                                                                                                                                                                                                                                                           |

## Isolation and determinism

- `node --test` runs **each file in its own process**: fresh in-memory store,
  sessions, rate-limit buckets and temp dir. Inside a file, tests share one app;
  write tests that create their own rows instead of relying on order.
- Each `Client` gets a distinct loopback IP, so rate limits and the session's IP
  binding behave like separate devices. Changing `client.ip` mid-session
  simulates a network change (step-up required); changing `userAgent` simulates
  token theft (session revoked).
- Time: use `t.mock.timers.enable({ apis: ['Date'], now })` and
  `t.mock.timers.tick(ms)` (auto-restored after the test). No sleeps, no network
  beyond 127.0.0.1.
- Rate limits: the auth limiter is a per-IP bucket shared by every auth route.
  Never reuse one IP for many sign-ins — `app.client()` already gives each
  client a fresh `X-Forwarded-For` (`TRUST_PROXY=1` in `setup.ts`), like
  smoke.ts.
- Demo accounts: the shared demo MFA code only works for seeded members
  (`DEMO_MEMBER_IDS`). A member created through an invite has no factor and must
  enroll (`/api/auth/mfa/enroll` → `/confirm`) — see
  `integration/auth-enroll.test.ts`.
- Password hashing is scrypt N=2^15 by design, so sign-ins cost ~0.1–1 s each;
  prefer `signInAs` (demo, one hash at boot) over `fullSignIn` unless the
  password path is the subject of the test.

## Writing tests

- Assert the **correct** behaviour. Never weaken an assertion to go green, never
  skip (`it.skip`, `{ skip }`) and never write a test that cannot fail.
- New route? Add it to the `RULES` table in `integration/authz.test.ts` (who
  passes the guard, what a harmless probe returns) — the anonymous / pre-MFA
  sweeps pick it up from `/api/_inventory` automatically.
- Out-of-scope resources must answer **404**, not 403 — add a row to the
  `hidden` table.

## Findings (bugs exposed by tests)

A test that fails because of an app bug stays in the suite, asserting the
correct behaviour, marked:

```ts
// FINDING B-n (path/to/file.ts:line): what is wrong and why it matters.
it('does the right thing', { todo: 'FINDING B-n: short summary' }, async () => { … });
```

`todo` tests run and report (⚠) but do not fail the run. When the fix lands, the
test passes — **remove the `todo` option** so it guards against regression. Open
findings: `grep -rn "FINDING B-" test/`.

## Coverage thresholds

Enforced per area in `coverage.ts` (lines / branches / functions), not as one
global number. Raise them as coverage improves; never lower one to go green.
