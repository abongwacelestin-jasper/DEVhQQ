// Prints one line per test from test-results/results.json: node support/summary.mjs [file]
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? new URL('../test-results/results.json', import.meta.url);
const report = JSON.parse(readFileSync(file, 'utf8'));
const counts = {};
function walk(suite, trail) {
  for (const s of suite.suites ?? []) walk(s, [...trail, s.title]);
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests) {
      const r = t.results[t.results.length - 1];
      const status = t.status === 'expected' ? (t.expectedStatus === 'failed' ? 'known-defect' : 'pass') : t.status === 'skipped' ? 'skip' : t.status === 'flaky' ? 'FLAKY' : 'FAIL';
      counts[status] = (counts[status] ?? 0) + 1;
      const err = r?.error?.message?.split('\n').find((l) => l.trim())?.replace(/\u001b\[[0-9;]*m/g, '').slice(0, 220) ?? '';
      console.log(`${status.padEnd(12)} ${t.projectName.padEnd(9)} ${spec.file}:${spec.line} ${[...trail.slice(1), spec.title].join(' › ')} ${(r?.duration / 1000).toFixed(1)}s${status === 'FAIL' ? `\n             ↳ ${err}` : ''}`);
    }
  }
}
walk(report, []);
console.log('\n', counts, `duration ${(report.stats.duration / 1000).toFixed(0)}s`);
