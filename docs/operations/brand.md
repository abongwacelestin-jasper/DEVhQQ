# Brand

DevHQ's identity as it appears in the app and in every email. The values live in
[`infra/brand/devhq.brand.env`](../../infra/brand/devhq.brand.env); email reads
them from the `BRAND_*` variables described in [Email](email.md).

## Logo

| File | Use |
|---|---|
| `Frontend/public/brand/devhq-mark.svg` | The mark alone (32 × 32): app icon, favicon, avatars. Same drawing as `DevHQLogo` in the app. |
| `Frontend/public/brand/devhq-email-logo.png` | Mark plus "DevHQ" wordmark, 464 × 128 PNG with a transparent background. Shown at 120 px wide in email. PNG because Gmail and Outlook do not display SVG. |

The mark is a dark rounded square with one node branching to three: a team
working from one place. Keep clear space around the logo of at least the mark's
corner radius (8 px at 32 px), do not recolour the mark, and do not place it on
a busy background. Email puts it on its own white chip, so it stays legible when
a mail client inverts colours in dark mode.

The PNG is served by the frontend at `https://<your domain>/brand/devhq-email-logo.png`.
To regenerate it after a change to the mark, render the lockup at 4× in a
browser (mark at 32 px, 10 px gap, "DevHQ" in Inter Bold 22 px, letter-spacing
−0.4 px, colour `#15171C`) and export with a transparent background.

## Colour

| Role | Hex | Where |
|---|---|---|
| Ink | `#15171C` | Logo square, headings, body text |
| Primary (indigo) | `#4F46E5` | Buttons, the email eyebrow dot, the app's accent |
| Accent (deep indigo) | `#3730A3` | Links and highlights in email; text on indigo-tinted backgrounds in the app |
| Mark nodes | `#A5B4FC` | The three lower nodes in the mark only |
| Success / danger | the app's `ok` / `bad` tokens | Status only, never decoration |

Body text on white meets WCAG AA contrast with Ink and with Accent. Do not use
Primary for small text on white; use Accent.

## Email imagery

Emails use the app's own artwork, served by the frontend from
`Frontend/public/brand/` (so production URLs are
`https://<your domain>/brand/...`, or `BRAND_ASSET_BASE_URL/...` when the
images live on a CDN).

**Rules**

- **One hero per non-security email.** Invitation, digest, task assigned,
  review requested, incident, deployment approval, access request and
  offboarding each open with one header illustration. 1200 × 480 JPEG under
  80 kB, shown at 520 × 208 (sharp on retina), with alt text, explicit
  `width` and `height`, `display:block` and a background colour that matches
  the artwork's backdrop, so an email with images blocked shows a calm
  coloured block with the alt text and still reads completely.
- **Security notices carry no image but the logo.** Sign-in alert, password
  reset and change, authenticator and passkey changes, backup codes and
  account lock-out show a small shield drawn in HTML and CSS (a tinted,
  shield-shaped tile with `!` or a tick) instead. This is deliberate:
  image-heavy security mail looks like phishing, is more likely to be
  filtered, and must stay fully legible when images are off. Do not add
  illustrations to them; the layout refuses to render one.
- **Product marks** appear next to a product's display name (RenewBerry,
  Blog, Mirror Acture): 48 px PNG shown at 24 px, decorative (`alt=""`,
  because the name follows), rendered from the app's own `<ProductMark>`.
- Never put text that matters inside an image. Everything an email says is
  in its HTML and plain-text parts.

**Assets** (`Frontend/public/brand/email/`)

| File | Source illustration | Used in |
|---|---|---|
| `hero-invite.jpg` | `welcome` (laptop with a project dashboard) | Invitation |
| `hero-digest.jpg` | `assistant` (records flowing into one answer) | Digest |
| `hero-task.jpg` | `checklist` (clipboard with ticked items) | Task assigned |
| `hero-review.jpg` | `code` (code editor) | Review requested |
| `hero-incident.jpg` | `incident` (server with an alert light) | Incident declared |
| `hero-deploy.jpg` | `ship` (rocket from a server pad) | Deployment approval |
| `hero-access.jpg` | `lockedGate` (gate with a padlock) | Access request |
| `hero-handover.jpg` | `volunteer` (team passing a puzzle piece) | Offboarding started, handover |
| `hero-farewell.jpg` | `idle` (closed laptop with a padlock) | Offboarding completed |
| `mark-renewberry.png`, `mark-blog.png`, `mark-mirror.png` | `<ProductMark>` | Next to product names |

The hero alt texts and fallback colours live in `Backend/mail/assets.ts`.
Regenerate every file after changing an illustration or a product mark
(macOS; needs the repo's dev dependencies and Google Chrome):

```bash
node infra/brand/email-assets.mjs
```

The script fits each illustration into the 1200 × 480 banner, extends its own
backdrop to the sides, encodes the JPEG with `sips`, and prints each file's
size and edge colour (copy a changed colour into `assets.ts`). Product marks
are rendered from `Frontend/src/components/ui/ProductMark.tsx` with React's
server renderer and headless Chrome.

Note: `Frontend/public/renewberry.png`, which `<ProductMark>` shows for
RenewBerry, is currently a dashboard screenshot rather than a logo, so the
RenewBerry mark reads as a small grey thumbnail in the app and in email.
Replace that file with the real RenewBerry logo and rerun the script.

## Type

Inter for interface and email text (email falls back to the system sans-serif
stack where Inter is not installed), JetBrains Mono for code, keys and IDs.

## Voice

Calm, specific and brief. Say what happened, when, and what to do next. No
exclamation marks, no filler ("We're excited to…"), no blame. Security emails
always say what to do if the recipient did not take the action. Greet the
member by first name ("Hi Kofi,"), never "user". Show labels as the app shows
them ("High", "To do", "In review", "SEV1 · Critical", "RenewBerry"), never
raw values. Dates read "Sat 14 Nov 2026 · in 7 days"; times include the time
zone and use the member's own zone when known.

## Email checklist before go-live

1. Set `APP_URL` to your real address. Every other brand value is optional
   and derived from it (see [Email](email.md#brand-variables)); review the
   lines marked `REVIEW` in `infra/brand/devhq.brand.env` and set the ones
   that differ: legal name, support mailbox, and the postal address, which is
   never derived or invented.
2. Verify the sending subdomain (`mail.<domain>`) in Resend and add its SPF,
   DKIM and DMARC records ([Email](email.md)).
3. Render the previews with your values and read every one:

   ```bash
   cd Backend
   set -a; . ../infra/brand/devhq.brand.env; set +a
   npm run mail:preview -- --out /tmp/devhq-mail
   ```

   The preview copies the images it references into the output folder, so
   they show even before your domain serves them.

4. Send one of each security email to Gmail, Outlook and Apple Mail accounts
   you control, in light and dark mode, before inviting real members.
