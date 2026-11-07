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

/** Minimum % per directory: [lines, branches, functions]. */
const THRESHOLDS: Record<string, [number, number, number]> = {
  'security/': [90, 85, 90],
  'auth/': [90, 85, 85],
  'lib/': [90, 85, 85],
  // The two uncovered functions are fire-and-forget fs error handlers.
  'audit/': [90, 80, 75],
  'store/collection.ts': [95, 90, 95],
  'middleware/': [90, 85, 90],
  'routes/': [85, 75, 80],
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
for (const [area, [tl, tb, tf]] of Object.entries(THRESHOLDS)) {
  const c = sum((f) => f === area || f.startsWith(area));
  if (c.lf === 0) {
    console.error(`  ✗ ${area}: no files measured`);
    failed = true;
    continue;
  }
  const got = [pct(c.lh, c.lf), pct(c.brh, c.brf), pct(c.fnh, c.fnf)];
  const ok = got[0] >= tl && got[1] >= tb && got[2] >= tf;
  if (!ok) failed = true;
  console.log(
    `  ${ok ? '✓' : '✗'} ${area.padEnd(22)} lines ${fmt(got[0])} ≥ ${tl}  branches ${fmt(got[1])} ≥ ${tb}  functions ${fmt(got[2])} ≥ ${tf}`,
  );
}
console.log(`\nlcov: ${relative(ROOT, LCOV)}`);
process.exit(failed ? 1 : 0);
