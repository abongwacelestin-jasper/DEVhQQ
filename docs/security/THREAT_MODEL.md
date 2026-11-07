# DevHQ threat model (Wave 4)

Method: STRIDE per component. Each row gives the threat, the control that
mitigates it, and the residual risk. Control ids (`C-xx`) refer to
[CONTROLS.md](./CONTROLS.md), which maps each one to code and tests.

## System and trust boundaries

```
 Browser (SPA, console) ──TLS 1.3──▶ edge (Caddy) ──▶ frontend (nginx, static)
                                        │
                                        └─/api──▶ backend (Node 22) ──▶ postgres (internal)
                                                      │  ├────────────▶ minio (internal, presigned URLs to browser)
                                                      │  └─HMAC──────▶ models (Python ML, internal)
                                                      └──▶ GitHub / SMTP (egress)
 CLI / CI ──TLS──▶ edge ──▶ backend   (PAT bearer tokens)
```

The trust boundaries are:

- **TB1:** internet → edge.
- **TB2:** edge → internal network.
- **TB3:** backend → data stores.
- **TB4:** backend → ML service.
- **TB5:** browser page script → session credential.

Assets, in rough priority order:

1. Session cookies and PATs.
2. Second-factor material: TOTP seeds and passkey public keys with their
   counters.
3. Production deploy approval (step-up plus JIT).
4. Audit log integrity.
5. Product data (tasks, docs, files) scoped by product.
6. Third-party tokens (GitHub App, SMTP).

Actors:

- Anonymous internet users.
- Phishing operators.
- A malicious or compromised member, any role.
- An XSS payload running in the SPA origin.
- A stolen laptop or stolen CLI token.
- An attacker with read access to a DB or backup snapshot.
- An attacker on the internal network.

---

## 1. Edge (Caddy, TLS termination, `/api` reverse proxy)

| STRIDE | Threat | Mitigation | Residual |
|---|---|---|---|
| S | Spoofed `X-Forwarded-For` to dodge IP rate limits or risk scoring | Backend trusts XFF only with `TRUST_PROXY=1`, and the edge must overwrite (not append) XFF. C-17 | The deployment must set this correctly. INFRA owns the edge config |
| T | TLS downgrade or stripping | HSTS 2y + preload in production (C-12), TLS 1.3 at the edge, `upgrade-insecure-requests` | The first visit before preload is vulnerable |
| R | No record of blocked traffic | Backend logs every request with its request id. Edge access logs are retained by INFRA | Edge log retention is outside SEC scope |
| I | Edge serves `/api` responses from cache | `Cache-Control: no-store` on every API response (C-12) | — |
| D | Volumetric or slow-loris attacks | Edge connection limits. Backend `headersTimeout`/`requestTimeout`, body cap, per-IP token bucket (C-15) | Real DDoS needs upstream (CDN/WAAP) protection |
| E | Edge exposes internal services (models, postgres, minio console) | Compose networks: only `edge` publishes ports, and the MinIO console runs only in the dev profile | Misconfiguration risk. INFRA has a CI check |

## 2. Backend API (Node 22, `Backend/`)

| STRIDE | Threat | Mitigation | Residual |
|---|---|---|---|
| S | Credential stuffing or password spraying | scrypt hashes; constant-time unknown-user path; account lock after 5 failures; per-IP **and** per-account rate limits (C-15); location risk gate | A distributed slow spray stays under the limits. Lockouts are visible in the audit log |
| S | TOTP brute force (10⁶ codes, 3 valid per window) | Per-member `accountLimiter` (prod: 5 burst, 1 per 30 s) plus the IP limit (C-15) | ~3e-6 success chance per allowed guess |
| S | TOTP replay (shoulder-surfed code) | Per-member last-counter across all sessions, plus per-session counter (C-05) | — |
| S | Phishing a TOTP code in real time | Passkeys are offered first and are origin-bound (C-07/C-08). TOTP is the fallback | TOTP stays phishable. Policy should require passkeys for Owner/Operations |
| S | Demo shortcut used against real accounts | Demo code only for members with **no** TOTP and **no** passkey. Production refuses to boot with `DEMO_*` (C-06) | In non-prod, demo accounts are open by design |
| S | Session theft via XSS (token in JS) | Browsers get **cookie-only** sessions (`__Host-`, HttpOnly, Secure, SameSite=Strict). Body tokens only go to explicit CLI requests that carry no `Origin` or `Sec-Fetch-Site` (C-01) | An XSS payload can still *ride* the session while the page is open (see §6) |
| S | Stolen session token replayed from another device | UA binding revokes the session. An IP change forces step-up. Idle and absolute timeouts apply (C-03) | Same-UA attackers on the same IP are not detected |
| S | Stolen PAT | SHA-256 at rest. Scoped and intersected with the live role. Expiry ≤ 90 d. Revocable. Revoked on deactivation. `lastUsedAt`/IP recorded. **Never** satisfies step-up (C-09/C-10) | A PAT is a bearer secret until it expires or is revoked. Scanner-friendly `dhq_pat_` prefix |
| S | Forged WebAuthn assertion | Single-use, expiring challenge bound to purpose, member and session. Checks on rpIdHash, origin allow-list, UP/UV, the algorithm allow-list, and the ES256/EdDSA/RS256 signature over `authData‖SHA256(clientData)`. Counter regression suspends the key (C-07/C-08) | `attestation: none`, so authenticator make/model is not proven |
| T | CSRF / cross-site state change | Origin allow-list on every non-GET/HEAD method. `Sec-Fetch-Site` second check. SameSite=Strict. JSON-only bodies (form posts get 415) (C-13) | — |
| T | Mass assignment (`role: "Owner"` in PATCH) | Allow-list validators reject unknown keys (lib/validate.ts) | — |
| T | Tampering with audit history | Hash-chained log plus `/api/audit/verify`. Append-only file. WORM bucket in prod (STORAGE) (C-18) | Root on the host can rewrite the in-memory chain before it ships |
| R | A member denies a sensitive action | Every state change appends an audit entry with actor, target and request id: sign-in, MFA, step-up, TOTP enroll/confirm, passkey add/remove/suspend, PAT create/revoke (C-18) | — |
| I | Secrets in responses or queries | `publicMember` projection. The query runner allow-lists fields. PAT/TOTP secrets are shown once. Errors never leak stacks | — |
| I | Product data across tenants or products | `canSeeProduct`; out-of-scope reads return 404 (BOARD rule) | Routes that test `role === 'Owner'` directly are not PAT-scope-aware (see CONTROLS gaps) |
| I | Live event stream (`/api/_events`) leaks audit, sign-in or other products' events (CYBER-001) | Per-subscriber filtering at delivery; security events need Administration:view; product events need `canSeeProduct`; unknown types are denied (C-21) | New event types stay invisible until they are classified in `security/eventPolicy.ts` |
| I | Account enumeration | Identical error and timing for unknown vs wrong password. Passkey sign-in options carry no `allowCredentials` | — |
| D | Memory exhaustion via challenge or bucket spraying | Pending WebAuthn challenges capped at 10k; rate-limit store capped at 100k keys with idle eviction; body cap 256 KB | Per-process. A shared store is needed with multiple replicas (C-16) |
| E | Privilege escalation via token scope | `effectiveLevel = min(role, scope)` is computed on every request. Scopes above the role are refused at creation. Token management is session-only (C-10) | — |
| E | Sensitive action without fresh proof | `requireStepUp` (5 min). PATs are refused with 403 `step_up_unavailable`. JIT elevation for production (C-11) | — |

## 3. PostgreSQL (`documents` jsonb store, B-DATA)

| STRIDE | Threat | Mitigation | Residual |
|---|---|---|---|
| S | Another service connects as the app | Internal network only. A dedicated least-privilege role. `DATABASE_SSL` in prod | Credentials live in env. Rotate them through INFRA |
| T | Row swapping (copying one member's sealed TOTP onto another) | AES-GCM AAD binds each ciphertext to `member:<id>:totp`, so a swapped value fails to open (C-04) | — |
| T | SQL injection | Generic parameterised driver. Lanes never write SQL (WAVE4 §3) | — |
| R | Silent data edits | Audit chain for app-level changes. Postgres logging is INFRA's job | DB superusers bypass the app audit |
| I | DB dump or backup snapshot leak | TOTP seeds and third-party tokens sealed with AES-256-GCM (`DATA_ENCRYPTION_KEY`, not stored in the DB). PATs and invite tokens stored as SHA-256 only. Passwords hashed with scrypt (C-04/C-09) | Session records are bearer ids, but the cookie needs the HMAC (`SESSION_SECRET`) |
| D | Exhaustion from write amplification | PAT `lastUsedAt` written at most once per minute per token | — |
| E | A DB compromise yields login | Seeds need the data key, and passkeys hold only public keys | An attacker with both the DB and the env has full access. Keep keys in a secret store |

## 4. MinIO / S3 object storage (STORAGE)

| STRIDE | Threat | Mitigation | Residual |
|---|---|---|---|
| S | Unauthenticated access to objects | Private buckets. Short-lived presigned GET/PUT issued only after RBAC (STORAGE) | Anyone holding a presigned URL can use it until it expires |
| T | Malicious upload (HTML/SVG served from the API origin) | Content-type and size allow-list, magic-byte check on `complete`, `Content-Disposition: attachment`, separate bucket origin | — |
| R | Backup or audit deletion | Object Lock / WORM on the backup and audit buckets in prod | Dev MinIO has no lock |
| I | Bucket listing or a public bucket | No public policies. The console is internal and dev-only | — |
| D | Storage fill | Per-upload size cap. Quotas are a future item | — |
| E | Stolen MinIO root credentials | Root credentials are never given to the backend. It uses a scoped access key | — |

## 5. ML service (Python, `models:8000`, internal)

| STRIDE | Threat | Mitigation | Residual |
|---|---|---|---|
| S | Something other than the backend calls the model | Internal network only. HMAC `X-DevHQ-Signature` with `ML_SERVICE_TOKEN` and a 5-minute timestamp skew | The shared secret must rotate together on both sides |
| T | Prompt injection through task, doc or message text | `sanitizeForPrompt`. The assistant has no tools or write access. Output is treated as untrusted and rendered as text | Model output can still be wrong or misleading, so it is labelled `source:'model'` |
| R | Untraceable assistant answers | Each answer carries `sources[]` and `model`. Backend request ids are forwarded | — |
| I | Data leaks across products via the assistant | The backend builds context only from records the caller can see, and the scope is sent explicitly | Model-provider retention follows the `ANTHROPIC_API_KEY` account terms |
| D | A slow model blocks the API | Timeouts, and the backend falls back to heuristic `lib/geo.ts` risk | — |
| E | Model-service RCE reaching the DB | The service has no DB or S3 write credentials beyond the models bucket | — |

## 6. Browser (SPA and backend console)

| STRIDE | Threat | Mitigation | Residual |
|---|---|---|---|
| S | Phishing site captures credentials | Passkeys are origin-bound. TOTP is a fallback | See §2 |
| T | XSS | React escaping. The console builds DOM with `textContent`; its three `innerHTML` sinks are a static string, static icons, and the JSON highlighter (which runs `escapeHtml`). Strict CSP: nonce plus `strict-dynamic`, `script-src-attr 'none'`, `object-src 'none'`, `base-uri 'none'` (C-12). Trusted Types is not yet enforced | The SPA's CSP is applied by the edge/nginx (F-SEC/INFRA). The console's CSP comes from the backend |
| T | Clickjacking | `frame-ancestors 'none'` + `X-Frame-Options: DENY` | — |
| I | Token exfiltration by XSS | No session token is ever exposed to script (C-01). F-SEC must remove the sessionStorage token code | An XSS payload can act as the user while the tab is open. Step-up limits the blast radius for sensitive actions |
| I | Cross-origin leaks (Spectre, window references) | COOP/CORP same-origin, COEP require-corp, `Origin-Agent-Cluster` | — |
| D | Lock-screen bypass | Lock state is enforced on the server (`verifiedAt = 0` → step-up required). Client lock is UX only | — |
| E | A client-side role check is bypassed | Every check is repeated on the server. Client `can()` only hides UI | — |
