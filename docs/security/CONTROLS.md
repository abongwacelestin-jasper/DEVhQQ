# Security controls: control → code → test

Paths are relative to `Backend/`. Line numbers were current at the SEC Wave 4
commit. "smoke:N" means the check whose `expect(...)` call is on line N of
`scripts/smoke.ts`; run them with `npm run smoke`. Threats are listed in
[THREAT_MODEL.md](./THREAT_MODEL.md).

| Id | Control | Code | Test |
|---|---|---|---|
| C-01 | **Cookie-only browser sessions.** A token goes in the body only for `X-DevHQ-Client: cli` requests with no `Origin` and no `Sec-Fetch-Site` | `routes/auth.routes.ts:153` (`wantsBodyToken`), `:162` (`deliver`); cookie flags `middleware/authenticate.ts:37` | smoke:285 (no body token for console- or cli-labelled browser requests; HttpOnly + SameSite=Strict); smoke:299 (cookie authenticates); smoke:382 (CLI receives a token) |
| C-02 | Session token HMAC-signed, rotated on every privilege change | `security/crypto.ts:107` (`signToken`), `auth/sessions.ts:106` (`rotateSession`) | existing smoke "API refused before MFA"; step-up rotation exercised by smoke:636 |
| C-03 | Context-bound sessions: UA change revokes, IP change or idle forces step-up | `auth/sessions.ts:117`, `:128`, `:132` | covered by the S1 gate (`gate.mjs`) |
| C-04 | **Encryption at rest.** AES-256-GCM `seal`/`open`, key id prefix, AAD context, rotation via `DATA_ENCRYPTION_KEYS_PREVIOUS`, `reseal`; production fails closed without `DATA_ENCRYPTION_KEY` | `security/crypto.ts:183` (`seal`), `:203` (`open`), `:227` (`needsReseal`), `:235` (`reseal`); key loading `config/env.ts:87` | smoke:588 (sealed, never plaintext in snapshot); smoke:606 (wrong context and tampering fail); smoke:666 (prod refuses missing key) |
| C-05 | **TOTP.** Enroll (step-up) → confirm with one code → sealed secret; per-member replay protection across sessions; legacy plaintext migrated on boot and on use | `auth/totp.ts:133` (`beginEnrollment`), `:153` (`confirmEnrollment`), `:108` (`verifyMemberTotp`), `:80` (`migrateTotpSecret`); routes `routes/auth.routes.ts:588`, `:621`; boot migration `:278` | smoke:560, smoke:581, smoke:622 (replay), smoke:636 |
| C-06 | **Demo hardening.** The demo code works only for members with no TOTP and no passkey; production refuses to boot with any `DEMO_*` except `DEMO_DISABLED` | `routes/auth.routes.ts:174` (`demoCodeAllowed`), `:209` (`checkTotp`); `config/env.ts:119` | smoke:622 (step-up and sign-in reject the demo code once TOTP is enrolled); smoke:666 |
| C-07 | **WebAuthn registration.** Single-use, 2-minute challenge bound to member and session; type/challenge/origin/crossOrigin; rpIdHash; UP/UV/AT; credential id equals authData; SPKI equals the COSE key; algorithm allow-list; key type fits algorithm; globally unique credential id; step-up required | `auth/webauthn.ts:93`, `:169`, `:185`, `:209`, `:312`, `:347`, `:360`, `:384`; routes `routes/auth.routes.ts:796`–`:831` | smoke:719 (register, then challenge reuse refused) |
| C-08 | **WebAuthn assertion** for sign-in, MFA, step-up and unlock. Signature over `authData‖SHA-256(clientDataJSON)` (ES256 DER / EdDSA / RS256) verified **before** the counter; a regressed counter suspends the key; userHandle check | `auth/webauthn.ts:137`, `:444`, `:473`, `:482`; route `routes/auth.routes.ts:700` | smoke:766 (step-up, sign-in, wrong origin, no UV, bad signature); smoke:779 (clone suspends) |
| C-09 | **PAT storage.** `dhq_pat_<16hex>_<43 b64url>`, SHA-256 only, shown once, expiry required (≤ 90 d), `lastUsedAt`, at most 20 active per member | `security/pats.ts:54`, `:130` (`issueToken`), `:190` (`verifyPat`); routes `routes/tokens.routes.ts` | smoke:405, smoke:424, smoke:472, smoke:481 |
| C-10 | **PAT authority.** Scopes intersected with the live role (`effectiveLevel`); scopes above the role refused; token management and credential routes are session-only; revoked on deactivation (lazily on use plus a 30 s sweep) | `auth/rbac.ts:126`, `:154` (`requireSession`); `security/pats.ts:91`, `:178`, `:216`; `middleware/authenticate.ts:49`; `member.deactivated` bus event → `revokeStandingAccess` (PATs **and** JIT grants, audited) `security/pats.ts:231`, `:255` | smoke:449 (scope enforced); smoke:462; smoke:502 (deactivation); smoke:533 (offboarding event) |
| C-11 | **Step-up.** Strong verification within 5 min; PATs can never pass (403 `step_up_unavailable`) | `auth/rbac.ts:179` (`requireStepUp`) | smoke:462 |
| C-12 | **Headers.** API: `default-src 'none'` CSP, `no-store`, COOP/CORP/COEP, Permissions-Policy, nosniff, XFO DENY, Origin-Agent-Cluster; HSTS in prod. Console: nonce CSP + `script-src-attr 'none'`. SPA policy for the edge: `buildCsp` | `security/headers.ts:126` (`securityHeaders`), `:89`, `:92`, `:69`, `:48`, HSTS `:129` | smoke:313, smoke:326, plus the existing "console scripts are protected by a per-response nonce" check |
| C-13 | **Origin guard.** Every non-GET/HEAD/OPTIONS from a non-allow-listed Origin (including `null`) is blocked; `Sec-Fetch-Site: cross-site/same-site` blocked even without Origin; cross-site no-cors loads of the API blocked; preflight from unknown origins refused | `security/headers.ts:159`, `:185`, `:190`, `:194`; JSON-only bodies `lib/http.ts:230` | smoke:364, smoke:376 |
| C-14 | Credential-stuffing resistance: equal timing for unknown users, lock after 5 failures, risk gate | `routes/auth.routes.ts:431`, `:445`, `:248` | existing smoke "same error for wrong password and unknown user" |
| C-15 | **Rate limiting.** Per IP (`apiLimiter`); auth routes per IP **and** per account email (`authLimiter`); per member on second-factor checks (`accountLimiter`, `chargeAccount` for passkeys) | `security/rateLimit.ts:173`, `:179`, `:189`, `:194`; limits `config/env.ts:192` | Exercised on every smoke auth call; values shown at `GET /api/security/posture` |
| C-16 | **Shared rate-limit store across replicas.** Memory store without `REDIS_URL`; with it, `RedisRateLimitStore` runs the same token-bucket math as one atomic Lua script (Redis `TIME`, per-key expiry). Redis down: `api` fails open to a local bucket, `auth`/`acct` fail closed (`503 rate_limit_unavailable`, `Retry-After`) | `security/rateLimit.ts` (`RateLimitStore`, `MemoryRateLimitStore`, `setRateLimitStore`), `security/rateLimitRedis.ts` (`TOKEN_BUCKET_LUA`, `RedisRateLimitStore`), installed by `lib/redisBoot.ts` | `test/redis/rate-limit.test.ts`, `test/redis/two-instances.test.ts`, `test/unit/redis.test.ts`; `security-tests/checks/ratelimit-two-instances.ts` |
| C-17 | Client IP from XFF only behind a trusted proxy | `lib/http.ts` (`clientIp`) | S1 gate runs with `TRUST_PROXY=1` |
| C-18 | Every state change audited; hash-chained, verifiable | `audit/auditLog.ts:204` (`append`), `audit/chain.ts:61` (`digest`); SEC audit actions: `auth.totp_enroll_started/enrolled/replaced/enroll_failed`, `auth.step_up(_failed)`, `auth.passkey_ok/failed/registered/removed/suspended`, `token.created/revoked`, `security.totp_secrets_sealed` | the existing "audit chain intact" check, which runs after the SEC block (smoke:1727) |
| C-19 | Resource exhaustion limits: body cap, header and request timeouts, capped WebAuthn challenge map | `lib/http.ts:224`, `server.ts:84`, `auth/webauthn.ts:67` | — |
| C-20 | Single password policy (accept-invite, recovery reset) | `security/passwordPolicy.ts` | collab smoke "reset applies the password policy" |
| C-21 | **Per-subscriber event filtering (CYBER-001).** `/api/_events` delivers security events (audit, signin, team, member/auth/security/token/jit.*) only to Administration:view; product events only when `canSeeProduct` (product from envelope, payload or the referenced record); unknown types denied; stream ends when the member is inactive | `security/eventPolicy.ts:74`, `routes/system.routes.ts:377`, envelope `lib/events.ts` (`publish(type, data, {product})`) | smoke:826 |
| C-22 | **Validator own-property allow-list (CYBER-004).** `__proto__`/`constructor`/`prototype` refused; inherited names (`toString`) are unknown fields → 422 | `lib/validate.ts:83`, `:86` | smoke:856 |
| C-23 | **Audit and console reads need Administration:view (QA-028).** `GET /api/audit`, `/api/audit/verify`, `/api/_logs`, `/api/_metrics`, `/api/_config`, `/api/security/posture`, `/api/security/rate-limits` and `GET /api/backups` return 403 to roles without Administration ≥ view; the query runner's `audit` collection returns zero rows for them | `routes/security.routes.ts:20`, `routes/system.routes.ts:145` | smoke:1729 |
| C-24 | **One audit chain across restarts.** Each boot verifies the durable store end to end (`audit_entries` with `DATABASE_URL`, else `AUDIT_LOG_FILE`) and continues it: `seq` carries on and `prevHash` is the last stored hash, behind a boot marker. If the store is unreadable or broken, the boot still goes ahead, but its first entry is a sensitive `audit.chain_discontinuity`: there is never a silent fresh genesis. `GET /api/audit/verify` (Administration:view) re-reads the store across every boot and detects edited, missing, reordered and duplicated entries and a cut tail. `scripts/verify-audit.ts` does the same offline and reports the first break. File, table and archive writes, and bus events, follow chain order even for re-entrant appends | `audit/auditLog.ts:120` (`resume`), `:289` (`verifyAll`); `audit/chain.ts:196` (`ChainVerifier`); `db/auditSink.ts:165` (`pgAuditSource`); `db/boot.ts:52`, `:72`; `scripts/verify-audit.ts` | `test/unit/auditContinuity.test.ts` (file and fake-pg restarts, every tamper type across a boundary, unreadable stores, v2.0.0 data, the script); `test/integration/audit-continuity.test.ts` (boot on a tampered store); `smoke:pg` "audit chain resumed … after the restart" |
| C-25 | **JIT production access enforced.** Approving a production deploy, rolling back a production deploy that was approved or ran, changing an incident's severity and resolving a SEV1 need an `active`, unexpired grant for `production:<product>` (`403 elevation_required`, `details.scope`); checked after role, `404` scope and two-person checks. Owner passes via `hasOwnerPowers`; PATs never carry an elevation and never pass (`403 elevation_unavailable`, even with `organization:admin`). Elevations are rebuilt per request with `expiresAt > now`, so expiry and revocation apply on the next request. Each use audited `jit.used` (sensitive, grant id, request id); approvers notified of requests | `auth/rbac.ts:216` (`assertElevation`), `:248` (`requireElevation`); `auth/jit.ts:115` (`isLive`), `:120` (`activeElevations`), `:145` (`expireDueGrants`); `middleware/authenticate.ts:65` (PAT `elevations: []`); `routes/operations.routes.ts:136`, `:180`, `:325`; `GET /api/access/grants/mine` `routes/team.routes.ts` | smoke:1277; `test/integration/jit-enforcement.test.ts`; `test/unit/rbac.test.ts` (JIT elevation); `security-tests/checks/jit-production-access.ts` |
| C-26 | **Turnstile bot protection (optional, `TURNSTILE_MODE=on`).** Password sign-in, demo sign-in (non-production), the password reset request and accept-invite need a Cloudflare Turnstile token (`turnstileToken` in the body), checked after the route's rate limiter so bots still spend rate-limit tokens. siteverify gets the secret, token, client IP and an idempotency key (5 s budget, one retry); `success`, `hostname` = `APP_ORIGIN`'s host and `action` (`sign-in` / `recover` / `accept-invite`) must match; a token seen in the last 5 min is refused locally (Cloudflare also enforces single use). Stable errors `400 turnstile_required`, `403 turnstile_failed` (audited `security.turnstile_failed`), `503 turnstile_unavailable` (fail closed); `TURNSTILE_FAIL_OPEN=1` passes unverifiable requests during an incident, each audited `security.turnstile_fail_open`. Production refuses to boot with mode on and a key missing, or with a test key. Exempt: MFA, step-up and enrollment (already hold a session), passkey sign-in (needs an origin-bound private key), reset and invite preview (need a 256-bit link token), and explicit CLI clients (`X-DevHQ-Client: cli` with no `Origin` and no `Sec-Fetch-Site`, the C-01 rule). Browsers always send those headers and page script cannot remove them, so a browser cannot use the CLI exemption; a raw-HTTP bot can, so that path relies on C-14/C-15 alone. `the exemption is off by default (W5-03); `TURNSTILE_EXEMPT_CLI=1` turns it on and production also requires `TURNSTILE_EXEMPT_CLI_ACK=bots-can-claim-cli` (CLI automation uses PATs) | `security/turnstile.ts` (`createTurnstileVerifier`, `turnstileGuard`, `isCliClient`); `config/turnstile.ts` (`loadTurnstileConfig`); guards in `routes/auth.routes.ts` and `routes/recovery.routes.ts`; public `GET /api/auth/config`; widget `Frontend/src/components/auth/TurnstileWidget.tsx` | `test/unit/turnstile.test.ts`; `test/integration/turnstile.test.ts` (mode on), `test/integration/turnstile-off.test.ts`; smoke "auth config publishes Turnstile mode"; `security-tests/checks/turnstile-bot-check.ts`; `e2e/tests/turnstile.spec.ts` (`E2E_TURNSTILE=1` uses Cloudflare test keys) |

## Rate limiting

```ts
export interface RateLimitStore {
  readonly name: string;
  take(key: string, opts: LimitOptions): TakeResult | Promise<TakeResult>; // must be atomic per key
  snapshot(limit: number): BucketView[];
}
setRateLimitStore(new RedisRateLimitStore(...)); // lib/redisBoot.ts, at boot, before listen
```

- Without `REDIS_URL` the store is `MemoryRateLimitStore` (per process). With
  it, `lib/redisBoot.ts` installs `RedisRateLimitStore`
  (`security/rateLimitRedis.ts`): `refillAndTake()` ported to one Lua script
  run with `EVALSHA` (falls back to `EVAL` after a script flush) on a hash
  `<prefix>rl:<key>`. Read, refill, decrement and write happen in one atomic
  step, so concurrent requests on different replicas never read the same
  bucket state. Time comes from Redis `TIME`, so clock skew between replicas
  cannot mint tokens. Each key expires once it would have refilled completely,
  plus 60 s; at that point it equals a new bucket, so expiry never changes a
  decision.
- Bucket keys look like `auth:ip:<ip>`, `auth:acct:<sha256(email)[0..16]>`,
  `acct:member:<id>` and `api:sess:<session|pat:id>`. Emails are never stored
  in plain text.

| Limiter | Dev | Production |
|---|---|---|
| `api` (per IP and per session) | 600 burst, 20/s | 120 burst, 2/s |
| `auth` (per IP and per account email) | 60 burst, 1/s | 10 burst, 1 per 10 s |
| `acct` (per member, second factor) | 30 burst, 1/s | 5 burst, 1 per 30 s |

With more than one backend replica, per-process memory buckets multiply the
effective limit by the number of replicas. That is why production with
`EXPECT_REPLICAS` above 1 refuses to boot without `REDIS_URL`.

### When Redis is down

A take counts as failed when the connection is down (the offline queue is
off, so this is immediate) or Redis is slower than `REDIS_COMMAND_TIMEOUT_MS`
(500 ms).

| Limiter | Behaviour | Why |
|---|---|---|
| `api` | **Fails open to a local bucket** with the same numbers, per replica | It damps abuse and scraping; it is not an authentication control. Failing closed would make Redis a single point of failure for the whole API. The local bucket still limits each client, at worst N× the budget across N replicas, for the length of the outage. That is the pre-Redis behaviour. |
| `auth`, `acct` | **Fails closed**: `503 rate_limit_unavailable`, `Retry-After: 5` | These budgets bound password spraying and 6-digit TOTP guessing. An outage must not multiply them by the replica count, and an attacker who can slow Redis down must not gain extra guesses. Only sign-in, recovery and second-factor routes are refused; signed-in sessions keep working. |

The first failure logs `ratelimit.redis_unavailable` (error) and recovery logs
`ratelimit.redis_recovered`. The client reconnects on its own with capped,
jittered backoff (50 ms up to 5 s). `GET /api/ready` reports `redis`; with
`EXPECT_REPLICAS` above 1, a Redis outage also makes readiness fail.

## Key management

| Variable | Format | Notes |
|---|---|---|
| `DATA_ENCRYPTION_KEY` | 64 hex chars (32 bytes) | **Required in production.** Development derives one from `SESSION_SECRET` via HKDF, and `publicConfig` reports it as `dev fallback` |
| `DATA_ENCRYPTION_KEYS_PREVIOUS` | comma-separated 64-hex keys | Decrypt only. To rotate: move the current key here, set a new current key, and restart. Values reseal on next use (TOTP: on sign-in or step-up, and for every member on boot) |
| `WEBAUTHN_ALGORITHMS` | e.g. `-7,-257` (subset of -7, -8, -257) | The default is ES256 and RS256. Removing an algorithm immediately disables existing keys that use it |
| `WEBAUTHN_RP_ID` | registrable domain | Required in production. The allowed WebAuthn origins are `APP_ORIGIN` and `PUBLIC_URL` when their host is the RP ID or a subdomain of it |

Other lanes encrypt their secrets the same way. B-DOMAIN's GitHub tokens are
an example:

```ts
import { seal, open, needsReseal, reseal } from '../security/crypto.ts';
row.token = seal(rawToken, `github-installation:${row.id}:token`);
const raw = open(row.token, `github-installation:${row.id}:token`); // throws DecryptionError on tamper or unknown key
```

## Known gaps / follow-ups

- Some routes outside SEC ownership check `p.role === 'Owner'` directly
  (`routes/system.routes.ts:79,106,125`, `routes/docs.routes.ts:37`). They
  only widen *product visibility*, never write authority, but they ignore PAT
  scope. Switch them to `hasOwnerPowers(p)`.
- `GET /api/me/capabilities` (`routes/team.routes.ts:129`) reports the role
  matrix. For a PAT principal it should report `effectiveLevel`.
- `PATCH /api/team/:id` (status → deactivated) does not publish
  `member.deactivated`; it calls `revokeStandingAccess` directly, which
  revokes the member's PATs and JIT grants at once (CYBER-010).
- Trusted Types (`require-trusted-types-for 'script'`) is not enforced yet.
- Turnstile's replay set (C-26) is per process. With several backend
  replicas it only catches replays on the same replica; Cloudflare's own
  single-use check still applies everywhere. Move it to the shared store
  when the rate limiter gets one.
- C-24 proves the chain, not its newest end. Entries removed from the tail of
  the store while no process runs are only caught against an independent
  copy, such as the archive's latest `headHash` (`verify-audit.ts --head`).
  Automating that comparison at boot is a follow-up.
- The console has no "restore session from cookie on reload". After a
  reload, the operator signs in again even though the cookie is still valid.
