/**
 * DevHQ CYBER assessment — automated, re-runnable attack suite.
 *
 * Runs every check against a FRESH backend process with isolated state (so
 * results never bleed between checks and "run twice on fresh processes" holds
 * for free), then prints a PASS/FAIL/SKIP table.
 *
 *   PASS — the control holds / no vulnerability reproduced.
 *   FAIL — a vulnerability reproduced (this becomes a regression test).
 *   SKIP — not applicable here (e.g. surface not merged, egress out of scope).
 *
 * Exit code: non-zero if any check FAILs (or errors). SKIPs do not fail the run.
 *
 * Usage:
 *   node --experimental-strip-types security-tests/run.ts
 *   node --experimental-strip-types security-tests/run.ts sse auth   # filter by substring
 *
 * No third-party dependencies. Every target is a local 127.0.0.1 process this
 * runner starts and stops itself.
 */

import { spawnServer, type Check, type Finding } from './lib/harness.ts';

import { check as sseLeak } from './checks/sse-cross-product-leak.ts';
import { check as enumeration } from './checks/auth-user-enumeration.ts';
import { check as lockout } from './checks/auth-lockout-email-variants.ts';
import { check as xff } from './checks/auth-xff-ratelimit-spoof.ts';
import { check as session } from './checks/session-rotation-reuse.ts';
import { check as demoMfa } from './checks/demo-mfa-stepup-bypass.ts';
import { check as bearerBody } from './checks/bearer-token-in-body.ts';
import { check as partial } from './checks/partial-session-confusion.ts';
import { check as query } from './checks/query-engine-abuse.ts';
import { check as traversal } from './checks/path-traversal-fonts.ts';
import { check as headerInj } from './checks/header-log-injection.ts';
import { check as csrf } from './checks/csrf-origin-guard.ts';
import { check as massAssign } from './checks/authz-mass-assignment-bfla.ts';
import { check as twoPerson } from './checks/two-person-deploy.ts';
import { check as bodySize } from './checks/dos-body-size.ts';
import { check as csp } from './checks/csp-and-clickjacking.ts';
import { check as ssrfCodespaces } from './checks/ssrf-codespaces.ts';
import { check as ssrfMonitors } from './checks/ssrf-monitors-webhooks.ts';
// Phase 2 — merged branch attack surface.
import { check as mfaEnroll } from './checks/mfa-enrollment.ts';
import { check as patAuthority } from './checks/pat-authority.ts';
import { check as fileUpload } from './checks/file-upload-policy.ts';
import { check as ghWebhook } from './checks/github-webhook.ts';
import { check as mlHmac } from './checks/ml-hmac.ts';
import { check as ssrfGuard } from './checks/ssrf-guard-unit.ts';
import { check as streamXchannel } from './checks/stream-cross-channel.ts';
import { check as restoreAuthz } from './checks/backup-restore-authz.ts';
import { check as assistant } from './checks/assistant-prompt-injection.ts';
import { check as envFailOpen } from './checks/env-failopen.ts';
import { check as jitAccess } from './checks/jit-production-access.ts';

const CHECKS: Check[] = [
  enumeration,
  lockout,
  xff,
  session,
  demoMfa,
  bearerBody,
  partial,
  sseLeak,
  query,
  traversal,
  headerInj,
  csrf,
  massAssign,
  twoPerson,
  jitAccess,
  bodySize,
  csp,
  ssrfCodespaces,
  ssrfMonitors,
  // Phase 2
  mfaEnroll,
  patAuthority,
  fileUpload,
  ghWebhook,
  mlHmac,
  ssrfGuard,
  streamXchannel,
  restoreAuthz,
  assistant,
  envFailOpen,
];

interface Row {
  check: Check;
  finding: Finding;
  ms: number;
}

async function runOne(check: Check): Promise<Row> {
  const t0 = Date.now();
  let server;
  try {
    server = await spawnServer({ env: check.env });
    const finding = await check.run(server.base, server);
    return { check, finding, ms: Date.now() - t0 };
  } catch (e) {
    return {
      check,
      finding: { status: 'fail', detail: `harness error: ${(e as Error).message}` },
      ms: Date.now() - t0,
    };
  } finally {
    server?.stop();
  }
}

function pad(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n);
}

async function main() {
  const filters = process.argv.slice(2).map((s) => s.toLowerCase());
  const selected = filters.length
    ? CHECKS.filter((c) => filters.some((f) => c.name.toLowerCase().includes(f) || c.area.toLowerCase().includes(f)))
    : CHECKS;

  console.log(`\nDevHQ CYBER assessment — ${selected.length} checks, fresh process each\n`);

  const rows: Row[] = [];
  for (const c of selected) {
    process.stdout.write(`  running: ${c.name} … `);
    const row = await runOne(c);
    rows.push(row);
    console.log(row.finding.status.toUpperCase());
  }

  const mark = (s: string) => ({ pass: 'PASS', fail: 'FAIL', skip: 'SKIP' })[s] ?? s.toUpperCase();
  console.log('\n' + '─'.repeat(110));
  console.log(`  ${pad('ID', 14)}${pad('RESULT', 7)}${pad('AREA', 20)}${pad('CHECK', 40)}TIME`);
  console.log('─'.repeat(110));
  for (const r of rows) {
    console.log(
      `  ${pad(r.finding.id ?? '-', 14)}${pad(mark(r.finding.status), 7)}${pad(r.check.area, 20)}${pad(r.check.name, 40)}${(r.ms / 1000).toFixed(1)}s`,
    );
  }
  console.log('─'.repeat(110));
  for (const r of rows) console.log(`  [${mark(r.finding.status)}] ${r.check.name}: ${r.finding.detail}`);
  console.log('─'.repeat(110));

  const pass = rows.filter((r) => r.finding.status === 'pass').length;
  const fail = rows.filter((r) => r.finding.status === 'fail').length;
  const skip = rows.filter((r) => r.finding.status === 'skip').length;
  console.log(`\n  PASS ${pass}  ·  FAIL ${fail}  ·  SKIP ${skip}  ·  total ${rows.length}\n`);

  process.exit(fail > 0 ? 1 : 0);
}

void main();
