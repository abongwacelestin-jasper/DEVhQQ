/**
 * Runs the unit + integration suites under node's built-in coverage, writes
 * coverage/lcov.info, prints per-directory line/branch/function coverage and
 * enforces per-directory thresholds (exit 1 if any is missed).
 *
 *   npm run test:coverage
 *
 * Thresholds are set per area for modules that have dedicated tests — not a
 * single global number. Raise them as coverage grows; never lower one to go
 * green (BOARD hard rule 2).
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'coverage');
const LCOV = resolve(OUT, 'lcov.info');

/**
 * Minimum % [lines, branches, functions] per area. An area is a list of path
 * prefixes (a directory with a trailing slash, or one file). Areas cover the
 * modules that have dedicated tests; route modules added by other lanes
 * without tests are reported in the table above but not yet gated — add them
 * here as their tests land, never lower a number to go green.
 */
const THRESHOLDS: Record<string, { paths: string[]; min: [number, number, number] }> = {
  'security/': { paths: ['security/'], min: [90, 85, 90] },
  'auth/': { paths: ['auth/'], min: [90, 85, 85] },
  'lib/': { paths: ['lib/'], min: [90, 85, 85] },
  // The uncovered functions are fire-and-forget fs error handlers.
  'audit/': { paths: ['audit/'], min: [90, 80, 75] },
  'store/collection.ts': { paths: ['store/collection.ts'], min: [95, 90, 95] },
  'middleware/': { paths: ['middleware/'], min: [90, 85, 90] },
  'routes (tested set)': {
    paths: [
      'routes/auth.routes.ts',
      'routes/docs.routes.ts',
      'routes/locations.routes.ts',
      'routes/operations.routes.ts',
      'routes/projects.routes.ts',
      'routes/security.routes.ts',
      'routes/system.routes.ts',
      'routes/tasks.routes.ts',
      'routes/team.routes.ts',
      'routes/tokens.routes.ts',
    ],
    min: [85, 75, 80],
  },
  'db/driver.ts': { paths: ['db/driver.ts'], min: [95, 85, 95] },
  'storage/{sigv4,magic}': { paths: ['storage/sigv4.ts', 'storage/magic.ts'], min: [95, 85, 95] },
  // Lines 67-127 are the real DNS resolver / socket transport (network only).
  'monitors/ssrf.ts': { paths: ['monitors/ssrf.ts'], min: [80, 90, 90] },
  'integrations/ml/signing.ts': { paths: ['integrations/ml/signing.ts'], min: [95, 90, 95] },
  'integrations/webhooks/dispatcher.ts': {
    paths: ['integrations/webhooks/dispatcher.ts'],
    min: [90, 70, 85],
  },
  'domain/collab (policy)': {
    paths: [
      'domain/collab/access.ts',
      'domain/collab/diff.ts',
      'domain/collab/nda.ts',
      'domain/collab/onboarding.ts',
      'domain/collab/passwordPolicy.ts',
      'domain/collab/realtime.ts',
      'domain/collab/notify.ts',
    ],
    min: [85, 85, 80],
  },
};

mkdirSync(OUT, { recursive: true });
const run = spawnSync(
  process.execPath,
  [
    '--experimental-strip-types',
    '--import',
    './test/setup.ts',
    '--experimental-test-coverage',
    '--test-coverage-exclude=test/**',
    '--test-coverage-exclude=scripts/**',
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    '--test-reporter=lcov',
    `--test-reporter-destination=${LCOV}`,
    '--test',
    'test/unit/**/*.test.ts',
    'test/integration/**/*.test.ts',
  ],
  { cwd: ROOT, stdio: 'inherit' },
);
if (run.status !== 0) {
  console.error(`\ntests failed (exit ${run.status}) — coverage not evaluated`);
  process.exit(run.status ?? 1);
}

interface FileCov {
  lf: number;
  lh: number;
  brf: number;
  brh: number;
  fnf: number;
  fnh: number;
}
const files = new Map<string, FileCov>();
let current: string | undefined;
for (const line of readFileSync(LCOV, 'utf8').split('\n')) {
  if (line.startsWith('SF:')) {
    current = relative(ROOT, line.slice(3));
    files.set(current, { lf: 0, lh: 0, brf: 0, brh: 0, fnf: 0, fnh: 0 });
    continue;
  }
  const m = /^(LF|LH|BRF|BRH|FNF|FNH):(\d+)$/.exec(line);
  if (m && current) files.get(current)![m[1].toLowerCase() as keyof FileCov] = Number(m[2]);
}

const pct = (hit: number, found: number) => (found === 0 ? 100 : (hit / found) * 100);
const fmt = (n: number) => n.toFixed(1).padStart(6);

function sum(match: (f: string) => boolean): FileCov {
  const t: FileCov = { lf: 0, lh: 0, brf: 0, brh: 0, fnf: 0, fnh: 0 };
  for (const [f, c] of files)
    if (match(f)) for (const k of Object.keys(t) as (keyof FileCov)[]) t[k] += c[k];
  return t;
}

const dirs = [
  ...new Set([...files.keys()].map((f) => (f.includes('/') ? `${f.split('/')[0]}/` : f))),
].sort();
console.log('\nCoverage by area           lines  branch  funcs   (threshold)');
let failed = false;
for (const d of dirs) {
  const c = sum((f) => f === d || f.startsWith(d));
  const [l, b, fn] = [pct(c.lh, c.lf), pct(c.brh, c.brf), pct(c.fnh, c.fnf)];
  console.log(`  ${d.padEnd(22)} ${fmt(l)}  ${fmt(b)}  ${fmt(fn)}`);
}
console.log('\nEnforced thresholds:');
for (const [area, { paths, min }] of Object.entries(THRESHOLDS)) {
  const [tl, tb, tf] = min;
  const c = sum((f) => paths.some((p) => f === p || (p.endsWith('/') && f.startsWith(p))));
  const missing = paths.filter((p) => !p.endsWith('/') && !files.has(p));
  if (c.lf === 0 || missing.length) {
    console.error(`  ✗ ${area}: not measured ${missing.join(', ')}`);
    failed = true;
    continue;
  }
  const got = [pct(c.lh, c.lf), pct(c.brh, c.brf), pct(c.fnh, c.fnf)];
  const ok = got[0] >= tl && got[1] >= tb && got[2] >= tf;
  if (!ok) failed = true;
  console.log(
    `  ${ok ? '✓' : '✗'} ${area.padEnd(36)} lines ${fmt(got[0])} ≥ ${tl}  branches ${fmt(got[1])} ≥ ${tb}  functions ${fmt(got[2])} ≥ ${tf}`,
  );
}
console.log(`\nlcov: ${relative(ROOT, LCOV)}`);
process.exit(failed ? 1 : 0);
