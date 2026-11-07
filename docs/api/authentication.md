# Authentication

Three credentials reach the API:

| | Session cookie | CLI session token | Personal access token (PAT) |
|---|---|---|---|
| Who | the web app and the backend console (browsers) | interactive command-line sign-in | scripts, CI, metrics scrapers |
| Sent as | `__Host-devhq_session` cookie | `Authorization: Bearer <token>` | `Authorization: Bearer dhq_pat_<id>_<secret>` |
| How you get it | `Set-Cookie` on every successful auth response | the same responses, in the JSON body, only when the request sends `X-DevHQ-Client: cli` **and** has no `Origin` and no `Sec-Fetch-Site` header (so a browser can never ask for it) | `POST /api/tokens` from an interactive session, after step-up; shown once |
| Readable by page script | no (`HttpOnly`) | n/a | n/a |
| Lifetime | idle 15 min (then step-up), absolute 12 h | same as the session | 1–90 days, chosen at creation |
| Step-up | yes | yes (replace the token after each rotation) | **never** (`403 step_up_unavailable`) |
| Authority | the member's role and products | the same | scopes you choose, intersected with your role on every request |

Bearer wins if both a cookie and an `Authorization` header are sent. The
design is in [ADR 0006](../architecture/adr/0006-cookie-only-browser-sessions.md);
the browser-side WebAuthn and TOTP contract is in
[docs/security/webauthn-client.md](../security/webauthn-client.md).

## Password + second factor

```console
$ curl -s -c jar -b jar -X POST http://localhost:8080/api/auth/sign-in \
    -H 'content-type: application/json' -d '{"email":"kofi@techorg.io","password":"devhq-demo"}'
{"next":"totp","methods":["totp"],"enrollRequired":false}
```

The response sets a 10-minute **partial** session cookie
(`__Host-devhq_session=<redacted>; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=600`).
A partial session can only see who is signing in and finish the second factor:

```console
$ curl -s -b jar http://localhost:8080/api/tasks
{"error":{"code":"mfa_required","message":"Complete MFA to continue","requestId":"cd01b5d3-…"}}
$ curl -s -c jar -b jar -X POST http://localhost:8080/api/auth/mfa/totp \
    -H 'content-type: application/json' -d '{"code":"246810"}'
{"ok":true,"member":{"id":"m4","name":"Kofi Mensah",…}}
```

The session is rotated (new token, old one revoked) and now lasts for the
absolute lifetime. `next` / `methods` say which factors the member has:
`passkey` (then get a challenge from `POST /api/auth/webauthn/options` and
answer it at `POST /api/auth/webauthn/verify`) and/or `totp`.

The demo code `246810` is accepted only in demo mode and only for the seeded
demo accounts that have no factor of their own. Every real member must use
their own authenticator or passkey.

## First-factor enrolment

A member who has no second factor yet (a newly invited member, the
bootstrapped first Owner) gets `enrollRequired`:

```console
$ curl -s -c new -b new -X POST http://localhost:8080/api/auth/sign-in -H 'content-type: application/json' \
    -d '{"email":"ada.lovelace@techorg.io","password":"Correct-Horse-42"}'
{"next":"enroll","methods":[],"enrollRequired":true}
$ curl -s -c new -b new -X POST http://localhost:8080/api/auth/mfa/totp -H 'content-type: application/json' -d '{"code":"246810"}'
{"error":{"code":"mfa_invalid","message":"Code is incorrect or expired","requestId":"50fb7238-…"}}
$ curl -s -c new -b new -X POST http://localhost:8080/api/auth/mfa/enroll
{"secret":"<redacted>","otpauthUri":"otpauth://totp/DevHQ%3Aada.lovelace%40techorg.io?secret=<redacted>&issuer=DevHQ&algorithm=SHA1&digits=6&period=30","expiresAt":"2026-11-07T05:50:21.374Z","expiresInSec":600}
$ curl -s -c new -b new -X POST http://localhost:8080/api/auth/mfa/enroll/confirm -H 'content-type: application/json' -d '{"code":"<from the app>"}'
{"ok":true,"member":{"id":"m13","name":"Ada Lovelace",…}}
```

The secret is sealed with `DATA_ENCRYPTION_KEY` before it is stored. Enrolment
is refused (`409 factor_exists`) for anyone who already has a factor. The web
app's Verify screen runs this flow (`Frontend/src/pages/auth/Verify.tsx` with
`components/security/TotpEnrollment.tsx`); see also
[Deployment and first run](../operations/deployment.md#first-run-production-setup).

## Managing factors (signed in)

| Action | Route | Notes |
|---|---|---|
| Add or replace an authenticator | `POST /api/auth/totp/enroll` (step-up) → `POST /api/auth/totp/confirm {code}` | secret returned once; 5 attempts |
| List passkeys | `GET /api/auth/passkeys` | |
| Register a passkey | `POST /api/auth/passkeys/options` (step-up) → `POST /api/auth/passkeys` | real WebAuthn verification (ES256, EdDSA, RS256) |
| Remove a passkey | `DELETE /api/auth/passkeys/:credentialId` (step-up) | in production you cannot remove your last factor |

## CLI session token

```console
$ curl -s -X POST http://localhost:8080/api/auth/sign-in -H 'content-type: application/json' \
    -H 'X-DevHQ-Client: cli' -d '{"email":"…","password":"…"}'
{"next":"totp","methods":["totp"],"enrollRequired":false,"token":"<redacted>","tokenType":"Bearer","expiresIn":600}
```

Keep the same `User-Agent` for the token's life (a different one revokes the
session with `401 session_context_changed`), and replace the token with the
one returned by MFA and every step-up. For anything unattended, use a PAT.

## Personal access tokens

```console
$ curl -s -b new -X POST http://localhost:8080/api/tokens -H 'content-type: application/json' \
    -d '{"name":"ci","scopes":["project:view"],"expiresInDays":7}'
{"id":"58436856c311e4cc","name":"ci","prefix":"dhq_pat_58436856c311e4cc","scopes":["project:view"],"createdAt":"2026-11-07T05:40:23.817Z","expiresAt":"2026-11-14T05:40:23.817Z","lastUsedAt":null,"status":"active","revokedAt":null,"revokedReason":null,"token":"dhq_pat_<redacted>"}

$ curl -s 'http://localhost:8080/api/tasks?limit=1' -H "Authorization: Bearer $PAT"
{"total":5,"limit":1,"offset":0,"items":[{"key":"BL-17",…}]}
$ curl -s -X POST http://localhost:8080/api/tasks -H 'content-type: application/json' -H "Authorization: Bearer $PAT" -d '{}'
{"error":{"code":"forbidden","message":"Requires contribute on Project","requestId":"4f8d82e8-…"}}
$ curl -s -X POST http://localhost:8080/api/tokens -H 'content-type: application/json' -H "Authorization: Bearer $PAT" -d '{…}'
{"error":{"code":"session_required","message":"This action needs an interactive session","requestId":"d8376b37-…"}}
```

- **Format** `dhq_pat_<16 hex id>_<43-char secret>`; the fixed prefix lets
  secret scanners find leaked tokens. Only a SHA-256 of the token is stored.
- **Scopes** are `<area>:<level>` strings (`project:view`,
  `deployment:contribute`, …), at most one per area, never above your role.
  On each request the token's level in an area is the lower of its scope and
  your **current** role, so a role change narrows existing tokens at once.
- **Limits**: expiry 1–90 days (required), at most 20 active tokens per member.
- **Never** usable for step-up, for managing tokens or credentials, or for a
  partial session. A token stops working the moment its member is deactivated.
- `GET /api/tokens` lists yours (never the secret); `DELETE /api/tokens/:id`
  revokes one (Administration ≥ `admin` may revoke anyone's).

## Demo sign-in

Outside production, `POST /api/auth/demo {"role": "admin" | "pm" | "developer"
| "designer" | "tester" | "operations"}` creates a verified session in one
step, and `GET /api/auth/demo-accounts` lists the accounts. In production the
first answers `404` and the second `{"enabled":false,"accounts":[]}`.

## Invitations and recovery

- `GET /api/auth/invite?token=…` previews an invite (`400 invite_invalid`,
  `410 invite_expired`); `POST /api/auth/accept-invite {token, password}` sets
  the password and activates the account. No session is returned.
- `POST /api/auth/recovery/request {email}` always answers `202` with the same
  body and timing whether or not the account exists, and emails a
  single-use, 30-minute link built from `APP_ORIGIN`.
  `POST /api/auth/recovery/reset {token, password}` applies the password
  policy, clears any lockout and **revokes every session** of the account.

Password policy (invite, reset): at least 12 characters, upper and lower case,
a digit, a symbol, and not the name part of the email (`422 weak_password`).

## Ending sessions

| Call | Effect |
|---|---|
| `POST /api/auth/sign-out` | ends this session (partial sessions too), clears the cookie, `204` |
| `POST /api/auth/sign-out-everywhere` | revokes all of your sessions, `{"revoked": n}` |
| `DELETE /api/auth/sessions/:sessionPrefix` | revokes one of your sessions by its 8-character handle |

## Status codes you will see

`401` means "authenticate (again)"; `403` means "authenticated, and this is
not allowed".

| Code | Meaning | Client action |
|---|---|---|
| `unauthenticated` | no credential | sign in |
| `invalid_token`, `session_revoked`, `session_expired`, `session_context_changed`, `account_inactive` | session is gone | sign in again |
| `mfa_required` | partial session on a full route | finish MFA or enrol |
| `mfa_invalid` | wrong or replayed code | ask again |
| `step_up_required` | sensitive action needs a fresh verification | step-up (passkey or code), retry |
| `step_up_unavailable`, `session_required` | a PAT was used where a person must be present | use an interactive session |
| `invalid_credentials` | wrong email/password, or unknown passkey | ask again; do not reveal which |
| `locked` | 5 failures, 15 minutes | wait `details.retryAfterSec` |
| `risk_blocked` | location risk ≥ 70 | contact an Owner |

The web app's client (`Frontend/src/api/client.ts`) uses the cookie only
(`credentials: 'same-origin'`), signs the user out on a dead session and opens
re-verification on `step_up_required`.
