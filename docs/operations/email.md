# Email

TavetaHQ sends transactional email: invitations, password and sign-in security
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
- `APP_URL`, `BRAND_LOGO_URL`, `BRAND_WEBSITE_URL` or `BRAND_ASSET_BASE_URL`
  is set to anything but an `https://` URL, or a brand colour is not a hex
  colour.

Outside production, `resend` without a key falls back to `console` with a
warning, so development and the test suites never need a provider.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `MAIL_TRANSPORT` | `console` | `console`, `resend` or `smtp`. |
| `MAIL_FROM` | `<BRAND_NAME> <no-reply@<registrable domain>>` | Required for `resend` in production, e.g. `TavetaHQ <no-reply@mail.example.com>`, because its domain must be verified in Resend. The default serves `console` and `smtp`. |
| `MAIL_REPLY_TO` | the support address | Single address that replies go to. |
| `RESEND_API_KEY` | unset | Secret. In containers pass `RESEND_API_KEY_FILE=/run/secrets/resend_api_key` instead; the entrypoint and the app both read `*_FILE`, and setting both is refused. |
| `RESEND_TIMEOUT_MS` | `10000` | Per attempt. |
| `RESEND_BASE_URL` | `https://api.resend.com` | Only for a test double. |
| `APP_URL` | `APP_ORIGIN` | Base of every link in an email. |
| `MAIL_DIGEST_MINUTES` | unset (off) | Unread-notification digest interval. `1440` sends a daily summary, `10080` a weekly one. |

### Brand variables

Every email reads its branding from the environment, so a rebrand is a
configuration change. **Every brand variable is optional**: unset values are
derived from the app's own address (`APP_URL`, else `APP_ORIGIN`), so emails
look complete with no `BRAND_*` configuration at all. The *registrable
domain* is the app host without its subdomains (`app.example.com` →
`example.com`, `app.example.co.uk` → `example.co.uk`; a short list of
two-part suffixes and hosting platforms such as `up.railway.app` is
recognised). Localhost and IP addresses map to `devhq.local`, which can never
receive mail.

| Variable | Default | Used for |
|---|---|---|
| `BRAND_NAME` | `TavetaHQ` | Subjects, headings, copy and the footer link "Open TavetaHQ". |
| `BRAND_LEGAL_NAME` | `BRAND_NAME` (so `TavetaHQ`) | Footer, e.g. `TavetaHQ Technologies Ltd`. |
| `BRAND_LOGO_URL` | `<app origin>/brand/tavetahq-email-logo.png` | Absolute URL of a PNG (or SVG). Use a PNG: Gmail and Outlook do not display SVG. Export it at twice the display width. |
| `BRAND_LOGO_WIDTH` | `168` | Display width in pixels; height scales. |
| `BRAND_ASSET_BASE_URL` | `<app origin>/brand` | Where the email images live: heroes and product marks are `<base>/email/<file>` ([Brand](brand.md#email-imagery)). Set it only when they are served from a CDN. |
| `BRAND_PRIMARY_COLOR` | `#4f46e5` | Buttons and the eyebrow dot. Button text is white or near-black, whichever contrasts better. |
| `BRAND_ACCENT_COLOR` | `#3730a3` | Links and highlights (lightened automatically in dark mode). |
| `BRAND_SUPPORT_EMAIL` | `support@<registrable domain>` | "Help" and "Questions? Contact …" in every footer, and the default reply-to. |
| `BRAND_POSTAL_ADDRESS` | unset (line omitted) | Physical address in the footer. **Never derived or invented**: it is a legal statement, so it must be a real address the company controls. While it is unset the footer omits the line cleanly (in production and in previews) and production logs a warning. Set it before going live: anti-spam law (CAN-SPAM, PECR) and mailbox providers expect one. |
| `BRAND_WEBSITE_URL` | the app origin | Logo link and the footer link. |

The logo sits on a small white panel so a dark logo stays visible when a mail
client switches to dark mode; a transparent PNG with dark artwork is fine.

## Setting up Resend

### 1. Choose a sending subdomain

Send from a subdomain such as `mail.example.com`, not the root domain. It
keeps the sending reputation of product email separate from people's own
mail on `example.com`, and lets you change providers without touching the
root domain's records. `MAIL_FROM` then becomes
`TavetaHQ <no-reply@mail.example.com>`.

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
`403` that TavetaHQ logs and does not retry).

### 3. Create an API key

**API Keys → Create**, permission **Sending access**, restricted to the
`mail.example.com` domain. Store it as the `resend_api_key` secret file
(Compose: `make secrets`, then paste the key into that file) or as
`RESEND_API_KEY` in the platform's secret store. Never commit it.

### 4. Configure and start

```bash
NODE_ENV=production
MAIL_TRANSPORT=resend
MAIL_FROM="TavetaHQ <no-reply@mail.example.com>"
MAIL_REPLY_TO=support@example.com
RESEND_API_KEY_FILE=/run/secrets/resend_api_key
APP_URL=https://app.example.com
BRAND_LEGAL_NAME="TavetaHQ Technologies Ltd"
BRAND_LOGO_URL=https://example.com/email/logo.png
BRAND_POSTAL_ADDRESS="1 Example Street, Example City, EX 00000"
BRAND_SUPPORT_EMAIL=support@example.com
BRAND_WEBSITE_URL=https://example.com
```

`GET /api/_config` (signed in) shows `mail.transport`, the sender and
`RESEND_API_KEY: set`. Trigger a password reset for your own account to
confirm delivery, and check the message in Resend's **Emails** view.

### Warm-up

A new sending domain has no reputation. TavetaHQ sends only transactional mail,
which warms up naturally, but avoid a sudden spike:

- Go live with real users first, not a bulk invite of the whole company;
  invite in batches of a few dozen per day in the first week.
- Keep the digest off (`MAIL_DIGEST_MINUTES` unset) or daily for the first
  two weeks, then enable it for everyone.
- Watch the bounce and complaint rates in Resend daily during that period.

### Bounces and complaints

- Resend suppresses an address after a hard bounce or a spam complaint and
  rejects further sends to it; TavetaHQ logs those as `mail delivery failed`
  without retrying.
- Targets: bounce rate under 4 %, complaint rate under 0.1 % (Gmail and Yahoo
  start filtering at 0.3 %). Use the `category` tag to see which email type
  causes them.
- A bounce on an invitation usually means a typo in the address: revoke the
  invite and send a new one. A suppressed member address can be removed from
  the suppression list in Resend once it is fixed.
- Optional: point a Resend webhook (`email.bounced`, `email.complained`) at
  your monitoring or ticketing system. TavetaHQ does not consume these webhooks
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
content blocks (paragraph, button with an optional secondary link, facts
panel, item card, notice, grouped list), once as HTML and once as plain text,
so the two parts always say the same thing.

- Table layout, 600 px wide, inline styles; tested patterns for Gmail,
  Outlook (Windows Outlook gets MSO-conditional tables and VML buttons),
  Apple Mail and iOS Mail.
- Structure: a header (logo, and the member's workspace name when known), a
  hero illustration for non-security emails, an eyebrow label that tells the
  email types apart ("Task assigned", "Incident · SEV1", "Security alert"),
  the heading, a first-name greeting, the content, then a footer with a
  navigation row (Open TavetaHQ · Help · Notification settings, the last for
  non-security emails only; an invitation and the access-ended email, whose
  recipients cannot sign in, keep only Help), the reason for the email, the support contact,
  the legal name and the postal address when set.
- The item an email is about (task, incident, deployment) is a card: key and
  product mark, title linking straight to the item, coloured status pills
  and a few facts. Pills, panels and notices have explicit dark-mode colours
  that keep at least 4.5:1 text contrast (tested).
- `color-scheme: light dark` with dark-mode overrides (also for Outlook.com's
  `[data-ogsc]`/`[data-ogsb]`), and a hidden preheader.
- No external CSS, no JavaScript. Images follow the rules in
  [Brand](brand.md#email-imagery): one hero per non-security email, product
  marks, the logo; security notices carry no image but the logo. Every image
  has alt text, explicit size and a fallback background colour, and every
  email reads fully with images blocked.
- Human details (`Backend/mail/labels.ts`): first-name greeting ("Hi Kofi,",
  the full name when it is a single word), labels for every enum (priority,
  task status, incident severity and status, environment), the product's
  display name, dates like "Sat 14 Nov 2026 · in 7 days" in the member's
  time zone, and links that open the task, incident or deployment directly.
  The digest groups notifications by type (approvals, assignments, mentions
  and comments, handovers, security) with counts and HTML icon tiles.
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

Images: production HTML always uses absolute URLs (`BRAND_LOGO_URL` and
`BRAND_ASSET_BASE_URL`). The preview copies every referenced image that
exists under `Frontend/public/` into `<out>/assets/` and points the preview
HTML at the copy, so previews never show broken images even when the domain
does not serve them yet. The rewrite happens only in the preview script.

When `BRAND_POSTAL_ADDRESS` is unset the footer omits the line, exactly as in
production. Nothing is sent. For a check in real clients,
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
