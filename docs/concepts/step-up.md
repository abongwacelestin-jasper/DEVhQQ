# Step-up verification

Some actions are dangerous enough that being signed in is not sufficient. They
require a **strong verification within the last 5 minutes**: a TOTP code or a
passkey, not just a valid session.

## Which actions

Every route with `requireStepUp()` (`Backend/auth/rbac.ts`), from the
generated [permission matrix](permission-matrix.md#route-guards-requirearea):

| Action | Route |
|---|---|
| Approve a production deployment | `POST /api/deployments/:id/approve` |
| Invite a member | `POST /api/team/invites` |
| Change a member's role, products or status | `PATCH /api/team/:memberId` |
| Request JIT production access | `POST /api/access/grants` |
| Approve a JIT grant | `POST /api/access/grants/:grantId/approve` |
| Revoke or deny a JIT grant | `POST /api/access/grants/:grantId/revoke` |
| Create a backup | `POST /api/backups` |
| Run a restore drill | `POST /api/backups/drill` |

Rolling back a deployment deliberately does **not** need step-up.

## When it is triggered

The session's `verifiedAt` is set when the second factor succeeds (or a
passkey verifies) and is cleared by:

- 15 minutes without a request (`SESSION_IDLE_MS`),
- a change of client IP,

and it goes stale after 5 minutes. So signing in and approving straight away
does not prompt (a fresh MFA counts), but approving from a new network does.
That second case is the control that bites, and it is what the Wave 1 gate
asserts (BOARD finding 5).

## The exchange

Captured against a local API started with `TRUST_PROXY=1` so that
`X-Forwarded-For` can simulate an IP change. The Owner signed in from
`102.89.40.11` (Lagos), then calls from `91.64.120.9` (Berlin):

```console
$ curl -si -X POST http://localhost:8080/api/deployments/d-0BFVpQ/approve \
    -H "Authorization: Bearer $TOKEN" -H 'X-Forwarded-For: 91.64.120.9'
HTTP/1.1 401 Unauthorized
X-Step-Up-Required: 1
{"error":{"code":"step_up_required","message":"Re-verify with your passkey or authenticator to continue","requestId":"3880c7d1-…"}}

$ curl -s -X POST http://localhost:8080/api/auth/step-up -H 'content-type: application/json' \
    -H 'X-DevHQ-Client: console' -H "Authorization: Bearer $TOKEN" -H 'X-Forwarded-For: 91.64.120.9' \
    -d '{"code":"246810"}'
{"ok":true,"verifiedFor":"5m","token":"<redacted>","tokenType":"Bearer","expiresIn":43200}

$ curl -s http://localhost:8080/api/auth/session -H "Authorization: Bearer $TOKEN" …   # the old token
{"error":{"code":"session_revoked","message":"Session ended","requestId":"a2d40732-…"}}

$ curl -s -X POST http://localhost:8080/api/deployments/d-0BFVpQ/approve -H "Authorization: Bearer $NEW_TOKEN" …
{"id":"d-0BFVpQ","product":"blog","env":"production","version":"3.1.0","sha":"9f3c2e1","provider":"GitHub Actions","status":"running","requestedBy":"m11","createdAt":"2026-11-07T00:38:39.175Z","approvedBy":"m1"}
```

Things to notice:

- The error is `401` (re-authenticate), not `403` (not allowed). The header
  `X-Step-Up-Required: 1` is also sent on any authenticated response while the
  session needs step-up, before a sensitive action is attempted.
- **Step-up rotates the session token** and revokes the old one immediately.
  Cookie clients receive the new cookie automatically. Bearer clients must
  take the new token from the response body (it is only in the body when the
  request sends `X-DevHQ-Client: console`).
- Step-up is rate-limited by the tight auth bucket, and a wrong code is
  `401 mfa_invalid`.
- `POST /api/auth/step-up` takes a TOTP code. A passkey can do the same through
  `POST /api/auth/webauthn/options` + `/verify` while signed in: an existing
  session for the same member is re-verified and rotated.

## In the web app

`Frontend/src/api/client.ts` treats `401 step_up_required` (or the header) as
a signal, not a failure: it calls the handler registered by
`ReauthContext`, which opens the re-verification dialog. Pages that start a
sensitive action call `requestReauth({title, description, actionLabel,
onConfirm})` first so the user verifies before the request is sent.

> [!NOTE]
> **Planned: Wave 4 (SEC, F-SEC).** Passkey step-up and lock-screen unlock with
> real WebAuthn; the routes exist today but no member has a passkey unless one
> is registered through `POST /api/auth/passkeys`.
