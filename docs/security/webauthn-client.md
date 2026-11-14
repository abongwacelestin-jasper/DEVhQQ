# WebAuthn client contract (for F-SEC)

Server: `Backend/auth/webauthn.ts`, routes in `Backend/routes/auth.routes.ts`.
All calls are same-origin `fetch` with `credentials: 'include'` and
`Content-Type: application/json`. **The browser never handles a session
token.** The session lives in the `__Host-devhq_session` HttpOnly cookie and
every successful call below re-issues it with `Set-Cookie`.

## Encoding

Every binary value crosses the wire as **base64url without padding**.

- Request options: decode `challenge`, `user.id`, and each
  `allowCredentials[].id` / `excludeCredentials[].id` into an `ArrayBuffer`
  before you pass them to `navigator.credentials.*`.
- Responses: encode the `ArrayBuffer`s the authenticator returns.
- Do not re-encode `challenge` yourself. The browser copies it into
  `clientDataJSON` and the server compares that copy with the string it
  issued.

## Purposes

| purpose    | when                                                        | session needed                                          | result                                  |
| ---------- | ----------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------- |
| `sign-in`  | passwordless sign-in ("Sign in with a passkey")             | none                                                    | new verified session cookie             |
| `mfa`      | second factor after `POST /api/auth/sign-in` returned `methods` containing `passkey` | the partial (password-stage) session cookie | session promoted to verified (rotated)  |
| `step-up`  | sensitive actions (`X-Step-Up-Required` / `401 step_up_required`) **and lock-screen unlock** | verified session cookie | `verifiedAt` refreshed for 5 min (rotated) |

The server binds each challenge to its purpose. For `mfa` and `step-up` it
also binds the challenge to the member and to the exact session that asked
for it. Challenges are single use, and they expire after 120 s (`timeout`).

## 1. Assertion (sign-in, mfa, step-up, unlock)

### `POST /api/auth/webauthn/options`

Request body: `{ "purpose": "sign-in" | "mfa" | "step-up" }`. The body may be
omitted, which means `sign-in`.

Response `200`:

```json
{
  "challengeId": "base64url",
  "purpose": "step-up",
  "publicKey": {
    "challenge": "base64url",
    "rpId": "tavetahq.io",
    "timeout": 120000,
    "userVerification": "required",
    "allowCredentials": [{ "type": "public-key", "id": "base64url", "transports": ["internal"] }]
  }
}
```

`allowCredentials` is `[]` for `sign-in`. The browser then offers its
discoverable passkeys, so the endpoint never reveals which emails have one.

Errors:

- `401 unauthenticated`: no session for `mfa` or `step-up`.
- `401 mfa_required`: `step-up` was requested on a partial session.
- `409 already_verified`: `mfa` was requested on a verified session.
- `409 no_passkey`: the member has no usable passkey. Fall back to TOTP.
- `429 rate_limited`.

### Browser

```ts
const cred = (await navigator.credentials.get({
  publicKey: {
    challenge: b64uToBuf(o.publicKey.challenge),
    rpId: o.publicKey.rpId,
    timeout: o.publicKey.timeout,
    userVerification: 'required',
    allowCredentials: o.publicKey.allowCredentials.map((c) => ({ ...c, id: b64uToBuf(c.id) })),
  },
  // For lock-screen unlock and step-up, pass an AbortController signal and abort on unmount.
})) as PublicKeyCredential;
const r = cred.response as AuthenticatorAssertionResponse;
```

### `POST /api/auth/webauthn/verify`

```json
{
  "challengeId": "<from options>",
  "credentialId": "<bufToB64u(cred.rawId)>",
  "clientDataJSON": "<bufToB64u(r.clientDataJSON)>",
  "authenticatorData": "<bufToB64u(r.authenticatorData)>",
  "signature": "<bufToB64u(r.signature)>",
  "userHandle": "<bufToB64u(r.userHandle) or omit when null>"
}
```

Unknown fields are rejected with `422`.

Response `200` (plus `Set-Cookie`):

```json
{ "ok": true, "purpose": "step-up", "member": { "id": "m5", "...": "publicMember" }, "verifiedFor": "5m" }
```

`verifiedFor` is present only for `step-up`. After `sign-in` or `mfa`, load
`/api/auth/session` and `/api/me/capabilities` as you would after a TOTP
sign-in.

Errors (`{error:{code}}`):

| status | code                                                                                   | UI                                                        |
| ------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 400    | `challenge_invalid` (expired, reused, or issued to another session)                     | restart from `options`                                    |
| 400    | `client_data_invalid`, `origin_mismatch`, `rp_mismatch`, `user_not_present`, `user_not_verified` | "Passkey check failed", restart                 |
| 401    | `invalid_credentials` (unknown credential or wrong account)                            | "This passkey isn't registered here"                      |
| 401    | `signature_invalid`                                                                    | generic failure                                           |
| 401    | `counter_regressed`                                                                    | "This passkey was suspended (possible copy). Use your authenticator app and remove it." |
| 401    | `credential_suspended`                                                                 | same as above                                             |
| 403    | `risk_blocked`                                                                         | same as the password flow                                 |
| 429    | `rate_limited`                                                                         | honour `Retry-After`                                      |

## 2. Registration (Security Center → "Add a passkey")

Registration needs a verified session and a **step-up within the last 5
minutes**. If you get `401 step_up_required`, run the step-up flow, either
with a passkey as in §1 or with `POST /api/auth/step-up {code}`, and then
retry.

### `POST /api/auth/passkeys/options` (empty body)

Response `200`:

```json
{
  "challengeId": "base64url",
  "purpose": "register",
  "publicKey": {
    "challenge": "base64url",
    "rp": { "id": "tavetahq.io", "name": "TavetaHQ" },
    "user": { "id": "base64url(member id)", "name": "email", "displayName": "name" },
    "pubKeyCredParams": [{ "type": "public-key", "alg": -7 }, { "type": "public-key", "alg": -257 }],
    "timeout": 120000,
    "attestation": "none",
    "authenticatorSelection": { "residentKey": "preferred", "requireResidentKey": false, "userVerification": "required" },
    "excludeCredentials": [{ "type": "public-key", "id": "base64url" }]
  }
}
```

Before calling `navigator.credentials.create`, decode `challenge`, `user.id`
and `excludeCredentials[].id`. Take `rp` from the response. Do **not** use
`window.location.hostname`.

### `POST /api/auth/passkeys`

```json
{
  "challengeId": "<from options>",
  "credentialId": "<bufToB64u(cred.rawId)>",
  "clientDataJSON": "<bufToB64u(r.clientDataJSON)>",
  "authenticatorData": "<bufToB64u(r.getAuthenticatorData())>",
  "publicKey": "<bufToB64u(r.getPublicKey())>",
  "algorithm": "<r.getPublicKeyAlgorithm()>",
  "label": "MacBook Touch ID",
  "transports": "<r.getTransports() — optional; only usb|nfc|ble|internal|hybrid|smart-card>"
}
```

`r` is the `AuthenticatorAttestationResponse`. The server checks that
`publicKey` (SPKI DER) matches the COSE key inside `authenticatorData`, and
that `credentialId` matches the id embedded there. Send exactly what the
browser returned.

- `201 { id, label, createdAt }`.
- `400 challenge_invalid | credential_mismatch | key_mismatch | alg_mismatch | alg_unsupported | auth_data_invalid`.
- `409 exists`.

### `GET /api/auth/passkeys`

Returns
`{ items: [{ id, label, algorithm, createdAt, lastUsedAt|null, suspended }] }`.
Replace the localStorage list in `utils/webauthn.ts` with this. Show
suspended keys with a warning and a Remove button.

### `DELETE /api/auth/passkeys/:credentialId` (step-up)

- `204` on success.
- `404` when the key is unknown.
- `409 last_factor`: in production, the member has no TOTP and is trying to
  remove their last passkey.

## 3. TOTP enrollment (same screen)

- `POST /api/auth/totp/enroll` (step-up, empty body) returns `201 { secret,
  otpauthUri, expiresAt, expiresInSec: 600, replacesExisting }`. Render
  `otpauthUri` as a QR code in the browser and show `secret` for manual entry.
  This is the only time the secret is returned, so don't store it.
- `POST /api/auth/totp/confirm { code }` returns `200 { ok, member }`. Errors:
  - `401 mfa_invalid`: wrong code. The user can retry up to 5 times.
  - `409 enrollment_invalid`, with `details.reason` set to `no_enrollment`,
    `wrong_session` or `too_many_attempts`. Start again.

## 4. Lock screen

When an API call returns header `X-Step-Up-Required: 1`, or `GET
/api/auth/session` returns `stepUpRequired: true` (idle or IP change), show
the lock screen. It offers:

- "Unlock with passkey": §1 with `purpose: "step-up"`.
- "Use authenticator code": `POST /api/auth/step-up { code }`.

Both rotate the cookie. Nothing needs to be stored client-side.
