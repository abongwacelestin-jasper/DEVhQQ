# DevHQ — Independent Security Assessment (Lane CYBER)

**Assessment type:** authorized, independent offensive assessment of the
repository owner's own project, tested only against local processes started by
the assessor on 127.0.0.1.
**Branch under test:** `wave4/integration` merged to this worktree (contains
`b56a27b wave4: assurance lanes addendum`).
**Date:** 2026-11-07 · **Phase:** 1 (pre-merge build lanes; Docker/ML/MinIO
deferred to phase 2).
**Scope boundaries honoured:** no external hosts, no third-party services, no
DoS against shared resources, no real credentials (demo accounts only). No
control was weakened to make any exploit work. CYBER owns `security-tests/**`
and `docs/security/assessment/**` only and never edits application code.

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

To be completed when the SEC lane merges into `wave4/integration`. Planned
checks against the SEC contract (WAVE4 §6):

- **Scoped personal access tokens** (`/api/tokens`): hashed at rest (DB never
  stores a usable token), shown once, expiry required/enforced, scope honoured,
  revoke (`DELETE /api/tokens/:id`) actually invalidates.
- **Real WebAuthn** for sign-in / step-up / lock-screen unlock: challenge is
  single-use and bound to origin + RP ID; assertion `signCount` monotonicity
  enforced (clone detection); registration rejects weak algorithms.
- **TOTP enroll/confirm**: secret encrypted at rest with `DATA_ENCRYPTION_KEY`
  (AES-256-GCM); enrollment requires confirmation; replay guard preserved.
- **`DATA_ENCRYPTION_KEY`** absence fails closed in production; present key is
  never logged or returned by `/api/_config`.
- Re-run of CYBER-001..007 against the merged branch to confirm fixes land and
  the regression suite flips CYBER-001/002/003 to PASS.

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
