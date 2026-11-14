// Lighthouse (desktop preset) against a running TavetaHQ web app, signed out and
// signed in as a demo persona. Prints a Markdown table of medians.
//
//   node scripts/lighthouse.mjs http://127.0.0.1:4173 [--runs 3] [--role admin]
//       [--paths /sign-in,/,/my-work] [--out <dir>]
//
// The base URL must serve the production build with the same-origin /api
// proxy (`vite preview` or the Caddy image with API_MODE=proxy) and a backend
// in demo mode (NODE_ENV=development). /sign-in is measured signed out; every
// other path is measured with the persona's session cookie. Uses
// `npx lighthouse@12` and the locally installed Chrome (CHROME_PATH to override).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const runs = Number(opt('runs', '3'));
const role = opt('role', 'admin');
const paths = opt('paths', '/sign-in,/,/my-work').split(',');
const out = opt('out', join(tmpdir(), `devhq-lighthouse-${Date.now()}`));
mkdirSync(out, { recursive: true });

if (!process.env.CHROME_PATH && process.platform === 'darwin') {
  process.env.CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

// Sessions are bound to the User-Agent (Backend/auth/sessions.ts): sign in and audit
// with the same one. A fresh session per run, since a mismatch would revoke it.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 TavetaHQ-Lighthouse';

/** Demo sign-in through the app origin; returns a Cookie header value. */
async function sessionCookie() {
  const res = await fetch(`${base}/api/auth/demo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, 'user-agent': UA },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new Error(`demo sign-in failed: ${res.status} ${await res.text()}`);
  const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]);
  // Onboarding, if the persona needs it, is not completed here: use a ready persona (admin, owner).
  return cookies.join('; ');
}

function lighthouse(url, cookie, file) {
  const flags = [
    'lighthouse@12',
    url,
    '--preset=desktop',
    '--only-categories=performance',
    '--output=json',
    `--output-path=${file}`,
    '--quiet',
    `--emulated-user-agent=${UA}`,
    '--chrome-flags=--headless=new --no-first-run --no-default-browser-check',
  ];
  if (cookie) flags.push(`--extra-headers=${JSON.stringify({ Cookie: cookie })}`);
  execFileSync('npx', ['--yes', ...flags], { stdio: ['ignore', 'ignore', 'inherit'] });
  const r = JSON.parse(readFileSync(file, 'utf8'));
  const a = r.audits;
  const js = (a['network-requests']?.details?.items ?? [])
    .filter((i) => i.resourceType === 'Script')
    .reduce((n, i) => n + (i.transferSize ?? 0), 0);
  return {
    score: Math.round((r.categories.performance.score ?? 0) * 100),
    fcp: a['first-contentful-paint'].numericValue,
    lcp: a['largest-contentful-paint'].numericValue,
    tbt: a['total-blocking-time'].numericValue,
    cls: a['cumulative-layout-shift'].numericValue,
    js,
    total: a['total-byte-weight'].numericValue,
    finalUrl: r.finalDisplayedUrl ?? r.finalUrl,
  };
}

const median = (xs) => {
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

const rows = [];
for (const path of paths) {
  const signedIn = path !== '/sign-in';
  const results = [];
  for (let i = 0; i < runs; i++) {
    const file = join(out, `${path.replace(/\W+/g, '_') || 'root'}-${i}.json`);
    results.push(lighthouse(`${base}${path}`, signedIn ? await sessionCookie() : '', file));
  }
  const pick = (k) => median(results.map((r) => r[k]));
  rows.push({
    path: signedIn ? `${path} (${role})` : path,
    score: pick('score'),
    fcp: pick('fcp'),
    lcp: pick('lcp'),
    tbt: pick('tbt'),
    cls: pick('cls'),
    js: pick('js'),
    total: pick('total'),
    landed: results[0].finalUrl,
  });
}

const kb = (n) => `${(n / 1000).toFixed(0)} kB`;
const ms = (n) => `${Math.round(n)} ms`;
console.log(`\nLighthouse 12, desktop preset, median of ${runs} (${base}); JSON in ${out}\n`);
console.log('| Page | Score | FCP | LCP | TBT | CLS | JS transferred | Total transferred |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|');
for (const r of rows) {
  console.log(
    `| \`${r.path}\` | ${r.score} | ${ms(r.fcp)} | ${ms(r.lcp)} | ${ms(r.tbt)} | ${r.cls.toFixed(3)} | ${kb(r.js)} | ${kb(r.total)} |`,
  );
}
for (const r of rows)
  if (!r.landed.endsWith(r.path.split(' ')[0]))
    console.log(`note: ${r.path} landed on ${r.landed}`);
