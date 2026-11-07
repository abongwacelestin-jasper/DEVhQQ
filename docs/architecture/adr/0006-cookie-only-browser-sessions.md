# 0006. Browser sessions travel only in a `__Host-` cookie

- **Status:** Accepted. The server side is implemented; removing the bearer
  fallback from the web app and adding personal access tokens for
  non-browser clients is planned for Wave 4 (F-SEC and SEC lanes).
- **Date:** 2026-10-30 (cookie delivery), 2026-11-07 (cookie-only target)

## Context

A session token that JavaScript can read can be stolen by any script that
runs in the page: an XSS bug, a compromised dependency, a browser extension.
An `HttpOnly` cookie cannot be read by script at all, and the `__Host-`
prefix makes the browser enforce `Secure`, `Path=/` and no `Domain`, so the
cookie cannot be set or scoped by a sibling subdomain. `SameSite=Strict` stops
it from being sent on cross-site requests.

CLIs, the backend console and scripts cannot use a browser cookie jar
conveniently and need a header-based credential.

## Decision

1. Every successful sign-in, MFA, step-up and passkey verification sets
   `__Host-devhq_session=<token>; Path=/; HttpOnly; Secure; SameSite=Strict;
   Max-Age=…` (`Backend/middleware/authenticate.ts`). A password-only session
   gets a 10-minute cookie; a verified one lives for the absolute session
   lifetime (12 h by default).
2. The API also accepts `Authorization: Bearer <token>`. It returns the token
   in the JSON body **only** when the request carries
   `X-DevHQ-Client: console` (`wantsToken()` in
   `Backend/routes/auth.routes.ts`). Bearer wins if both are sent.
3. The target for browsers is **cookie only**: the web app never asks for,
   stores or sends the raw token.
4. Non-browser clients move to scoped, expiring personal access tokens instead
   of copying a session token.

What the code does today:

- The backend console (`/console`) and the smoke test use the bearer flow on
  purpose.
- The web app's API client (`Frontend/src/api/client.ts`) still sends
  `X-DevHQ-Client: console` on every call, keeps the returned token in
  `sessionStorage` (`devhq.api.token`) and sends it as a bearer token, *in
  addition to* the cookie. The comment there explains why: some browsers refuse
  a `Secure` cookie on plain-`http` origins. Chromium and Firefox treat
  `http://localhost` and `http://127.0.0.1` as secure contexts, so the cookie
  works in local development through the Vite proxy (verified for Wave 1,
  BOARD verification row 11).

> [!NOTE]
> **Planned: Wave 4 (F-SEC, SEC).** F-SEC removes the token header and
> `sessionStorage` copy from `Frontend/src/api/client.ts` so browsers rely on
> the cookie alone. SEC adds `GET/POST /api/tokens` and
> `DELETE /api/tokens/:id`: scoped personal access tokens, hashed at rest,
> shown once, with a mandatory expiry (`Backend/routes/tokens.routes.ts`).

## Consequences

- With cookie-only sessions an XSS bug can still act as the user while the
  page is open, but cannot exfiltrate a reusable credential.
- Cookies are ambient, so CSRF must be handled: the origin guard rejects
  state-changing requests from non-allow-listed origins, bodies must be
  `application/json` (a cross-site HTML form cannot send that without a
  preflight), and the cookie is `SameSite=Strict`.
- The API and the web app must share a site in every environment: the Vite
  proxy in development, the edge in production (`/` → frontend,
  `/api` → backend). Pointing the web app at a different API origin
  (`VITE_API_BASE`) breaks the cookie unless that origin is same-site.
- Step-up rotates the session token (the old one is revoked at once). Cookie
  clients get the new cookie automatically; bearer clients must replace their
  token from the response body (BOARD, Wave 1 note).
- Local development over plain `http` works only on loopback origins. See
  [Troubleshooting](../../getting-started/troubleshooting.md#signed-in-but-every-call-is-401).

## References

- `Backend/middleware/authenticate.ts`, `Backend/routes/auth.routes.ts`,
  `Frontend/src/api/client.ts`, `Frontend/vite.config.ts`
- [Authentication guide](../../api/authentication.md),
  [Sessions](../../concepts/sessions.md)
