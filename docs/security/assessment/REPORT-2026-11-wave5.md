# Security assessment, wave 5 (November 2026)

Independent white-box review of everything that changed between `v2.0.0` and
`develop@a50870b`: 63 commits, 151 code files. That covers account settings and
change password, JIT enforcement, audit continuity, incident action items, Resend
email, the Railway, R2 and Caddy configuration, Cloudflare Turnstile, the Redis
rate-limit store, the event fan-out, job leases and session store, the relational
Postgres data layer, and frontend route splitting and CSP.

Method: code reading by the assessor and two sub-reviewers (data layer and SQL;
mail, incident actions and settings), with targeted proof-of-concept tests run
on their own. No application code was changed during the assessment. Fixes
followed on `develop`; the status column records them.

**No Critical or High findings.** Eight findings were fixed with regression
tests before release (W5-01 to W5-07, W5-09). The rest are open, with owners
and plans below.

## Summary

| ID | Title | Severity | Status |
|---|---|---|---|
| W5-01 | A revoked session can be written back by an in-flight request | 6.8 Medium | **Fixed** |
| W5-02 | JIT grants listed and approved by approvers outside the product | 5.5 Medium | **Fixed** |
| W5-03 | Turnstile CLI exemption on by default and spoofable | 5.3 Medium | **Fixed** |
| W5-05 | Any member can name any incident owner, who gets a platform email | 4.6 Medium | **Fixed** |
| W5-07 | Last-Owner guard races | 4.4 Medium | **Fixed** |
| W5-06 | Access-request email flood with attacker text in the subject | 4.3 Medium | **Fixed** |
| W5-08 | Whole-table reads on hot paths | 4.3 Medium | Open (phase 2) |
| W5-04 | Password change and reset leave personal access tokens valid | 4.2 Medium | **Fixed** |
| W5-10 | Origin trusts every Cloudflare range | 3.7 Low | Open (deploy config) |
| W5-11 | Lockout check and TOTP counter are not atomic (pre-existing) | 3.7 Low | Open |
| W5-09 | More than one replica allowed once Redis is configured | 3.1 Low | **Fixed** |
| W5-12 | Field-level writes fall back to an upsert | 3.1 Low | Open (phase 2) |
| W5-13 | Audit-table privileges before roles step 2 is re-run | Info | Open |
| W5-14 | Small items | Info | Open |

## Findings

### W5-01: a revoked session can be written back (6.8 Medium)

`AV:N/AC:H/PR:L/UI:N/S:U/C:H/I:H/A:N`, CWE-367 / CWE-613.

`validateSession` (`Backend/auth/sessions.ts`) read the session, then stored it
again with `INSERT … ON CONFLICT DO UPDATE` (`Backend/data/sessions.ts`). A
revoke (`DELETE`) that committed between the two was undone by the upsert.
`rotateSession` had the same window. The affected revokes are sign-out-others,
password change and reset, single-session revoke, role change and offboarding.

**Exploit.** Someone holding a stolen token keeps requests in flight, from
changing IPs so that each request writes back, while the victim signs out other
sessions. The token works again on every replica. The same IP keeps
`verifiedAt`, so the session can come back fully verified. Deactivation still
held, because `authenticate` re-checks member status.

**Fix (verified).**
- Every session store has an update-only `refresh()`: SQL `UPDATE`, Redis
  `SET … XX`, a presence check in memory. If the row is gone the request ends
  with 401 `session_revoked`.
- New sessions are the only path that inserts.
- `rotateSession` mints a successor only if its own `DELETE` removed the old row.
- Regression test: `Backend/test/unit/session-revoke-race.test.ts` injects read
  latency so the revoke lands mid-request.

### W5-02: JIT grants approvable outside the product (5.5 Medium)

`AV:N/AC:L/PR:H/UI:N/S:U/C:L/I:H/A:N`, CWE-285 / CWE-639.

`approveGrant` checked the approver's role and self-approval, but not the
product. `GET /api/access/grants` returned every grant to `Administration:view`,
and revoke needed only `Deployment:manage`. An Operations member scoped to Blog
could see a RenewBerry request, its reason included, and satisfy the two-person
rule for it.

**Fix (verified).** Approve and revoke return 404 unless the caller can see the
grant's product, and the list is filtered the same way. Regression test:
`Backend/test/integration/jit-product-scope.test.ts`.

### W5-03: Turnstile CLI exemption on by default (5.3 Medium)

`AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:N`, CWE-693 / CWE-290.

A bot that sends `X-DevHQ-Client: cli` and omits `Origin` and `Sec-Fetch-Site`
skipped Turnstile on sign-in, recovery, accept-invite and demo.

**Fix (verified).**
- `TURNSTILE_EXEMPT_CLI` now defaults to `0`.
- Production refuses `1` unless `TURNSTILE_EXEMPT_CLI_ACK=bots-can-claim-cli` is
  also set.
- CLI automation is expected to use personal access tokens, which never touch
  these routes.
- Tests: `Backend/test/unit/turnstile.test.ts`.

### W5-04: personal access tokens survive a password change (4.2 Medium)

`AV:N/AC:H/PR:L/UI:N/S:U/C:L/I:L/A:N`, CWE-613.

`revokeTokensFor` was called only on deactivation and offboarding, and the
password-changed email claimed every session had been signed out.

**Fix (verified).** Password change and reset revoke the member's tokens, the
audit entry counts them, and the email says so. Regression test:
`Backend/test/integration/w5-hardening.test.ts`.

### W5-05: incident owner not validated (4.6 Medium)

`AV:N/AC:L/PR:L/UI:R/S:U/C:L/I:L/A:N`, CWE-639 / CWE-451.

Any member could declare an incident naming any member id as owner. That
member then got a genuine "[SEV1] … assigned to you" email carrying
attacker-written text, and could be outside the product.

**Fix (verified).** An owner other than the declarer must be an active member
who can see the product; otherwise the response is 422 `invalid_owner`.
Regression test: `w5-hardening.test.ts`.

### W5-06: access-request email flood (4.3 Medium)

`AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N`, CWE-799 / CWE-451.

There was no per-member limit, the free-text `path` went into the admins'
subject, and the reason went into the inbox preview.

**Fix (verified).**
- `path` must match a route shape of at most 60 characters.
- Each member can send at most 5 requests per hour; the sixth gets 429.
- The reason appears only in the escaped body, never in the preheader.

Regression test: `w5-hardening.test.ts`.

### W5-07: last-Owner guard races (4.4 Medium)

`AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:N/A:H`, CWE-367.

Two Owners demoting each other concurrently could both pass the
"another Owner remains" check.

**Fix (verified).** Demotion, deactivation and offboarding completion run under
one process-level lock (`Backend/lib/mutex.ts`). That is sufficient because
production runs one replica (see W5-09). When replicas are allowed, the check
and write move into one SQL transaction. Regression test: concurrent mutual
demotion in `w5-hardening.test.ts`.

### W5-08: whole-table reads (4.3 Medium), open

`AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:L`, CWE-400 / CWE-770.

- `integrations/ml/features.ts` loads every task, event and comment per
  insights call.
- `routes/assistant.routes.ts` loads all members, credential columns included.
- `sessions.listByMember` has no cap.

Bounded today by organisation size and the per-member rate limits. **Plan:**
data-layer phase 2 moves these into scoped SQL with column lists and limits
(ADR 0011).

### W5-09: more than one replica allowed with Redis (3.1 Low)

`AV:N/AC:H/PR:L/UI:N/S:U/C:L/I:N/A:N`, CWE-613.

**Fix (verified).** Production refuses `EXPECT_REPLICAS>1` even with Redis
until JIT grants, personal access tokens and recovery tokens are
repository-backed (ADR 0011 phase 3). Test: `Backend/test/unit/redis.test.ts`.

### W5-10: origin trusts every Cloudflare range (3.7 Low), open

`AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:L/A:N`, CWE-348.

The right-to-left `X-Forwarded-For` handling is correct, and a forged
`CF-Connecting-IP` sent straight to Railway is ignored. The residual risk is
traffic from any Cloudflare range, such as Workers or another zone, being
trusted. **Plan:** turn on Authenticated Origin Pulls, or add a secret header
from a Cloudflare Transform Rule that the frontend checks, and remove the
`*.up.railway.app` domain (on the Railway go-live checklist).

### W5-11: lockout and TOTP counter not atomic (3.7 Low), open, pre-existing

`AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N`, CWE-307 / CWE-294.

`lockedUntil` is read before the async scrypt, and the TOTP replay counter is
per session, so concurrent submissions can both pass. The per-IP, per-account
and per-member limiters still bound guessing. **Plan:** move the lockout
decision into the atomic `members.update`, and keep the TOTP counter per member.

### W5-12: field-level writes fall back to an upsert (3.1 Low), open

`data/tasks.ts` and `data/members.ts` fall back to upserts, so a task PATCH
racing a DELETE can bring the task back, and a whole-array passkey write can
re-add a removed passkey. **Plan:** update-only writes, as in the W5-01 fix, in
data-layer phase 2.

### W5-13: audit privileges before roles step 2 (Info), open

Default privileges give `devhq_app` UPDATE and DELETE on `audit_entries` and
`schema_migrations` until `postgres-roles.sql` step 2 is re-run after the first
migration. The audit triggers still block changes. **Plan:** put the REVOKE
inside the migration.

### W5-14: small items (Info), open

- The `announced` set in `mail/events.ts` grows without bound.
- A malformed paging cursor answers 500 instead of 400.
- `DATABASE_MIGRATION_URL_FILE` is documented but missing from `entrypoint.sh`.
- `SMTP_FROM` overrides `MAIL_FROM` without validation.
- Some comments in `sessionStore.ts` and `cache.ts` are stale.
- On other replicas, role and product changes reach an open realtime stream at
  the next 15 s heartbeat.

## Reviewed and OK

- **SQL:** every query in `data/*.ts`, the backfill, migrate and the audit sink
  is parameterized. Identifiers come only from constant maps, lists use
  `ANY($n::text[])`, and the partition DDL uses `%I` / `%L`.
- **Atomic writes:** the task-key counter is atomic. Backup-code burns and the
  failed-login counter use `SELECT … FOR UPDATE`.
- **Sessions table:** stores a SHA-256 of the token's random id, never the token.
  Revoking by prefix is limited to the caller's own sessions.
- **Database roles:** the runtime and jobs roles have no DDL, and the migration
  URL is removed from everything except migrate. Secrets support `_FILE` and are
  redacted in logs and `/api/_config`.
- **Redis:**
  - The token-bucket Lua script takes its key via KEYS and the time from Redis
    `TIME`, and fails closed for auth.
  - Job leases use `SET NX PX` and are never released early.
  - Pub/sub envelopes are size- and shape-checked, echoes are dropped, and the
    event policy is re-checked on the receiving replica.
- **Turnstile (apart from W5-03):** hostname and action checks, test keys refused
  in production, replay set, fail-closed by default, fail-open audited.
- **JIT (apart from W5-02):** tokens are refused before the Owner shortcut, the
  404 scope check comes first, expiry is checked on every read, and the right
  actions are gated.
- **Change password:** session only, step-up, the current password, both
  limiters, token rotation, audited.
- **Incident actions:** 404 before 403, no IDOR across incidents, owner
  validated, limits, audited.
- **Email:** full HTML and attribute escaping, `safeHref`, links from the
  configured `APP_URL`, line breaks stripped from headers, tokens only in links,
  recipients masked in logs.
- **Audit chain:** continues across restarts.
- **Caddy and CSP:** no `unsafe-inline` or `unsafe-eval` for scripts. The
  third-party origins are Turnstile, Stripe, R2 and two image hosts, and the
  sandbox hash is stamped into the header at build.

## Not verified

- How Railway and Cloudflare handle `X-Forwarded-For` and `CF-Connecting-IP` at
  the edge, and whether a `*.up.railway.app` domain is reachable.
- Anything live against Redis or Postgres for W5-07 and W5-12. W5-01 was proven
  on the memory store with injected latency.
- The R2 bucket and CORS rules as actually applied.
- Third-party fetches from frontend lazy chunks under the built CSP.
- Resend delivery and quota behaviour.
- Load testing for W5-06 and W5-08.
- `.github/workflows/` (out of scope).
