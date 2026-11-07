# Glossary

Terms as these docs use them. Where the code uses a different word, the code's
identifier is given in brackets.

**Access review** — the list on the Team page of things that need an admin's
decision now: JIT grants waiting for approval and active members without a
second factor (`Frontend/src/components/team/AccessReview.tsx`).

**Approver** — the second person in a two-person rule. For production deploys
it is a member with Deployment ≥ `manage` who is not the requester; for JIT
grants it is an Owner or Operations member who is not the requester.

**Area** [`PermissionArea`] — one of the seven things the permission matrix
grants levels on: Organization, Product, Project, Repository, Deployment,
Infrastructure, Administration. Not to be confused with a **UI area**.

**Audit log** — the append-only, hash-chained record of every state change
(`Backend/audit/auditLog.ts`). Each entry is an **audit entry**.

**Audit entry** — `{seq, at, actor, action, target, sensitive, requestId?,
prevHash, hash}`. `actor` is a member id or `system`.

**Backend console** — the server-rendered operator page at `/console` (alias
`/backend.html`), served by the API itself from `Backend/backend.html`. Not the
same as the **web console** (`/console/*` in the web app).

**Capabilities** — the caller's own row of the matrix plus role, products and
elevations, from `GET /api/me/capabilities`. The web app derives every
permission check from it.

**Bootstrap (first Owner)** — `bootstrap-owner`, the one-shot command that
creates the first Owner on an empty production database and prints an invite
link (`Backend/scripts/bootstrap-owner.ts`).

**Collection** [`Collection`] — the persistence seam in
`Backend/store/collection.ts`: a `Map` read from memory whose writes go
through a driver to PostgreSQL (or nowhere, without `DATABASE_URL`).

**Continuous verification** — re-checking a session on every request (token
signature, idle and absolute lifetime, user agent, IP) instead of trusting it
from sign-in onwards.

**Demo data** — labelled sample payloads (`source: "demo"`) that the GitHub
modules return outside production when GitHub is not configured.

**Demo mode** [`DEMO.enabled`] — on when `NODE_ENV` is not `production` and
`DEMO_DISABLED` is not `1`. Seeds sign-in credentials for the demo members and
accepts the shared demo MFA code for those seeded accounts only.

**Enrolment** — adding a second factor. A member with none enrols a first
authenticator from the partial session (`/api/auth/mfa/enroll`); later
changes go through `/api/auth/totp/*` and `/api/auth/passkeys*`.

**Elevation** — an active JIT grant as it appears on the principal, e.g.
`production:renewberry`.

**Guard** — route-level middleware that can refuse a request:
`authenticate`, `authenticatePartial`, `requireSession`, `requireArea`,
`requireStepUp`, `requireElevation`, `authLimiter`, `accountLimiter`.

**Heuristic** — the rule-based answer an insight falls back to when the ML
service is unavailable or has no model (`source: "heuristic"`).

**JIT grant** [`Grant`] — a request for time-boxed production access to one
product, with a reason, approved by a second person, expiring automatically
(`Backend/auth/jit.ts`). States: `pending`, `active`, `expired`, `revoked`,
`denied`.

**Level** [`PermissionLevel`] — `none` < `view` < `contribute` < `manage` <
`admin`.

**Member** — a person with an account. Statuses: `active`, `invited`,
`deactivated`. Ids look like `m4`.

**Model card** — the description of a model's purpose, features, metrics and
limits, in [Models/README.md](../Models/README.md#model-cards).

**Object Lock (WORM)** — S3 retention that prevents deleting or overwriting an
object before it expires; used for the backups and audit buckets.

**Partial session** — a session that has passed the password step but not the
second factor (`stage: 'password'`). It can only reach the routes marked
`partial` in the [API reference](api/reference.md).

**Permission matrix** [`permissionMatrix`] — role × area → level, in
`Backend/auth/rbac.ts`. Rendered in [the matrix page](concepts/permission-matrix.md).

**Personal access token (PAT)** — `dhq_pat_…`, a scoped, expiring credential
for scripts and CI; its level in each area is the lower of its scope and the
member's role; it never passes step-up.

**Principal** — the authenticated caller attached to a request:
`{memberId, role, products, sessionId, verifiedAt, elevations}`; for a PAT the
`sessionId` is `pat:<id>`.

**Product** [`ProductId`] — one of `renewberry` (RenewBerry, task prefix `RB`),
`blog` (Blog, `BL`) and `mirror` (Mirror Acture, `MA`). The top level of scope.

**Project** — a piece of work inside one product, e.g. `p1` "Payments v2".
Tasks and docs belong to a project.

**Request id** — a UUID per request, returned in `X-Request-Id` and in every
error body, and written to logs and audit entries. A client may supply its own
(up to 64 characters) in `X-Request-Id`.

**Risk score** — 0–100 from the location risk engine (`Backend/lib/geo.ts`);
≥ 70 blocks a sign-in, 40–69 forces a challenge.

**Role** [`RoleName`] — one of Owner, Project manager, Developer, Designer,
Tester, Operations. The web app calls the Owner role "Admin" on its demo
buttons.

**Scope** — the set of products a member is assigned to. Everything outside it
answers `404`. The Owner's scope is every product.

**Seed data** — the demo dataset loaded by `seed()` in `Backend/store/db.ts`
outside production when the database is empty. `Frontend/src/data/` now holds
presentation data only (labels, catalogues).

**Session** — server-side record of a sign-in, referenced by an HMAC-signed
token. Delivered to browsers as the `__Host-devhq_session` cookie.

**Step-up** — a fresh strong verification (passkey or TOTP code) required
within the last 5 minutes for sensitive actions. Returns a rotated session
token.

**Stream** — `GET /api/stream`, the per-subscriber realtime feed for
messaging and notifications; distinct from the console's `GET /api/_events`.

**Synthetic model** — a model trained on generated cold-start data
(`trainedOn: "synthetic"`); advisory only.

**Two-person rule** — the requester of a production deploy or a JIT grant can
never be its approver.

**UI area** [`Area` in `Frontend/src/data/roles.ts`] — a page group in the web
app (`my-work`, `deployments`, `audit`, …). Each maps to one server area or to
none.

**Wave** — a delivery increment tracked in `docs/agents/BOARD.md`. Waves 0–2
are accepted; Wave 3 was folded into Wave 4; Wave 4's ten build lanes are
merged.
