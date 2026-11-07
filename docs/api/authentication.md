# Authentication

There are two ways to present a session: the `__Host-devhq_session` cookie
(browsers) and `Authorization: Bearer <token>` (scripts, the backend console).
Both carry the same server-side session; the concepts are in
[Sessions](../concepts/sessions.md).

| | Cookie | Bearer token |
|---|---|---|
| Who | the web app, any browser | backend console, CLIs, smoke tests |
| How you get it | `Set-Cookie` on every successful auth response | the same responses, in the body, **only** if the request sends `X-DevHQ-Client: console` |
| Readable by page script | no (`HttpOnly`) | yes — keep it out of browser storage |
| CSRF exposure | ambient; mitigated by the origin guard, JSON-only bodies and `SameSite=Strict` | none (not sent automatically) |
| Precedence | used when no `Authorization: Bearer` is sent | wins if both are present |

> [!NOTE]
> **Planned: Wave 4 (SEC, F-SEC).** Personal access tokens
> (`GET/POST /api/tokens`, `DELETE /api/tokens/:id`): scoped, hashed at rest,
> shown once, with a required expiry. They replace copying session tokens into
> scripts. Browsers move to the cookie only
> ([ADR 0006](../architecture/adr/0006-cookie-only-browser-sessions.md)).

## Password + second factor (cookie)

```console
$ curl -s -c jar -b jar -X POST http://localhost:8080/api/auth/sign-in \
    -H 'content-type: application/json' -d '{"email":"kofi@techorg.io","password":"devhq-demo"}'
{"next":"totp","methods":["totp"]}
```

The response sets a 10-minute partial-session cookie:

```text
Set-Cookie: __Host-devhq_session=<redacted>; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=600
```

A partial session can see who is signing in, and nothing else:

```console
$ curl -s -b jar http://localhost:8080/api/auth/pending
{"member":{"id":"m4","name":"Kofi Mensah","email":"kofi@techorg.io","role":"Developer","products":["renewberry"],"status":"active","mfa":true,"passkeys":0},"methods":["totp"]}
$ curl -s -b jar http://localhost:8080/api/tasks
{"error":{"code":"mfa_required","message":"Complete MFA to continue","requestId":"cd01b5d3-…"}}
```

Complete the second factor; the session is rotated and the new cookie lasts
for the absolute session lifetime (12 h by default):

```console
$ curl -s -c jar -b jar -X POST http://localhost:8080/api/auth/mfa/totp \
    -H 'content-type: application/json' -d '{"code":"246810"}'
{"ok":true,"member":{"id":"m4","name":"Kofi Mensah",…}}
$ curl -s -b jar 'http://localhost:8080/api/tasks?limit=1'
{"total":7,"limit":1,"offset":0,"items":[{"key":"RB-209",…}]}
```

`246810` works only in demo mode. Otherwise the code comes from the member's
authenticator (the TOTP secret is set from `DEMO_TOTP_SECRET` today; there is
no enrolment route yet).

`methods` lists `passkey` when the member has registered one, and `next` is
then `passkey`: get a challenge from `POST /api/auth/webauthn/options` and
answer it at `POST /api/auth/webauthn/verify`. A passkey can also sign in on
its own, without the password step.

## Bearer token

Send `X-DevHQ-Client: console` on the auth call and the token is in the body
as well:

```console
$ curl -s -X POST http://localhost:8080/api/auth/demo -H 'content-type: application/json' \
    -H 'X-DevHQ-Client: console' -d '{"role":"admin"}'
{"ok":true,"member":{"id":"m1","name":"Amara Okafor",…},"token":"<redacted>","tokenType":"Bearer","expiresIn":43200}
$ curl -s http://localhost:8080/api/auth/session -H "Authorization: Bearer $TOKEN"
```

Rules for bearer clients:

- **Keep the same `User-Agent`** for the life of the token. A different one
  revokes the session (`401 session_context_changed`).
- **Replace the token after step-up and MFA.** Both rotate the session and
  revoke the old token immediately; the new one is in the response body.
- A bearer request has no `Origin`, so the origin guard does not apply; rate
  limits do.

## Demo sign-in

Outside production, `POST /api/auth/demo {"role": "admin" | "pm" | "developer"
| "designer" | "tester" | "operations"}` creates a verified session in one
step. `GET /api/auth/demo-accounts` lists the accounts, password and code. In
production the first returns `404` and the second
`{"enabled":false,"accounts":[]}`.

## Invitations

An invited member activates their account without a session:

1. `GET /api/auth/invite?token=…` shows whose invite it is (name, email, role,
   products, expiry). Invalid or used → `400 invite_invalid`; expired →
   `410 invite_expired`.
2. `POST /api/auth/accept-invite {token, password}` sets the password and
   activates the account. The password must be at least 12 characters with
   upper and lower case, a digit and a symbol, and must not contain the email's
   local part (`422 weak_password` with the reason). The token is single-use.
   No session is returned: the member then signs in normally.

## Ending sessions

| Call | Effect |
|---|---|
| `POST /api/auth/sign-out` | ends this session (works for partial sessions too), clears the cookie, `204` |
| `POST /api/auth/sign-out-everywhere` | revokes all of your sessions, `{"revoked": n}` |
| `DELETE /api/auth/sessions/:sessionPrefix` | revokes one of your sessions by its 8-character handle |

## Status codes you will see

`401` means "authenticate (again)"; `403` means "you are authenticated and
this is not allowed". The codes:

| Code | Meaning | Client action |
|---|---|---|
| `unauthenticated` | no token | sign in |
| `invalid_token`, `session_revoked`, `session_expired`, `session_context_changed`, `account_inactive` | session is gone | sign in again |
| `mfa_required` | partial session on a full route | finish MFA |
| `mfa_invalid` | wrong or replayed code | ask again |
| `step_up_required` | sensitive action needs a fresh verification | `POST /api/auth/step-up`, replace the token, retry |
| `invalid_credentials` | wrong email/password, or unknown passkey | ask again; do not reveal which |
| `locked` | 5 failures, 15 minutes | wait `details.retryAfterSec` |
| `risk_blocked` | location risk ≥ 70 | contact an Owner |

The web app's client maps these centrally (`Frontend/src/api/client.ts`):
`unauthenticated`, `session_revoked`, `session_expired` and `mfa_required`
sign the user out; `step_up_required` opens re-verification.
