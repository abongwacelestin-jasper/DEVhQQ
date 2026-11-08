# Web app performance

How fast the web app loads, what makes it fast, and how to measure it again.
Targets: Lighthouse Performance ≥ 95 on `/sign-in` and ≥ 90 on `/` signed in
(desktop preset), the smallest practical entry bundle, and no JavaScript chunk
over 500 kB except the code editor, which only loads in the code workspace.

## Results

Production build served by `vite preview` (same `/api` proxy as production)
with a demo-mode backend, Lighthouse 12, desktop preset, median of three runs
(five for `/` after).
Signed-in pages use the demo Admin. Before is `develop` at 4ec9c40; after is
this change.

| Page | | Score | FCP | LCP | TBT | CLS | JS transferred | Total transferred |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| `/sign-in` | before | 95 | 775 ms | 1391 ms | 103 ms | 0.020 | 444 kB | 1226 kB |
| | after | **96** | 601 ms | 951 ms | 21 ms | 0.020 | 212 kB | 348 kB |
| `/` (Admin) | before | 58 | 773 ms | 1765 ms | 837 ms | 0.006 | 444 kB | 1353 kB |
| | after | **95** | 557 ms | 1043 ms | 148 ms | 0.011 | 236 kB | 440 kB |
| `/my-work` (Admin) | before | 53 | 798 ms | 2161 ms | 880 ms | 0.004 | 444 kB | 1322 kB |
| | after | **96** | 589 ms | 1021 ms | 117 ms | 0.003 | 244 kB | 444 kB |

"JS transferred" is gzip as `vite preview` sends it; Caddy sends brotli, about
20 % smaller. The after row for `/` is a median of five runs (the three-run
median, taken while the machine was busiest, was 87, with single runs from
56 to 96). An earlier before run of `/sign-in` scored 70 (TBT 573 ms).

What moved the numbers: on `/sign-in` the slideshow image (the LCP element)
is a 30 kB WebP fetched at high priority instead of a lazily faded-in 68 kB
JPEG, and the page parses a third of the JavaScript. Signed in, the main
thread no longer evaluates the whole app before the first page (TBT), the
420 ms skeleton no longer holds every page back (LCP), and the landing
page's chunk downloads in parallel with the session probe.

The machine was shared with other heavy jobs during every run (load average
from about 100 to over 700), so single runs vary by tens of points; compare
before with after, and re-measure on a quiet machine for absolute values.
Lighthouse's simulated throttling models the network, not local CPU
contention, which mostly shows up in TBT.

### Bundle

`node scripts/bundle-report.mjs dist` (brotli quality 11, what Caddy serves):

| | Before | After |
|---|---:|---:|
| Entry JS + CSS a first visit loads, brotli | 344 kB | 185 kB |
| Entry JS, brotli (raw) | 333 kB (1,543 kB) | 173 kB (657 kB) |
| Largest entry chunk, raw | 1,535 kB | 443 kB |
| Landing page chunk, brotli (`Overview` / `MyWork`) | in the entry | 6 kB / 4 kB |
| JS chunks over 500 kB, raw | 1 (the whole app) | Monaco only: `editor.api` 2.7 MB, the code workspace 1.5 MB, the TypeScript, CSS and HTML workers |

Of the 657 kB raw entry, react-dom is 129 kB, framer-motion 108 kB,
react-router 39 kB, sonner 34 kB, lucide icons 19 kB; the rest is the
providers, the app shell, the auth screens and the overlays the shell can
open (command menu, assistant, create-task and incident dialogs, lock
screen).

The entry is what a first visit downloads before the landing page's own
chunk: the entry script, the chunks it imports (`index.html` modulepreloads
them) and the stylesheet. Every page is now its own chunk (typically 2-25 kB
brotli). Monaco is the only code over 500 kB and is fetched only when the
local IDE opens: `editor.api` and the code workspace chunk, plus one worker
per language the first time it is needed (the TypeScript worker is the
largest, ~1 MB brotli).

Images: the 26 illustrations went from 1.57 MB of JPEG to 0.28 MB of WebP,
and the product logo (`renewberry.png`, also the favicon) from 691 kB to 8 kB.

## What makes it fast

**Route-level code splitting.** `Frontend/src/routes/lazyPages.ts` turns every
routed page into a `React.lazy` chunk. The providers, the auth screens
(sign-in, verify, forgot and reset password, accept invite) and the app shell
stay in the entry. In the shell, pages suspend inside the content area with a
skeleton that only appears if the chunk takes longer than 180 ms
(`Frontend/src/components/layout/RouteFallback.tsx`), so a fast load shows no
flash. Navigations run in a React transition: the current page stays on
screen until the next one is ready. The fixed 420 ms skeleton that every page
change used to show is gone.

**Prefetching** (`Frontend/src/routes/usePrefetch.ts`). A route's chunk is
fetched when a link to it is hovered, focused or touched; for the landing URL
at boot, in parallel with the session probe; and for the role's home (or the
remembered deep link) as soon as the role is known, which is during the
second-factor step. The code editor is never prefetched.

**Self-hosted fonts and editor.** Inter and JetBrains Mono are variable WOFF2
files in the build (latin and latin-ext, `font-display: swap`, a
metric-matched Arial fallback so the swap does not shift layout), and the
latin Inter file is preloaded from `index.html`. Monaco is bundled from
`monaco-editor` with module workers
(`Frontend/src/components/code/monacoLoader.ts`) instead of loaded from
jsDelivr. Neither Google Fonts nor jsDelivr is contacted any more, and both
left the Content-Security-Policy.

**Fewer round trips at boot.** After the session probe, the team directory and
capabilities requests start in parallel with the onboarding probe instead of
after it (`Frontend/src/api/auth/useSessionState.ts`).

**Images.** WebP at 960 px (2x the largest size they render at), lazy loaded;
the first slide of the sign-in slideshow, the largest paint there, is fetched
at high priority and shown without a fade.

**Caching and transfer** (`infra/frontend/Caddyfile`).

| Path | `Cache-Control` | Notes |
|---|---|---|
| `/assets/*` (hashed JS, CSS, fonts, editor workers) | `public, max-age=31536000, immutable` | brotli and gzip pre-compressed at build time |
| `/brand/*`, illustrations, icons (from `Frontend/public`) | `public, max-age=86400` | not hashed, so a day |
| `index.html` and every client route | `no-cache` | revalidated each load: a deploy shows at once |

The shell response also carries a `Link: …; rel=preload` header for the entry
scripts, stylesheet and Inter font, generated per build by
`infra/frontend/preload-links.mjs` (see `Frontend/Dockerfile`). Browsers start
those fetches from the header, and Cloudflare turns it into `103 Early Hints`.
HTTP/2 and HTTP/3 are terminated by Cloudflare; the Cloudflare settings are in
[Railway, section 8](../deploy/RAILWAY.md#8-custom-domain-and-dns-on-cloudflare).

**Stale chunks after a deploy.** A tab opened before a deploy still references
the old hashed chunks, which the new image no longer has. When a lazy page
fails to load for that reason the app reloads once to pick up the new shell
(at most once a minute, so a real outage still shows the error).

**Guard rail.** `Frontend/vite.config.ts` has a chunk budget: the build fails
if any chunk other than Monaco's is over 500 kB.

## Measure again

Bundle sizes:

```bash
cd Frontend
npx vite build
node scripts/bundle-report.mjs dist          # --all lists every chunk
```

Lighthouse, against a production build with a demo backend (two terminals):

```bash
cd Backend
NODE_ENV=development PORT=18555 APP_ORIGIN=http://127.0.0.1:4173 \
  node --experimental-strip-types server.ts

cd Frontend
npx vite build
DEVHQ_API_URL=http://127.0.0.1:18555 npx vite preview --host 127.0.0.1 --port 4173
```

Then, in a third terminal:

```bash
cd Frontend
node scripts/lighthouse.mjs http://127.0.0.1:4173 --runs 3
# options: --role admin  --paths /sign-in,/,/my-work  --out <dir for the JSON reports>
```

The script runs `npx lighthouse@12` with the installed Chrome (set
`CHROME_PATH` elsewhere than macOS), measures `/sign-in` signed out and every
other path signed in with a fresh demo session, and prints the Markdown table
used above. Sessions are bound to the browser's User-Agent, so the script
signs in and audits with the same one. Use a ready persona (`admin`, `owner`):
it does not complete onboarding. Close other heavy processes first; CPU load
inflates TBT.

To check the real deployment instead, run Lighthouse or WebPageTest against
the public URL, and the header checks in the Railway go-live checklist.

## Not done yet

- **framer-motion** is the largest library in the entry (about a quarter of
  it). Switching to `LazyMotion` with `m` components would cut it, but the
  bottom navigation uses shared-layout animations (`layoutId`), which need the
  larger feature set, so the saving is small for a change touching 33 files.
- The CSP header in the Caddyfile does not carry the code sandbox's script
  hash that the `<meta>` policy does (`vite.config.ts`), so the in-browser code
  runner's sandbox frame may be blocked behind Caddy. This predates this work.
