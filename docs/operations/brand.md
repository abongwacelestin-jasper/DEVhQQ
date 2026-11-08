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
| Primary (indigo) | `#4F46E5` | Buttons, the email top rule, the app's accent |
| Accent (deep indigo) | `#3730A3` | Links and highlights in email; text on indigo-tinted backgrounds in the app |
| Mark nodes | `#A5B4FC` | The three lower nodes in the mark only |
| Success / danger | the app's `ok` / `bad` tokens | Status only, never decoration |

Body text on white meets WCAG AA contrast with Ink and with Accent. Do not use
Primary for small text on white; use Accent.

## Type

Inter for interface and email text (email falls back to the system sans-serif
stack where Inter is not installed), JetBrains Mono for code, keys and IDs.

## Voice

Calm, specific and brief. Say what happened, when, and what to do next. No
exclamation marks, no filler ("We're excited to…"), no blame. Security emails
always say what to do if the recipient did not take the action. Use the
member's name, not "user". Times include the time zone.

## Email checklist before go-live

1. Replace every line marked `REVIEW` in `infra/brand/devhq.brand.env`:
   legal name, real domain (logo URL, website, support and sender addresses)
   and a postal address.
2. Verify the sending subdomain (`mail.<domain>`) in Resend and add its SPF,
   DKIM and DMARC records ([Email](email.md)).
3. Render the previews with your values and read every one:

   ```bash
   cd Backend
   set -a; . ../infra/brand/devhq.brand.env; set +a
   npm run mail:preview -- --out /tmp/devhq-mail
   ```

4. Send one of each security email to Gmail, Outlook and Apple Mail accounts
   you control, in light and dark mode, before inviting real members.
