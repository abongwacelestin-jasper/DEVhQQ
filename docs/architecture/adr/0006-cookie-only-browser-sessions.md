# 0006. Browser sessions travel only in a `__Host-` cookie

- **Status:** Accepted, implemented (cookie delivery since Wave 1; cookie-only
  browsers, CLI-only body tokens and personal access tokens in Wave 4, F-SEC
  and SEC lanes).
- **Date:** 2026-10-30, revised 2026-11-07

## Context

A session token that JavaScript can read can be stolen by any script that
runs in the page: an XSS bug, a compromised dependency, a browser extension.
An `HttpOnly` cookie cannot be read by script at all, and the `__Host-`
prefix makes the browser enforce `Secure`, `Path=/` and no `Domain`, so the
cookie cannot be set or scoped by a sibling subdomain. `SameSite=Strict` stops
it from being sent on cross-site requests.

Until Wave 4 the web app also asked for the raw token in response bodies and
kept a copy in `sessionStorage`, which the independent assessment confirmed as
an exfiltration path (CYBER-003 in
[docs/security/assessment/REPORT.md](../../security/assessment/REPORT.md)).
Command-line tools and unattended scripts still need a header-based
credential.

## Decision

1. Every successful sign-in, MFA, enrolment, step-up and passkey verification
   sets `__Host-devhq_session=<token>; Path=/; HttpOnly; Secure;
   SameSite=Strict; Max-Age=…` (`Backend/middleware/authenticate.ts`). A
   password-only session gets a 10-minute cookie; a verified one lives for the
   absolute session lifetime (12 h by default).
2. Browsers use **only** the cookie. The web app's client
   (`Frontend/src/api/client.ts`) sends `credentials: 'same-origin'` and never
   sees the token. The backend console uses the cookie too.
3. The raw session token is returned in a response body only when the request
   sends `X-DevHQ-Client: cli` **and** carries neither `Origin` nor
   `Sec-Fetch-Site` — headers every browser adds — so page script cannot
   request it (`wantsBodyToken()` in `Backend/routes/auth.routes.ts`).
4. Unattended clients use **personal access tokens**
   (`Backend/security/pats.ts`, `/api/tokens`): `dhq_pat_…`, hashed at rest,
   shown once, scoped, expiring within 90 days, never able to pass step-up or
   manage credentials.

## Consequences

- An XSS bug can still act as the user while the page is open, but cannot
  exfiltrate a reusable credential.
- Cookies are ambient, so CSRF must be handled: the origin guard rejects
  state-changing requests from non-allow-listed origins, bodies must be
  `application/json` (a cross-site HTML form cannot send that without a
  preflight), and the cookie is `SameSite=Strict`.
- The API and the web app must share an origin in every environment: the Vite
  proxy in development, the edge in production (`/` → frontend,
  `/api` → backend). `VITE_API_BASE` must stay empty.
- Local development over plain `http` works only on loopback origins
  (`localhost`, `127.0.0.1`), which browsers treat as secure contexts. See
  [Troubleshooting](../../getting-started/troubleshooting.md#signed-in-but-every-call-is-401).
- Step-up and MFA rotate the session token (the old one is revoked at once).
  Cookie clients get the new cookie automatically; CLI clients must replace
  their token from the response body.
- The backend console does not yet restore its session from the cookie after
  a reload; the operator signs in again (listed in [docs/security/CONTROLS.md](../../security/CONTROLS.md#known-gaps--follow-ups)).

## References

- `Backend/middleware/authenticate.ts`, `Backend/routes/auth.routes.ts`,
  `Backend/security/pats.ts`, `Frontend/src/api/client.ts`
- [Authentication guide](../../api/authentication.md),
  [Sessions](../../concepts/sessions.md)
