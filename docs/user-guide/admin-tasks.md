# Admin tasks

Invitations and role changes need Organization `admin` — the Owner — plus a
re-verification within the last 5 minutes. Every action below is audited as
sensitive.

## Invite a member

On **Team & roles** (`/team`) choose **Invite**, then email, optional name,
role (any role except Owner) and at least one product. You can only grant
products you are assigned to (the Owner has all).

The API creates the member in the `invited` state and returns a single-use
link **once**, valid for 7 days:

```console
$ curl -s -b owner -X POST http://localhost:8080/api/team/invites -H 'content-type: application/json' \
    -d '{"email":"ada.lovelace@techorg.io","role":"Developer","products":["blog"]}'
{"id":"m13","name":"Ada Lovelace","email":"ada.lovelace@techorg.io","role":"Developer","products":["blog"],"status":"invited","mfa":true,"passkeys":0,"inviteLink":"/accept-invite?token=<redacted>","inviteExpiresAt":"2026-11-14T00:37:02.764Z"}
```

DevHQ does not send email yet: pass the link to the person through a trusted
channel. Only a SHA-256 of the token is stored, so a lost link cannot be
recovered, and inviting the same email again fails with `409 member_exists`
(see Known gaps below). The invitee opens
`/accept-invite?token=…`, sets a password (12+ characters, mixed case, digit,
symbol, not containing their email name) and then signs in normally.

The invited member already appears in the directory and in scope. (`mfa: true`
in the response above is an artefact of demo mode, where every member is
reported as having MFA.)

Invites are not emailed; the mail transport (`Backend/mail/`) sends password
recovery links and notification digests only.

On first sign-in the invitee must enrol an authenticator; see
[Authentication](../api/authentication.md#first-factor-enrolment).

## Change a role, products or status

Open a member (`/team/:memberId`) and change role or products, or deactivate
them. The API (`PATCH /api/team/:memberId` with any of `role`, `products`,
`status: "active" | "deactivated"`) then **revokes all of that member's
sessions**, so the change applies immediately. The audit entry records the
before and after values and how many sessions were revoked.

Guards: you cannot change your own role (`403 self_demotion`), and the last
active Owner cannot be demoted (`409 last_owner`).

## Access review

The **Access review** panel on the Team page lists:

- **Pending JIT grants** — approve or deny. Approving needs Owner or
  Operations and must not be your own request; denying needs Deployment ≥
  `manage`. Both re-verify first. The same grants, plus active ones with the
  time left and a **Revoke** action, are on **Security** → Production access.
  A grant is what lets a member approve or roll back a production deploy,
  change an incident's severity or resolve a SEV1. See
  [JIT elevation](../concepts/jit-access.md).
- **Active members without a second factor** — follow up with them. There is
  no API to reset someone else's MFA, so the app does not offer one.

## Revoke access / offboard

**Revoke access** on a member deactivates them: the account cannot sign in,
every session ends, and history stays in the audit log. Reactivate with
`status: "active"`.

**Offboarding** is the full leaver flow (`Backend/routes/offboarding.routes.ts`):

1. A member resigns themselves, or an admin (Administration ≥ `manage`) starts
   it: `POST /api/offboarding/:memberId` with last day, reason and handover
   person (step-up).
2. Work the checklist with `PATCH /api/offboarding/:memberId`: open tasks
   reassigned, handover doc written, personal API tokens revoked, trusted
   devices removed, repository and production access removed, NDA exit
   confirmation. The member may only withdraw their own resignation.
3. **Complete** it (another admin; nobody completes their own): the member is
   deactivated, their sessions and JIT grants are revoked, and their personal
   access tokens are revoked through the `member.deactivated` event.

`GET /api/offboarding` lists all of them for Administration ≥ `view`; other members see only their own.

Deactivating directly with `PATCH /api/team/:memberId` revokes sessions, and
tokens stop working at once, but does not revoke JIT grants (open item in
[docs/security/CONTROLS.md](../security/CONTROLS.md#known-gaps--follow-ups)).
Prefer offboarding for leavers.

## Review the audit trail

**Audit log** (`/audit`) and each member's page read `GET /api/audit`. Check
integrity with `GET /api/audit/verify` (backend console: "Integrity check").
See [Audit verification](../operations/audit-verification.md).

## Known gaps

- No way to delete a member or re-issue an invite link; an expired invite
  leaves the member in `invited`.
- No password reset for another member (members reset their own through
  **Forgot password**).
