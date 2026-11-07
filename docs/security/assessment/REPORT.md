# DevHQ — Independent Security Assessment (Lane CYBER)

**Assessment type:** authorized, independent offensive assessment of the
repository owner's own project, tested only against local processes started by
the assessor on 127.0.0.1.
**Branch under test:** `wave4/integration` merged to this worktree (contains
`b56a27b wave4: assurance lanes addendum`).
**Date:** 2026-11-07 · **Phases:** 1 (pre-merge) and 2 (merged branch
`2d2e379` + live Compose stack). §0 is the current status; §1–§4 are the
phase-1 record, kept as written.
**Scope boundaries honoured:** no external hosts, no third-party services, no
DoS against shared resources, no real credentials (demo accounts only). No
control was weakened to make any exploit work. CYBER owns `security-tests/**`
and `docs/security/assessment/**` only and never edits application code.

---

## 0. Phase 2 update (merged branch + live Docker stack)

**Branch:** `wave4/integration` @ `2d2e379` (all 10 build lanes merged).
**Targets:** in-process backends on 127.0.0.1 (fresh process per check) and
the live Compose stack (`https://localhost:8443`), inspected read-only from the
host. The real Owner on the stack (`owner@techorg.io`) was not touched; no
destructive or DoS actions were run. Backup restore was exercised only as dry
runs and refusals.

**Result:** the suite has 28 checks and was run twice on fresh processes, with
the same result both times: **27 PASS · 1 FAIL · 0 SKIP**. The one FAIL is the
new **CYBER-008**. The Docker audit (`security-tests/docker/infra-audit.sh`):
**all controls PASS**.

### Status of phase-1 findings after the fixes landed

| ID | Phase 1 | Phase 2 | Evidence |
|---|---|---|---|
| CYBER-001 SSE leaks audit/sign-ins to all | High · confirmed | **Fixed** | `sse-cross-product-leak.ts` PASS. `eventPolicy.ts` gates security topics to Administration:view and product events to `canSeeProduct` |
| CYBER-002 shared demo MFA code | Medium · confirmed | **Fixed in scope; residual moved to CYBER-008** | `demo-mfa-stepup-bypass.ts` PASS. The code is refused once a real factor exists and for invited members, and demo is off under `NODE_ENV=production` |
| CYBER-003 bearer token in body | Medium · confirmed | **Fixed** | `bearer-token-in-body.ts` PASS. A body token is issued only to `X-DevHQ-Client: cli` with no Origin and no `Sec-Fetch-Site` |
| CYBER-004 prototype keys bypass unknown-field check | Low · confirmed | **Fixed** | own-property allow-list (C-22). The mass-assignment check no longer reports the note |
| CYBER-005 same-origin code-runner worker | Medium · theoretical | **Open (not re-tested in a browser)** | no browser PoC this pass. F-SEC to confirm sandbox origin |
| CYBER-006 vulnerable frontend deps | contextual | **Open: re-audit after dependency bumps** | not re-run this pass |
| CYBER-007 `trivy-action@master` | Low | **Open** | INFRA |

**Re-scoping CYBER-002, as the coordinator asked.** The shared demo code still
working for a *factor-less seeded* account in exact `NODE_ENV=development` is
intended, and I did not treat that alone as a finding. The check was tightened
rather than loosened. It now fails if the code ever works for (a) a seeded
account after it enrols a real factor, or (b) any invited, non-seeded member,
or if (c) demo is on under `NODE_ENV=production`. The real staging risk is how
"production" is detected, not the demo code itself. That is CYBER-008, which
has its own failing check.

### New phase-2 findings

| ID | Title | CVSS v3.1 | CWE | Affected | PoC | Status | Owner |
|---|---|---|---|---|---|---|---|
| **CYBER-008** | **Fail-open environment detection.** Only the exact string `production` counts as production (`NODE_ENV` is type-cast, never validated). `Production`, `prod` or `staging` boot with dev fallbacks: demo enabled, the seeded **Owner** (`amara@techorg.io`) reachable with the published password and code, the hard-coded dev `SESSION_SECRET` used, the encryption key derived from it, and the production secret and `DEMO_*` guards skipped | **8.1 High** `AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H` (needs a misconfigured `NODE_ENV`) | CWE-636, CWE-1188, CWE-798 | `Backend/config/env.ts:188-189` (`env as NodeEnv`, `isProd = env === 'production'`); `Backend/store/db.ts:61` (`DEMO.enabled`) | `security-tests/checks/env-failopen.ts` | **Confirmed** | SEC (env.ts) / INFRA |
| CYBER-009 | PAT scope doesn't limit Owner read visibility: `p.role === 'Owner'` checks in `/api/_query` collections (members, sign-ins, docs) and docs listing ignore PAT scope, so a narrowly scoped Owner PAT reads with full Owner visibility (reads only, never write authority) | 4.3 Medium `AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N` | CWE-863 | `Backend/routes/system.routes.ts:82,109,128`; `Backend/routes/docs.routes.ts:37` | confirmed by code; SEC lists it as a known gap | Confirmed (code) | SEC |
| CYBER-010 | Deactivating a member with `PATCH /api/team/:id` doesn't publish `member.deactivated`, so their JIT grants stay active until expiry (PATs are cut on use and by the 30 s sweep; offboarding does publish the event) | 3.8 Low `AV:N/AC:H/PR:L/UI:N/S:U/C:L/I:L/A:N` | CWE-613 | `Backend/routes/team.routes.ts` (PATCH handler) vs `routes/offboarding.routes.ts:119` | confirmed by code; SEC lists it as a known gap | Confirmed (code) | SEC |
| CYBER-011 | Model artifacts are still loaded with joblib, which runs pickled code. This is strongly mitigated: the HMAC-signed promotion pointer and metadata, an exact sha256 match, and schema and sklearn-version checks all run before `joblib.load`, so write access to the bucket alone can't run code. Remaining risk: anyone holding `MODEL_SIGNING_KEY` (or `ML_SERVICE_TOKEN`, from which it can be derived) can run code in `models` | 3.1 Low (defence in depth) | CWE-502 | `Models/devhq_models/registry/registry.py:191` | code review | Theoretical | ML |

**CYBER-008 fix:** check `NODE_ENV` against an allow-list
(`development|test|production`) and refuse to boot on anything else. Turn demo
on only with an explicit `DEMO_MODE=1`, and never when `PUBLIC_URL` is
non-local. Treat "not development" as production for the secret checks.
Staging deployments should run `NODE_ENV=production` with `DEMO_DISABLED=1`.
The Compose stack already hard-codes `NODE_ENV: production` and
`DEMO_DISABLED=1`, so it is **not** affected. The risk is any other deployment
path.

### Phase-2 attack surface tested and found secure

| Area | Attacks | Result |
|---|---|---|
| First-factor enrollment (`/api/auth/mfa/enroll` + `/confirm`) | enrolling on an account that already has a factor; confirming another session's pending enrollment; replaying the confirming code | Secure. 409 `factor_exists`; confirm is bound to the session that started it; the per-member TOTP counter blocks replay; attempts capped at 5 (`mfa-enrollment.ts`) |
| Personal access tokens | minting scope above role; expiry over 90 days; scope limiting authority (PM session 200 vs `product:view` PAT 403 on deployments); PAT step-up; PAT managing tokens | Secure. 422 / 422 / 403 / 403 / 403 (`pat-authority.ts`) |
| `/api/stream` | private DM message delivered to a non-member | Secure. Withheld from the Tester and delivered to the participant; access re-checked on every event (`stream-cross-channel.ts`) |
| File uploads | `text/html`, `image/svg+xml` and off-policy types; oversize; **HTML bytes declared as `image/png`**; `../../../../etc/passwd.png` as the name; download TTL and disposition | Secure. 415 / 413 / **422 `type_mismatch`, never ready** / name stripped to `passwd.png` / inline raster with ≤60 s presigned GET (`file-upload-policy.ts`) |
| GitHub webhook | unsigned; wrong-secret signature; replayed delivery id; empty body; no secret configured | Secure. 401 / 401 / 409 / 400 / 503 fail-closed; valid signature 202 (`github-webhook.ts`) |
| Monitors / outbound webhooks SSRF | metadata, loopback, RFC 1918, `[::ffff:169.254.169.254]`, decimal/hex IPs, `file:`/`gopher:`, credentials in the URL, `localhost`/`*.internal`; **DNS rebinding** (a public name that resolves to 169.254.169.254, and mixed public+private answers) | Secure. The route refuses every target (`ssrf-monitors-webhooks.ts`). The guard resolves DNS itself, fails closed if *any* answer is private, pins the vetted IP on the socket, and re-checks every redirect hop, max 3 (`ssrf-guard-unit.ts`) |
| ML bridge HMAC | unsigned; tampered body; wrong key; timestamp beyond 300 s skew; replayed (timestamp, nonce) | Secure. All refused, valid accepted (`ml-hmac.ts`) |
| Assistant prompt injection | `<system>`/`</instructions>` delimiters, code-fence breakout, NUL/bidi characters, oversize input; live request asking for other products' docs and TOTP secrets | Secure. `sanitizeForPrompt` strips or neutralises all of these and caps length. `/ask` stays controlled (503 when unconfigured) and cites no out-of-scope source (`assistant-prompt-injection.ts`). Full model-in-the-loop testing needs `ANTHROPIC_API_KEY` |
| Backup restore | Operations (no Administration:admin); an admin-scoped PAT; a real restore without `confirm`; snapshot listing with a PAT lacking infra scope | Secure. 403 / 403 / 422 / 403 (`backup-restore-authz.ts`) |

### Live Docker stack (`security-tests/docker/infra-audit.sh`, read-only)

| Control | Result |
|---|---|
| Published ports | Only `edge` publishes (8088/8443). backend, frontend, postgres, minio and models publish no host port |
| Container hardening | Every service runs with `ReadonlyRootfs=true`, a non-root UID (edge 10002, frontend 101, backend/models 10001, postgres 70, minio 65532), `CapDrop=[ALL]`, no `CapAdd`, `no-new-privileges:true`, not privileged |
| Network segmentation | `postgres` and `minio` are only on `app_net`. `edge` (edge/public) and `frontend` (edge) share no network with postgres, minio or models, so **the edge can't reach Postgres**. `backend` bridges app/edge/egress as expected. Only backend and models are on egress, so the data tier has no internet path |
| Secrets in images | `docker history --no-trunc` and image `Env` for backend and models contain no secret values |
| MinIO anonymous access | Listing every bucket anonymously from inside `app_net` was denied (no 200) |
| MinIO per-service policy (policy-as-code, `infra/minio/bootstrap.sh`) | `devhq-backend`: uploads read/write/delete; backups put/get/list with an **explicit Deny** on Delete, DeleteVersion, BypassGovernanceRetention, PutObjectRetention, lifecycle, bucket policy and DeleteBucket; **audit put-only** (no read). `devhq-models`: models bucket only. Backups and audit use object lock with COMPLIANCE-mode retention in prod. The bootstrap checks each policy attachment. *I checked the policy, not live enforcement with each service's keys, because I didn't use the service secrets.* |

Not covered on the stack this pass: a browser-driven CYBER-005 PoC;
container-escape probing beyond the capability and rootfs posture; a live
check of presigned-URL scope and expiry against MinIO (covered in-process by
the local driver).

---

## 1. Executive summary

The DevHQ backend is unusually well-built for a zero-dependency Node service:
the authentication, session, authorization, CSRF/origin, validation and query
layers held up against the full phase-1 test battery. 11 attack classes that
commonly break in apps of this shape were tested and **confirmed robust**
(user enumeration, lockout-variant bypass, XFF rate-limit spoofing, session
rotation/sign-out/UA-binding, partial-session confusion, prototype-pollution &
operator abuse in the query runner, path traversal, header/log injection,
CSRF/origin/cookie flags, mass-assignment/BFLA/BOLA, the two-person deploy rule,
body-size limits, and CSP/nonce/clickjacking defences).

The assessment found **one new High-severity issue**: the Server-Sent Events
endpoint `GET /api/_events` broadcasts *every* published event — including the
entire real-time **audit trail** (actor IDs, actions, targets/IPs, chain
hashes) and all sign-in, deployment and incident events — to *every*
authenticated session with no role or product scoping. Any low-privilege member
(e.g. a Tester scoped to one product) can passively harvest cross-member and
cross-product security telemetry.

The remaining findings are the three issues already assigned to fix lanes
(verified and reproduced here as regression tests): the bearer token returned
in the response body / stored in `sessionStorage`, the universal demo MFA code
that satisfies MFA and step-up, and the same-origin blob-worker code runner that
can reach `/api` with the session cookie. Supply-chain scanning surfaced
vulnerable transitive dependencies (a critical DOMPurify advisory and a high
Vite advisory), though current code does not use DOMPurify in a sink and Vite is
dev-only, lowering effective risk. CI is low-risk (least-privilege tokens, no
`pull_request_target`, no github.event injection) apart from one action pinned
to a mutable `@master` ref.

**Totals:** 1 High · 3 Medium · 3 Low/Informational · 15 controls verified
secure. Automated suite (18 checks), run twice on fresh processes with
identical results: **14 PASS · 3 FAIL · 1 SKIP**. The three FAILs are the
confirmed vulnerabilities CYBER-001 (new), CYBER-002 and CYBER-003
(known/assigned); the SKIP is the monitors/webhooks SSRF check awaiting merge.

---

## 2. Findings

Severity uses CVSS v3.1. "Confirmed" = a PoC in `security-tests/` reproduces it;
"Theoretical" = established by code review, live PoC deferred. Owning lane per
WAVE4 §1.

| ID | Title | CVSS v3.1 | CWE | Affected file:line | PoC | Status | Owner |
|---|---|---|---|---|---|---|---|
| **CYBER-001** | Unscoped SSE broadcast leaks the full audit trail + all sign-in/deploy/incident events to every authenticated session | 7.4 High `AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:N/A:N` | CWE-200, CWE-668 | `Backend/routes/system.routes.ts:350-374`; `Backend/lib/events.ts:24-30`; publisher `Backend/audit/auditLog.ts:72` | `security-tests/checks/sse-cross-product-leak.ts` | **Confirmed** | SEC |
| **CYBER-002** | Universal demo MFA code (`246810`, disclosed by `/api/auth/demo-accounts`) satisfies MFA and step-up for any account whenever DEMO is enabled (all non-prod envs) | 6.5 Medium `AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N` (env-gated: prod disables DEMO) | CWE-798, CWE-287 | `Backend/routes/auth.routes.ts:436, 477`; `Backend/store/db.ts:66-70` | `security-tests/checks/demo-mfa-stepup-bypass.ts` | **Confirmed** | SEC / F-SEC |
| **CYBER-003** | Session bearer token returned in response body and stored in `sessionStorage` (JS-readable → XSS-exfiltratable, defeats HttpOnly cookie) | 5.3 Medium `AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:N/A:N` | CWE-522, CWE-539 | `Backend/routes/auth.routes.ts:130-140` (`deliver`/`wantsToken`); SPA `sessionStorage` per brief | `security-tests/checks/bearer-token-in-body.ts` | **Confirmed** | F-SEC |
| **CYBER-005** | Code-runner uses a **same-origin** blob `Worker`; user-supplied code can `fetch('/api/…')` with the session cookie (credentialed same-origin) | 5.4 Medium `AV:N/AC:L/PR:L/UI:R/S:C/C:L/I:L/A:N` | CWE-668, CWE-829 | `Frontend/src/utils/codeRunner.ts:139-140` | browser PoC deferred (phase 2) | Theoretical (code-confirmed) | F-SEC |
| **CYBER-006** | Vulnerable transitive dependencies in the Frontend tree (DOMPurify critical, Vite high, react-router, esbuild, minimatch, monaco-editor) | 9.3 Critical (DOMPurify advisory GHSA-cg2g-xh64-v4q7) / 7.5 High (Vite); **effective risk lower** — DOMPurify unused in a sink, Vite dev-only | CWE-1035, CWE-937, CWE-1104 | `Frontend/package-lock.json`; `npm audit` = 1 critical/1 high/10 moderate/1 low | `npm audit` (manual) | Confirmed (present); exploitability contextual | INFRA / F-SEC |
| **CYBER-004** | `v.object` "reject unknown fields" guarantee bypassable for prototype keys (`__proto__`, `constructor`, `prototype`, `toString`) via `k in shape` prototype-chain check — keys are silently ignored, not rejected (no pollution results) | 3.1 Low `AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N` | CWE-20, CWE-1321 (adjacent) | `Backend/lib/validate.ts:77` | note in `security-tests/checks/authz-mass-assignment-bfla.ts` | Confirmed (low impact) | SEC |
| **CYBER-007** | CI uses `aquasecurity/trivy-action@master` (mutable ref); all other actions pinned to mutable major tags rather than full commit SHAs | 2.0 Low (supply-chain hardening) | CWE-1357, CWE-829 | `.github/workflows/security.yml:78` | manual review | Confirmed | INFRA |

### CYBER-001 — detail & evidence (the one new High)

`GET /api/_events` (authenticated by any verified session, no role guard) calls
`subscribe()` on a single process-wide `EventEmitter` and writes **every**
event, verbatim, to the connected client:

```
Backend/lib/events.ts        — one global bus; subscribe() adds a listener, no filter
Backend/audit/auditLog.ts:72 — publish('audit', { ...entry }) on EVERY audit.append
Backend/routes/system.routes.ts:366 — subscribe((e) => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`))
```

Reproduced PoC output (Tester `m10` subscribes, a Developer `m4` signs in and an
Admin declares an incident on a product the Tester cannot see):

```
event: signin   data: {"data":{"memberId":"m4","city":"…","country":"…","risk":0}}
event: incident data: {"data":{"id":"INC-33","severity":"SEV3","status":"investigating"}}
event: audit    data: {"data":{"seq":3,"actor":"m4","action":"auth.demo_sign_in",
                               "target":"Developer · 127.0.0.1","prevHash":"…","hash":"…"}}
```

**Impact:** any authenticated low-privilege member passively receives the entire
live security audit stream (sensitive=true entries included), every member's
sign-in location/risk, and all deployment/incident activity across all products
— a cross-tenant confidentiality break and reconnaissance aid.
**Recommended fix (SEC):** scope each subscriber. Filter events in the
`subscribe` callback by the principal's role and products — gate `audit` (and
other security topics) to `Administration:view`, scope `signin`/`deployment`/
`incident`/`message` to the subscriber's products, and carry an explicit
`product`/`audience` field on each `publish()` so the SSE layer can filter
without guessing. The REST `/api/audit` pull endpoint should likewise gain a
role guard (currently `authenticate` only).

### CYBER-002 — detail

Both `/api/auth/mfa/totp` and `/api/auth/step-up` accept
`safeEqual(code, DEMO.mfaCode)` as a valid second factor **regardless of whether
the member enrolled a real TOTP secret**, and `/api/auth/demo-accounts` returns
the code and password in clear text. `DEMO.enabled` is true for every
`NODE_ENV !== 'production'` unless `DEMO_DISABLED=1`. Intended for demos, but any
non-production build that is ever network-reachable has a universal
second-factor / step-up bypass. **Fix (SEC/F-SEC):** require an explicit,
loudly-logged demo mode; never accept the shared code when the member has a real
factor; never serve the live code except behind that explicit mode.

### CYBER-003 — detail

`deliver()` adds `{ token, tokenType:'Bearer', expiresIn }` to the JSON body when
the request carries `X-DevHQ-Client: console`; the SPA stores it in
`sessionStorage`. Both are JS-reachable, so any XSS exfiltrates a live session
token, defeating the `__Host-`/HttpOnly/Secure/SameSite=Strict cookie that is
otherwise correctly set. **Fix (F-SEC):** cookie-only for browsers; issue
body/bearer tokens only to non-browser clients authenticated another way (e.g.
the scoped personal access tokens the SEC lane is adding), and never persist a
session token in web storage.

### CYBER-005 — detail

`codeRunner.ts` builds a `Blob` of user/module source and runs it in
`new Worker(objectURL)` on the **same origin**. A dedicated Worker has no parent
DOM and no `localStorage`, so those are not reachable — but same-origin
`fetch('/api/…')` sends the `__Host-` session cookie, so user-run snippet code
can call the DevHQ API **as the signed-in user**. **Fix (F-SEC):** run untrusted
code cross-origin (sandboxed iframe on a null/throwaway origin, or a Worker
served from a cookieless sandbox origin) and mediate any capability through
`postMessage`; a worker CSP of `connect-src 'none'` is a defence-in-depth
addition. A browser-driven PoC is staged for phase 2.

---

## 3. Controls verified secure (negative results)

Each was actively attacked; the control held. These are now regression tests.

| Area | What was tested | Result |
|---|---|---|
| Authentication | User enumeration via status/body + statistical timing (equalised by a dummy scrypt; measured median ratio ≈ 1.15) | Secure — indistinguishable |
| Authentication | Lockout bypass via email case/whitespace variants | Secure — all variants normalise (`trim().toLowerCase()`) to one account; lock (423) fires |
| Authentication / DoS | IP-based rate-limit bypass via spoofed `X-Forwarded-For` with `TRUST_PROXY` unset | Secure — XFF ignored, socket-IP bucket drained (40/100 → 429) |
| Authentication | Token reuse after step-up rotation, sign-out revocation, UA-binding (session theft) | Secure — old/rotated/signed-out/cross-UA tokens all 401 |
| Authentication | Partial (pre-MFA) session reaching verified routes / stage confusion | Secure — partial session limited to `/auth/pending` + MFA routes |
| Injection | Query runner (`POST /api/_query`): prototype-pollution field names, secret-field selection, unknown operators, oversize `limit` | Secure — field allow-list + operator allow-list + `limit` clamp all enforced (422) |
| Injection | Path traversal on `GET /fonts/:file` (encoded, double-encoded, null-byte, backslash) | Secure — strict `^[a-z0-9-]+\.woff2$` allow-list, all 404 |
| Injection | Response-header injection via `X-Request-Id`; log injection via CRLF | Secure — runtime rejects invalid header chars (no splitting); logs are JSON-encoded |
| Browser | CSRF / origin guard: cross-origin, `null`-origin, and non-JSON form bodies on state-changing routes | Secure — 403 / 403 / 415; same-origin write succeeds |
| Browser | Cookie flags | Secure — `__Host-devhq_session` with HttpOnly, Secure, SameSite=Strict, Path=/ |
| Browser | CSP effectiveness, nonce freshness, clickjacking | Secure — console CSP is nonce-only (no `unsafe-inline`/`unsafe-eval`), SPA script-src nonce+`strict-dynamic`, nonces differ per request, `frame-ancestors 'none'` + `X-Frame-Options: DENY` |
| Authorization | Mass assignment (extra `role`/`products`/`status`/`approvedBy` fields), BFLA (Tester → admin routes), BOLA (foreign-product object → 404) | Secure — unknown fields 422; admin routes 403/401 for non-admins; out-of-scope 404 |
| Authorization | Two-person production deploy rule + step-up | Secure — requester self-approval 403 `self_approval`; non-`manage` role 403; second-person approval 200 |
| DoS | Request body-size cap | Secure — 413 at >256 KiB before parsing |
| SSRF | Codespaces proxy host-pinning / fail-closed | Secure — upstream host is a compile-time constant (`api.github.com`); malformed `repo` → 422; no token → 401 (fails closed) |

Additional code-review positives: scrypt (N=2^15) password hashing with
constant-time compare; HMAC-signed session tokens verified before any lookup
(with previous-key acceptance for rotation); session fixation prevented by
`rotateSession`; absolute + idle session lifetimes; JIT grants enforce
two-person approval, approver-role allow-list, max duration and auto-expiry;
`assertProduct` returns 404 (not 403) so resource existence is not disclosed;
slow-loris timeouts (`headersTimeout`/`requestTimeout`/`keepAliveTimeout`) and
`maxHeadersCount` are set; secrets are redacted in logs and in `/api/_config`.

---

## 4. Supply chain, secrets & CI (static analysis)

- **Secret scan** (manual `git log -p` gitleaks-style over all history): no live
  secrets committed. `.env.example` placeholders only (empty
  `AWS_SECRET_ACCESS_KEY=` etc.); no `.pem`/`.key`/populated `.env` tracked.
- **`.npmrc`**: hardened — `ignore-scripts=true`, `strict-ssl=true`,
  `save-exact=true`, `package-lock=true`, `audit-level=high`, registry pinned to
  `registry.npmjs.org`. Keep as-is.
- **`npm audit`** (online): root/Frontend tree = **1 critical, 1 high, 10
  moderate, 1 low**. Critical = DOMPurify ≤3.4.16 (GHSA-cg2g-xh64-v4q7); High =
  Vite ≤6.4.3 (dev-server path traversal / `launch-editor`). See CYBER-006 — fix
  by bumping (several Dependabot PRs already open: `lucide-react`,
  `tailwindcss`, `dev-dependencies`). Backend has **zero runtime dependencies**
  (6 moderate advisories are all in dev-only tooling: `@typescript-eslint/*`).
- **GitHub Actions** (`ci.yml`, `lint.yml`, `security.yml`): least-privilege
  `permissions: contents: read`; triggers are `push` + `pull_request` only (no
  `pull_request_target`); no github.event values interpolated into `run:`
  (no script-injection vector); `GITHUB_TOKEN`/`GITLEAKS_LICENSE` scoped to the
  gitleaks step on PRs. One hardening gap — CYBER-007 (`trivy-action@master`).

---

## 5. Verification of the SEC lane's claimed controls (phase 2)

Each claim in `docs/security/CONTROLS.md` was checked independently, by an
attack in this suite or by reading the cited code. **Verified** = a CYBER
check attacks it and it held. **Code** = I read the cited lines and they do
what is claimed, but I didn't attack it separately. **Partial** = holds with
a caveat.

| Id | Claimed control | Verdict | How |
|---|---|---|---|
| C-01 | Cookie-only browser sessions; body token only for `cli` with no Origin and no Sec-Fetch-Site | **Verified** | `bearer-token-in-body.ts`, `csrf-origin-guard.ts` (cookie flags) |
| C-02 | HMAC-signed token, rotated on privilege change | **Verified** | `session-rotation-reuse.ts`: the old token is dead after step-up |
| C-03 | Sessions bound to context (UA change revokes) | **Verified** | `session-rotation-reuse.ts`: cross-UA → 401 |
| C-04 | AES-256-GCM at rest; prod fails closed without `DATA_ENCRYPTION_KEY` | **Partial** | `seal`/`open` read and used for TOTP. The fail-closed check runs **only when `NODE_ENV === 'production'` exactly**. Any other value falls back to a key derived from the source-code dev secret (CYBER-008) |
| C-05 | TOTP enroll → confirm → sealed; per-member replay protection | **Verified** | `mfa-enrollment.ts` (session binding, replay), `demo-mfa-stepup-bypass.ts` (real enrolment) |
| C-06 | Demo code only for factor-less seeded members; prod refuses `DEMO_*` | **Verified in scope; Partial overall** | `demo-mfa-stepup-bypass.ts` PASS. "Prod" means the exact string `production`. Staging and miscased values re-enable demo (CYBER-008) |
| C-07 / C-08 | WebAuthn registration and assertion (challenge binding, origin, rpIdHash, UV, signature before counter, clone suspension) | **Code** | Reviewed the cited `auth/webauthn.ts` checks and the existing smoke coverage (smoke:719, :766, :779). No independent CYBER PoC this pass; a browser/virtual-authenticator test is recommended |
| C-09 | PAT format, SHA-256 at rest, shown once, expiry ≤ 90 days, ≤ 20 active | **Verified** (expiry), **Code** (hashing, cap) | `pat-authority.ts` (3650 days → 422); `issueToken`/`verifyPat` store a hash only |
| C-10 | PAT authority = min(role, scope); scope above role refused; token management session-only; revoked on deactivation | **Partial** | `pat-authority.ts` PASS for scope intersection, scope above role, and token management. **Gaps:** Owner read visibility ignores scope (CYBER-009); `PATCH /api/team/:id` deactivation leaves JIT grants active (CYBER-010) |
| C-11 | PATs can never step up | **Verified** | `pat-authority.ts`, `backup-restore-authz.ts` (admin-scoped PAT refused) |
| C-12 | API `default-src 'none'`, XFO DENY, nonce console CSP | **Verified** | `csp-and-clickjacking.ts` |
| C-13 | Origin guard incl. `null` and Sec-Fetch-Site | **Verified** | `csrf-origin-guard.ts` |
| C-14 | Equal timing, lock after 5, risk gate | **Verified** | `auth-user-enumeration.ts` (median ratio ≈ 1.0–1.1), `auth-lockout-email-variants.ts` |
| C-15 / C-16 | Per-IP + per-account + per-member limits; pluggable store | **Verified** (per IP) | `auth-xff-ratelimit-spoof.ts`. A shared store is still needed to scale out (CONTROLS.md says so) |
| C-17 | XFF trusted only behind a proxy | **Verified** | `auth-xff-ratelimit-spoof.ts` |
| C-18 | Every state change audited, hash chain | **Code** | the existing smoke check for an intact chain; audit entries seen in the SSE PoC carried `prevHash`/`hash` |
| C-19 | Body cap, timeouts | **Verified** (body) | `dos-body-size.ts` |
| C-20 | Single password policy | **Code** | accept-invite enforced the policy during `inviteMember` setup |
| C-21 | Per-subscriber event filtering (fix for CYBER-001) | **Verified** | `sse-cross-product-leak.ts` PASS |
| C-22 | Validator own-property allow-list (fix for CYBER-004) | **Verified** | `authz-mass-assignment-bfla.ts` no longer reports prototype keys |

**Summary:** 22 claims. 15 Verified, 4 Code, 3 Partial (C-04, C-06, C-10).
None was false as described. The three Partials come down to two root causes:
the exact-string production check (CYBER-008) and the two gaps SEC had already
listed (CYBER-009/010).

---

## 6. Residual risk & hardening recommendations

1. **Edge / WAAP:** the app correctly assumes TLS termination + bot mitigation
   at the edge and re-enforces everything itself. Ensure the edge sets
   `TRUST_PROXY=1` **only** when it strips and re-writes `X-Forwarded-For`; if
   the process is ever exposed directly, leave it unset (as tested).
2. **Monitoring / detection:** the audit chain is tamper-evident — ship it to
   WORM storage and alert on `audit.verify()` breaks, on `auth.locked` /
   `auth.blocked_risk` spikes, and on new `jit.approved` grants. (Do not rely on
   SSE for this until CYBER-001 is fixed.)
3. **Rate limiting:** in-memory per-process buckets must move to a shared store
   (Redis) behind >1 instance, or an attacker rotates across instances.
4. **Incident response:** `POST /api/auth/sign-out-everywhere` and
   `revokeAllFor` give a clean account-compromise kill switch; wire these into
   the IR runbook alongside JIT revoke.
5. **Supply chain:** pin CI actions to full commit SHAs (CYBER-007); land the
   dependency bumps (CYBER-006); keep `ignore-scripts=true`.
6. **Phase-2 surface (Docker/ML/MinIO):** container capabilities & escape,
   network segmentation (edge must not reach Postgres directly), secrets in
   image layers (`docker history`), MinIO bucket policies (no anonymous access;
   presigned URL scope/expiry), ML-service HMAC (timestamp + 5-min skew, no
   pickle loading), and GitHub webhook signature verification on the raw body.

---

## 7. Reproduction

```bash
# From repo root. Boots a fresh, isolated backend process per check on 127.0.0.1.
node --experimental-strip-types security-tests/run.ts            # full suite + PASS/FAIL/SKIP table
node --experimental-strip-types security-tests/run.ts sse auth   # filter by name/area
node --experimental-strip-types security-tests/checks/sse-cross-product-leak.ts  # any check standalone
```

PASS = control holds · FAIL = vulnerability reproduced (regression target) ·
SKIP = surface not present in this branch / egress out of local scope. The
runner exits non-zero if any check FAILs.
