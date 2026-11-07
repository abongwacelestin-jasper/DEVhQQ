# Email

DevHQ sends transactional email: invitations, password and sign-in security
notices, and work notifications (tasks, incidents, deployments, access
requests, offboarding, the digest). Production email goes through
[Resend](https://resend.com) over its HTTPS API. Every message uses one
branded, hand-written layout with a matching plain-text part.

- Code: `Backend/mail/` (transport, layout, templates, event wiring) and
  `Backend/config/mail.ts` (configuration and validation).
- Preview every email locally: `npm run mail:preview` in `Backend/`
  (see [Previewing](#previewing)).

## Transports

| `MAIL_TRANSPORT` | Use | Behaviour |
|---|---|---|
| `console` (default) | development, tests | Logs a redacted copy (tokens in links replaced, recipient masked). Nothing is sent. |
| `resend` | production | `POST https://api.resend.com/emails` with `Authorization: Bearer RESEND_API_KEY`, native `fetch`, no SDK. |
| `smtp` | self-hosted relay | The existing dependency-free SMTP client (TLS required). |

The Resend transport (`Backend/mail/resend.ts`):

- **Timeout:** each attempt is aborted after `RESEND_TIMEOUT_MS` (10 s).
- **One retry**, only when it can help: HTTP `429`, any `5xx`, a timeout or
  a network error. A `429` waits for `Retry-After` (seconds or HTTP date) when
  it is 10 s or less; a longer wait fails the send instead of retrying into
  the same limit. Other `4xx` responses (bad key, unverified domain,
  validation) are never retried.
- **Idempotency:** every message carries an `Idempotency-Key` header, the
  same on both attempts, so a retry after a lost response cannot deliver the
  email twice. Event emails derive the key from the event (for example
  `sign-in-alert/<sign-in id>`), so a double call is also deduplicated by
  Resend (keys are kept for 24 hours).
- **Tags:** each message is tagged `category=<type>` (for example
  `sign-in-alert`, `invite`, `digest`) and `app=devhq`, so the Resend
  dashboard can filter volume, bounces and complaints per email type.
- **Logs** show the masked recipient (`k***@example.com`), category, status
  and Resend message id, never the key or the message body.
- `sendMail` never throws. A failed send is logged as `mail delivery failed`
  and the request that triggered it is unaffected (password recovery in
  particular keeps the same response and timing).

### Production fails closed

With `NODE_ENV=production` the backend refuses to start when:

- `MAIL_TRANSPORT=resend` and neither `RESEND_API_KEY` nor
  `RESEND_API_KEY_FILE` holds a key (an empty secret file counts as unset),
- `MAIL_TRANSPORT=resend` and `MAIL_FROM` is unset,
- `MAIL_TRANSPORT` is not `console`, `smtp` or `resend`,
- `MAIL_FROM` or `MAIL_REPLY_TO` is not a valid single address, or contains a
  line break,
- `APP_URL`, `BRAND_LOGO_URL` or `BRAND_WEBSITE_URL` is set to anything but an
  `https://` URL, or a brand colour is not a hex colour.

Outside production, `resend` without a key falls back to `console` with a
warning, so development and the test suites never need a provider.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `MAIL_TRANSPORT` | `console` | `console`, `resend` or `smtp`. |
| `MAIL_FROM` | `<BRAND_NAME> <no-reply@<app host>>` | Required for `resend` in production, e.g. `DevHQ <no-reply@mail.example.com>`. Its domain must be verified in Resend. |
| `MAIL_REPLY_TO` | unset | Optional single address, usually the support inbox. |
| `RESEND_API_KEY` | unset | Secret. In containers pass `RESEND_API_KEY_FILE=/run/secrets/resend_api_key` instead; the entrypoint and the app both read `*_FILE`, and setting both is refused. |
| `RESEND_TIMEOUT_MS` | `10000` | Per attempt. |
| `RESEND_BASE_URL` | `https://api.resend.com` | Only for a test double. |
| `APP_URL` | `APP_ORIGIN` | Base of every link in an email. |
| `MAIL_DIGEST_MINUTES` | unset (off) | Unread-notification digest interval. `1440` sends a daily summary, `10080` a weekly one. |

### Brand variables

Every email reads its branding from the environment, so a rebrand is a
configuration change. Defaults keep development working.

| Variable | Default | Used for |
|---|---|---|
| `BRAND_NAME` | `DevHQ` | Subjects, headings and copy ("Reset your DevHQ password"). |
| `BRAND_LEGAL_NAME` | `BRAND_NAME` | Footer, e.g. `DevHQ Technologies Ltd`. |
| `BRAND_LOGO_URL` | unset → text wordmark | Absolute `https://` URL of a PNG (or SVG). Use a PNG: Gmail and Outlook do not display SVG. Export it at twice the display width for sharp rendering. |
| `BRAND_LOGO_WIDTH` | `120` | Display width in pixels; height scales. |
| `BRAND_PRIMARY_COLOR` | `#4f46e5` | Buttons and the top rule. Button text is white or near-black, whichever contrasts better. |
| `BRAND_ACCENT_COLOR` | `#0e7490` | Links and highlights (lightened automatically in dark mode). |
| `BRAND_SUPPORT_EMAIL` | `support@<app host>` | "Questions? Contact …" in every footer. |
| `BRAND_POSTAL_ADDRESS` | unset | Physical address in the footer. Set it before going live: anti-spam law (CAN-SPAM, PECR) and mailbox providers expect one; a warning is logged in production while it is missing. |
| `BRAND_WEBSITE_URL` | `APP_URL` | Logo link and the footer link. |

The logo sits on a small white panel so a dark logo stays visible when a mail
client switches to dark mode; a transparent PNG with dark artwork is fine.

## Setting up Resend

### 1. Choose a sending subdomain

Send from a subdomain such as `mail.example.com`, not the root domain. It
keeps the sending reputation of product email separate from people's own
mail on `example.com`, and lets you change providers without touching the
root domain's records. `MAIL_FROM` then becomes
`DevHQ <no-reply@mail.example.com>`.

### 2. Add and verify the domain

In the Resend dashboard, **Domains → Add domain**, enter `mail.example.com`
and pick the region closest to your users. Resend shows the exact DNS records
to create; copy the values from the dashboard (they are unique to your
account). They are of this shape:

| Purpose | Type | Name (host) | Value |
|---|---|---|---|
| DKIM | `TXT` | `resend._domainkey.mail` | `p=MIGfMA0…` (public key from the dashboard) |
| SPF (return path) | `TXT` | `send.mail` | `v=spf1 include:amazonses.com ~all` |
| Bounce handling (return path) | `MX` | `send.mail` | `feedback-smtp.<region>.amazonses.com`, priority `10` |
| DMARC | `TXT` | `_dmarc` (on `example.com`) | `v=DMARC1; p=none; rua=mailto:dmarc@example.com` |

- **SPF** authorises Resend's servers to send for the return-path
  subdomain. It does not change the SPF record of your root domain.
- **DKIM** signs every message; with the `From` on `mail.example.com` this is
  what makes DMARC pass (aligned DKIM).
- **DMARC** tells receivers what to do with mail that fails. Start with
  `p=none` and a `rua` report address, read the reports for two to four
  weeks, then move to `p=quarantine` and finally `p=reject` once only
  legitimate sources appear. Gmail and Yahoo require a DMARC record for
  bulk senders.

Click **Verify**. DNS can take minutes to hours; the domain must show
**Verified** before production sends will succeed (an unverified domain is a
`403` that DevHQ logs and does not retry).

### 3. Create an API key

**API Keys → Create**, permission **Sending access**, restricted to the
`mail.example.com` domain. Store it as the `resend_api_key` secret file
(Compose: `make secrets`, then paste the key into that file) or as
`RESEND_API_KEY` in the platform's secret store. Never commit it.

### 4. Configure and start

```bash
NODE_ENV=production
MAIL_TRANSPORT=resend
MAIL_FROM="DevHQ <no-reply@mail.example.com>"
MAIL_REPLY_TO=support@example.com
RESEND_API_KEY_FILE=/run/secrets/resend_api_key
APP_URL=https://app.example.com
BRAND_LEGAL_NAME="DevHQ Technologies Ltd"
BRAND_LOGO_URL=https://example.com/email/logo.png
BRAND_POSTAL_ADDRESS="1 Example Street, Example City, EX 00000"
BRAND_SUPPORT_EMAIL=support@example.com
BRAND_WEBSITE_URL=https://example.com
```

`GET /api/_config` (signed in) shows `mail.transport`, the sender and
`RESEND_API_KEY: set`. Trigger a password reset for your own account to
confirm delivery, and check the message in Resend's **Emails** view.

### Warm-up

A new sending domain has no reputation. DevHQ sends only transactional mail,
which warms up naturally, but avoid a sudden spike:

- Go live with real users first, not a bulk invite of the whole company;
  invite in batches of a few dozen per day in the first week.
- Keep the digest off (`MAIL_DIGEST_MINUTES` unset) or daily for the first
  two weeks, then enable it for everyone.
- Watch the bounce and complaint rates in Resend daily during that period.

### Bounces and complaints

- Resend suppresses an address after a hard bounce or a spam complaint and
  rejects further sends to it; DevHQ logs those as `mail delivery failed`
  without retrying.
- Targets: bounce rate under 4 %, complaint rate under 0.1 % (Gmail and Yahoo
  start filtering at 0.3 %). Use the `category` tag to see which email type
  causes them.
- A bounce on an invitation usually means a typo in the address: revoke the
  invite and send a new one. A suppressed member address can be removed from
  the suppression list in Resend once it is fixed.
- Optional: point a Resend webhook (`email.bounced`, `email.complained`) at
  your monitoring or ticketing system. DevHQ does not consume these webhooks
  yet.

## Emails and where they are sent

Security notices are always sent; preferences cannot turn them off. Work
notifications respect the member's alert choices from onboarding
(`assigned`, `review`, `deploys`, `incidents`); a member with no profile yet
gets all of them. A notification that was emailed immediately is marked so
the digest does not send it again.

| Email | Category | Recipient | Triggered in | Preference |
|---|---|---|---|---|
| Invitation | `invite` | invitee | `POST /api/team/invites` (`Backend/routes/team.routes.ts`) | always |
| Password reset | `password-reset` | member | `POST /api/auth/recovery/request` (`Backend/routes/recovery.routes.ts`) | always |
| Password changed | `password-changed` | member | `POST /api/auth/recovery/reset`; the change-password route should call `sendPasswordChanged` | always |
| New sign-in | `sign-in-alert` | member | every successful sign-in from an IP or device the member has not used before (`recordSignIn` in `Backend/routes/auth.routes.ts`); the very first sign-in has nothing to compare with and sends none | always |
| Authenticator or passkey added, authenticator replaced | `mfa-enrolled` | member | TOTP enrol/confirm and passkey registration (`Backend/routes/auth.routes.ts`) | always |
| Backup codes generated | `backup-codes-generated` | member | `POST /api/auth/backup-codes` (the codes are never emailed) | always |
| Backup code used | `backup-code-used` | member | `POST /api/auth/mfa/backup`, with the remaining count | always |
| Account locked | `account-locked` | member | fifth consecutive failed password (`POST /api/auth/sign-in`) | always |
| Access request | `access-request` | members with Administration:manage | `POST /api/access/requests`, via `notify()` | always |
| Task assigned, review requested | `task-assigned` | assignee or reviewer | task create/update, via `notify()` (`Backend/domain/collab/notify.ts`) | `assigned` / `review` |
| Incident declared | `incident` | owner (and, for SEV1, members who chose incident alerts on that product) | `POST /api/incidents` and monitor auto-open, observed on the event bus | `incidents` |
| Deployment awaiting approval | `deployment-approval` | members who can approve that product | deployment `awaiting-approval`, via `notify()` | `deploys` |
| Offboarding started | `offboarding-started` | the departing member; the handover contact | `POST /api/offboarding/:memberId` | always / `assigned` |
| Offboarding completed | `offboarding-completed` | the departed member | offboarding completion | always |
| Digest | `digest` | members with unread notifications | `MAIL_DIGEST_MINUTES` timer | per notification kind |

All wiring lives in `Backend/mail/events.ts`; each route makes one call next
to its `audit.append`. New events follow the same pattern: add a template in
`Backend/mail/templates.ts`, a sample in `Backend/mail/samples.ts`, and a
`send…` function in `events.ts`.

**Change-password route.** `POST /api/auth/password` (account settings) must
call, right after it stores the new hash:

```ts
import { sendPasswordChanged } from '../mail/events.ts';
void sendPasswordChanged(member, ctx, { sessionsSignedOut: true /* if it revoked other sessions */ });
```

## Layout and templates

One layout (`Backend/mail/layout.ts`) renders every email from a list of
content blocks (paragraph, button, facts table, notice, list), once as HTML
and once as plain text, so the two parts always say the same thing.

- Table layout, 600 px wide, inline styles; tested patterns for Gmail,
  Outlook (Windows Outlook gets MSO-conditional tables and VML buttons),
  Apple Mail and iOS Mail.
- `color-scheme: light dark` with dark-mode overrides, a hidden preheader,
  and a footer with the reason for the email, the support contact, the legal
  name, the postal address and, for notifications, a link to notification
  settings.
- No external CSS, no JavaScript, no images other than the logo.
- Every interpolated value is HTML-escaped; links must be absolute `https`
  (or `http` in development) or `mailto:` URLs and are built only from
  `APP_URL`, never from request headers. A relative or `javascript:` link
  fails rendering instead of reaching a recipient.

Copy is calm and specific: what happened, when, from where, and what to do
if it was not the recipient. No exclamation marks; the template tests
enforce it.

## Previewing

```bash
cd Backend
npm run mail:preview                          # writes .mail-preview/ in Backend
npm run mail:preview -- --out /tmp/devhq-mail # or any folder
```

Every template is written with realistic sample data as `<name>.html` and
`<name>.txt`, plus an `index.html` linking them all. Open `index.html` in a
browser. The preview uses the `BRAND_*` and `APP_URL` variables from the
environment, so you can review real branding before going live:

```bash
BRAND_NAME="Acme" BRAND_LOGO_URL=https://acme.example/logo.png \
BRAND_PRIMARY_COLOR=#0f766e npm run mail:preview
```

When `BRAND_POSTAL_ADDRESS` is unset the preview fills in a sample address so
the footer can be reviewed. Nothing is sent. For a check in real clients,
send yourself a reset email from a staging deployment and view it in Gmail
(web and mobile), Outlook for Windows and Apple Mail, in light and dark mode.

## Troubleshooting

| Log line | Meaning |
|---|---|
| `mail config: MAIL_TRANSPORT=resend but RESEND_API_KEY is unset — using console transport` | Development only; production refuses to boot instead. |
| `mail delivery failed … Resend: 403 validation_error` | The `MAIL_FROM` domain is not verified in Resend, or the key is restricted to another domain. |
| `mail delivery failed … Resend: 401` | Wrong or revoked API key. |
| `mail: Resend attempt failed, retrying once` | A `429`/`5xx`/timeout; the retry used the same idempotency key. |
| `mail delivery failed … Resend: 429` with no retry | `Retry-After` was longer than 10 s: the account's rate limit is exhausted. |
