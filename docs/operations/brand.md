# Brand

TavetaHQ's identity as it appears in the app and in every email. The values live in
[`infra/brand/tavetahq.brand.env`](../../infra/brand/tavetahq.brand.env); email reads
them from the `BRAND_*` variables described in [Email](email.md).

## Name

**TavetaHQ**: one word, "HQ" in capitals. Tagline: "Your team. Your work. One
headquarters." The official domain is `tavetahq.io`.

## Logo

The mark is a weaver bird with a round gold body and an indigo wing crossed by
two white woven lines. Weaver birds build one shared nest strand by strand; the
woven wing stands for team and work coming together in one HQ.

The artwork comes from the brand handoff PNGs, which are the source of truth.
`python3 infra/brand/logo-assets.py <handoff assets folder>` (needs Pillow)
regenerates every file below; nothing is redrawn by hand.

| File (`Frontend/public/`) | Use |
|---|---|
| `brand/tavetahq-mark.png` | The bird alone, trimmed, 128 px. The in-app mark (`<BrandLogo>`), shown at 16 to 40 px. |
| `brand/tavetahq-bird-512.png` | The bird with the handoff's padding: avatars, social. |
| `brand/tavetahq-logo.png` | Full lockup: bird, wordmark and tagline. Marketing and documents. |
| `brand/tavetahq-wordmark.png` | Bird and wordmark without the tagline. |
| `brand/tavetahq-email-logo.png` | The wordmark at 336 × 77, shown 168 px wide in email. PNG because Gmail and Outlook do not display SVG. |
| `favicon.ico`, `favicon-32.png` | Browser tab (16, 32 and 48 px). |
| `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` | Home-screen and PWA icons on a white tile, listed in `site.webmanifest`. |

In the app, `<BrandLogo>` is the bird and `<BrandName>` sets the name beside it
as in the logo: "Taveta" in ink, "HQ" in indigo. On dark surfaces use that
pair, not the lockup PNG, whose dark wordmark disappears on dark. The bird's
wing lines are solid white, so the bird itself works on any background. Email
puts the logo on its own white chip, so it stays legible when a mail client
inverts colours.

Rules: keep clear space of at least the bird's head height around the logo;
show the full lockup at 96 px wide or more and the bird at 16 px or more; do
not recolour, stretch, rotate, shadow or put text over the bird.

**Known limit:** the artwork is a raster about 1024 px wide, so the 16 px
favicon and very large uses are slightly soft. A vector (SVG) redraw would fix
both, and is also needed for a reversed lockup on dark backgrounds.

## Colour

| Role | Hex | Where |
|---|---|---|
| Taveta Indigo | `#4338CA` | The wing, "HQ", buttons in email, active navigation, links, focus rings, charts. The app's `accent` token and `BRAND_PRIMARY_COLOR`. |
| Weaver Gold | `#F5B301` | The bird's body and small highlights. Never text on white (1.9 : 1). |
| Nest Ink | `#15132B` | "Taveta", headings, body text, primary buttons. The app's `ink` token. |
| Deep indigo | `#3730A3` | Links and highlights in email (`BRAND_ACCENT_COLOR`); text on indigo-tinted backgrounds in the app. |
| Indigo tint | `#EEEDF9` | Active navigation background, the sign-in panel. The app's `accent-soft` token. |
| Success / danger | the app's `ok` / `bad` tokens | Status only, never decoration. |

White on Indigo and Ink on Gold both pass WCAG AAA. The three brand colours
are far apart in lightness, so they stay distinct for colour-blind readers,
but never rely on colour alone for status: pair it with an icon or a label.

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
   lines marked `REVIEW` in `infra/brand/tavetahq.brand.env` and set the ones
   that differ: legal name, support mailbox, and the postal address, which is
   never derived or invented.
2. Verify the sending subdomain (`mail.<domain>`) in Resend and add its SPF,
   DKIM and DMARC records ([Email](email.md)).
3. Render the previews with your values and read every one:

   ```bash
   cd Backend
   set -a; . ../infra/brand/tavetahq.brand.env; set +a
   npm run mail:preview -- --out /tmp/devhq-mail
   ```

   The preview copies the images it references into the output folder, so
   they show even before your domain serves them.

4. Send one of each security email to Gmail, Outlook and Apple Mail accounts
   you control, in light and dark mode, before inviting real members.
