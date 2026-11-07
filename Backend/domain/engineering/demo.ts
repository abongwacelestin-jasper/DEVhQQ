/**
 * Demo dataset for the engineering domains.
 *
 * Seeded lazily, only when NODE_ENV !== 'production' AND the collection is
 * empty, from the same shapes as Frontend/src/data/{engineering,operations,
 * codeSecurity}.ts. Every row carries `source: 'demo'` and list responses
 * carry `source: 'demo'`, so the UI can label it — demo data is never
 * presented as live. Demo monitors are never probed by the scheduler.
 */

import { config } from '../../config/env.ts';
import type { ProductId } from '../../types.ts';
import { createHash } from 'node:crypto';
import { ciRuns, findings, monitorHistory, monitors, pulls, repos, weekStart } from './store.ts';
import type {
  CiRun,
  CiStatus,
  CodeFinding,
  MonitorCheck,
  MonitorRow,
  PullRequestRow,
  Repo,
  ReviewState,
  UptimeTick,
} from './types.ts';

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const SEEDED_BY = 'seed';

const repoSeed: [
  string,
  ProductId,
  CiStatus,
  [string, string, string, number],
  number[],
  string,
][] = [
  [
    'renewberry/api',
    'renewberry',
    'passing',
    ['a41f9c2', 'fix(billing): retry failed webhooks', 'm4', 3],
    [12, 18, 9, 22, 17, 25, 19, 28],
    'v2.3.1',
  ],
  [
    'renewberry/web',
    'renewberry',
    'passing',
    ['c03e8b1', 'feat(account): payment method card', 'm9', 6],
    [8, 6, 11, 9, 14, 10, 7, 12],
    'v2.3.1',
  ],
  [
    'blog/platform',
    'blog',
    'running',
    ['7c20be1', 'feat(editor): toolbar', 'm6', 0.2],
    [5, 9, 7, 12, 10, 15, 13, 16],
    'v1.8.4',
  ],
  [
    'mirror-acture/app',
    'mirror',
    'failing',
    ['51b8a07', 'chore: bump deps', 'm11', 2],
    [14, 11, 9, 6, 8, 5, 7, 4],
    'v0.9.0',
  ],
];

const commitSeed: [string, string, string, string, number, boolean][] = [
  ['renewberry/api', 'a41f9c2', 'fix(billing): retry failed webhooks', 'm4', 3, true],
  ['renewberry/api', 'e90d315', 'feat(auth): password reset', 'm5', 5, true],
  ['renewberry/api', '9be2c40', 'chore: release 2.3.1', 'm4', 48, true],
  ['renewberry/api', 'b71e0aa', 'refactor(invoices): extract retry policy', 'm4', 50, false],
  ['renewberry/web', 'c03e8b1', 'feat(account): payment method card', 'm9', 6, true],
  ['blog/platform', '7c20be1', 'feat(editor): toolbar', 'm6', 0.2, true],
  ['blog/platform', '3d19a0f', 'fix(seo): canonical urls', 'm8', 24, true],
  ['mirror-acture/app', '51b8a07', 'chore: bump deps', 'm11', 2, true],
  ['mirror-acture/app', '0f77d1a', 'feat(mirror): share sheet', 'm5', 144, false],
];

const protection: Record<string, boolean[]> = {
  'renewberry/api': [true, true, true, true],
  'renewberry/web': [true, true, false, true],
  'blog/platform': [true, true, true, true],
  'mirror-acture/app': [false, true, false, true],
};
const protectionLabels = [
  'Require 1 approving review',
  'Require status checks to pass',
  'Require signed commits',
  'Block force pushes to main',
];

const prSeed: [
  number,
  string,
  string,
  string,
  string | undefined,
  string,
  string[],
  CiStatus,
  ReviewState,
  number,
  number,
  number,
][] = [
  [
    148,
    'Add password reset flow',
    'renewberry/api',
    'feat/rb-212-password-reset',
    'RB-212',
    'm5',
    ['m4', 'm10'],
    'passing',
    'review-required',
    48,
    412,
    38,
  ],
  [
    152,
    'Retry failed payments with backoff',
    'renewberry/api',
    'fix/rb-221-retry-payments',
    'RB-221',
    'm4',
    ['m5'],
    'passing',
    'changes-requested',
    48,
    186,
    54,
  ],
  [
    153,
    'SEO meta fields per post',
    'blog/platform',
    'feat/bl-24-seo-meta',
    'BL-24',
    'm8',
    ['m6'],
    'running',
    'review-required',
    24,
    97,
    12,
  ],
  [
    47,
    'Session timeout copy',
    'mirror-acture/app',
    'chore/ma-36-timeout-copy',
    'MA-36',
    'm7',
    ['m10'],
    'failing',
    'review-required',
    24,
    24,
    9,
  ],
  [
    46,
    'Dark mode tokens',
    'mirror-acture/app',
    'feat/ma-35-dark-tokens',
    'MA-35',
    'm9',
    ['m7'],
    'passing',
    'approved',
    72,
    233,
    101,
  ],
  [
    151,
    'Editor toolbar',
    'blog/platform',
    'feat/bl-17-toolbar',
    'BL-17',
    'm6',
    ['m8'],
    'passing',
    'merged',
    0.2,
    640,
    210,
  ],
  [
    149,
    'Deduplicate billing webhooks',
    'renewberry/api',
    'fix/rb-209-webhook-dedupe',
    'RB-209',
    'm4',
    ['m10'],
    'passing',
    'merged',
    24,
    88,
    31,
  ],
  [
    150,
    'Bump web dependencies',
    'renewberry/web',
    'chore/deps-oct',
    undefined,
    'm7',
    ['m4'],
    'passing',
    'review-required',
    96,
    312,
    298,
  ],
];

const demoId = (name: string) => `demo-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
const fakeSha = (seed: string) => createHash('sha1').update(seed).digest('hex');

const conclusionFor: Record<CiStatus, [CiRun['status'], string | null]> = {
  passing: ['completed', 'success'],
  failing: ['completed', 'failure'],
  running: ['in_progress', null],
  none: ['queued', null],
};

export function demoAllowed(): boolean {
  return !config.isProd;
}

/** Seeds repos, PRs, CI runs and findings once (non-production, empty collections only). */
export function ensureGithubDemo() {
  if (!demoAllowed() || repos.size > 0) return;
  for (const [name, product, ci, [sha, message, author, h], weekly, tag] of repoSeed) {
    const commits = commitSeed
      .filter((c) => c[0] === name)
      .map(([, s, m, a, hh, signed]) => ({ sha: s, message: m, author: a, at: ago(hh), signed }));
    const repo: Repo = {
      id: demoId(name),
      name,
      product,
      defaultBranch: 'main',
      language: 'TypeScript',
      private: true,
      url: undefined,
      lastCommit: { sha, message, author, at: ago(h) },
      recentCommits: commits,
      weeklyCommits: [...weekly],
      weeklyAnchor: weekStart(),
      latestTag: tag,
      branchProtection: protectionLabels.map((label, i) => ({ label, ok: protection[name][i] })),
      linkedBy: SEEDED_BY,
      linkedAt: ago(24 * 30),
      updatedAt: ago(h),
      source: 'demo',
    };
    repos.set(repo.id, repo);
    const [status, conclusion] = conclusionFor[ci];
    const run: CiRun = {
      id: `${repo.id}-main`,
      repoId: repo.id,
      repo: name,
      product,
      kind: 'workflow_run',
      name: 'CI',
      branch: 'main',
      sha,
      event: 'push',
      status,
      conclusion,
      ci,
      prNumbers: [],
      startedAt: ago(h),
      ...(status === 'completed' ? { completedAt: ago(h - 0.1), durationSec: 360 } : {}),
      source: 'demo',
    };
    ciRuns.set(run.id, run);
  }

  for (const [
    number,
    title,
    repoName,
    branch,
    taskKey,
    author,
    reviewers,
    ci,
    review,
    h,
    add,
    del,
  ] of prSeed) {
    const repo = repos.get(demoId(repoName))!;
    const headSha = fakeSha(`${repoName}#${number}`);
    const pr: PullRequestRow = {
      id: `${repo.id}#${number}`,
      repoId: repo.id,
      repo: repoName,
      product: repo.product,
      number,
      title,
      branch,
      base: 'main',
      headSha,
      taskKey,
      author,
      reviewers,
      reviews:
        review === 'approved' || review === 'merged'
          ? [{ by: reviewers[0], state: 'approved', at: ago(Math.max(0.1, h - 1)) }]
          : review === 'changes-requested'
            ? [{ by: reviewers[0], state: 'changes_requested', at: ago(Math.max(0.1, h - 1)) }]
            : [],
      ci,
      review,
      state: review === 'merged' ? 'merged' : 'open',
      draft: false,
      additions: add,
      deletions: del,
      createdAt: ago(h),
      updatedAt: ago(Math.max(0.1, h - 1)),
      ...(review === 'merged' ? { mergedAt: ago(Math.max(0.1, h - 1)) } : {}),
      source: 'demo',
    };
    pulls.set(pr.id, pr);
    const [status, conclusion] = conclusionFor[ci];
    ciRuns.set(`${repo.id}-pr${number}`, {
      id: `${repo.id}-pr${number}`,
      repoId: repo.id,
      repo: repoName,
      product: repo.product,
      kind: 'workflow_run',
      name: 'CI',
      branch,
      sha: headSha,
      event: 'pull_request',
      status,
      conclusion,
      ci,
      prNumbers: [number],
      startedAt: ago(Math.max(0.1, h - 0.5)),
      ...(status === 'completed'
        ? { completedAt: ago(Math.max(0.05, h - 0.6)), durationSec: 300 }
        : {}),
      source: 'demo',
    });
  }

  for (const f of findingSeed) {
    const repo = repos.get(demoId(f.repo))!;
    const row: CodeFinding = {
      ...f,
      repoId: repo.id,
      product: repo.product,
      fingerprint: fakeSha(`${f.repo}|${f.kind}|${f.title}|${f.location}`),
      updatedAt: f.detectedAt,
      origin: 'demo',
      source: 'demo',
    };
    findings.set(row.id, row);
  }
}

type FindingSeed = Omit<
  CodeFinding,
  'repoId' | 'product' | 'fingerprint' | 'updatedAt' | 'origin' | 'source'
>;

const findingSeed: FindingSeed[] = [
  {
    id: 'SF-101',
    kind: 'dependency',
    severity: 'critical',
    title: 'jsonwebtoken signature bypass',
    repo: 'renewberry/api',
    location: 'package.json · jsonwebtoken@8.5.1',
    detail:
      'Versions below 9.0.0 accept tokens signed with insecure algorithms when the key type is not checked.',
    fix: 'Upgrade to jsonwebtoken@9.0.2',
    detectedAt: '2026-10-22T09:12:00.000Z',
    status: 'open',
    owner: 'm4',
    cve: 'CVE-2022-23529',
  },
  {
    id: 'SF-102',
    kind: 'secret',
    severity: 'high',
    title: 'Stripe test key committed',
    repo: 'renewberry/web',
    location: 'src/checkout/client.ts:14 · c03e8b1',
    detail: 'A Stripe key was pushed in a commit. Treat as compromised even if removed later.',
    fix: 'Key rotated by Kofi; purge from history',
    detectedAt: '2026-10-23T08:40:00.000Z',
    status: 'fixed',
    owner: 'm4',
  },
  {
    id: 'SF-103',
    kind: 'code',
    severity: 'high',
    title: 'SQL built from request input',
    repo: 'blog/platform',
    location: 'src/search/query.ts:31',
    detail: 'User-controlled `q` is concatenated into a raw SQL string.',
    fix: 'Use parameterised queries via db.sql``',
    detectedAt: '2026-10-21T15:02:00.000Z',
    status: 'open',
    owner: 'm6',
  },
  {
    id: 'SF-104',
    kind: 'dependency',
    severity: 'medium',
    title: 'express open redirect',
    repo: 'renewberry/api',
    location: 'package.json · express@4.19.2',
    detail: 'res.location() can redirect to attacker-controlled URLs with malformed input.',
    fix: 'Upgrade to express@4.21.1',
    detectedAt: '2026-10-20T11:30:00.000Z',
    status: 'open',
    owner: 'm5',
    cve: 'CVE-2024-43796',
  },
  {
    id: 'SF-105',
    kind: 'code',
    severity: 'medium',
    title: 'Missing rate limit on password reset',
    repo: 'renewberry/api',
    location: 'src/auth/reset.ts:5',
    detail: 'requestReset can be called without limits, enabling email bombing.',
    fix: 'Add per-IP and per-email rate limit (5/hour)',
    detectedAt: '2026-10-22T17:45:00.000Z',
    status: 'open',
    owner: 'm5',
  },
  {
    id: 'SF-106',
    kind: 'license',
    severity: 'low',
    title: 'GPL-3.0 dependency in client bundle',
    repo: 'mirror-acture/app',
    location: 'node_modules/fancy-charts',
    detail: 'Copyleft license conflicts with workspace policy for distributed code.',
    fix: 'Replace with an MIT-licensed charting library',
    detectedAt: '2026-10-18T10:00:00.000Z',
    status: 'open',
    owner: 'm7',
  },
  {
    id: 'SF-107',
    kind: 'dependency',
    severity: 'high',
    title: 'Prototype pollution in lodash.merge',
    repo: 'mirror-acture/app',
    location: 'package-lock.json · lodash.merge@4.6.1',
    detail: 'Crafted input can modify Object.prototype.',
    fix: 'Upgrade to lodash.merge@4.6.2',
    detectedAt: '2026-10-19T08:20:00.000Z',
    status: 'open',
    owner: 'm7',
    cve: 'CVE-2020-8203',
  },
  {
    id: 'SF-108',
    kind: 'code',
    severity: 'low',
    title: 'Verbose error leaks stack trace',
    repo: 'blog/platform',
    location: 'src/server/errors.ts:12',
    detail: 'Production responses include stack traces.',
    fix: 'Return generic messages when NODE_ENV=production',
    detectedAt: '2026-10-16T13:10:00.000Z',
    status: 'dismissed',
    owner: 'm8',
    dismissReason: 'Only reachable behind admin auth',
  },
];

// ── Monitors ────────────────────────────────────────────────────────────────

const monitorSeed: [
  string,
  ProductId,
  string,
  string,
  MonitorRow['kind'],
  UptimeTick,
  number,
  number[],
  number[],
  number[],
][] = [
  [
    'mo1',
    'renewberry',
    'RenewBerry API',
    'api.renewberry.app/health',
    'API',
    'degraded',
    412,
    [27],
    [28, 29],
    [180, 190, 175, 210, 205, 198, 240, 380, 412, 405],
  ],
  [
    'mo2',
    'renewberry',
    'RenewBerry Web',
    'renewberry.app',
    'HTTP',
    'up',
    182,
    [12],
    [],
    [170, 165, 180, 176, 190, 184, 172, 178, 181, 182],
  ],
  [
    'mo3',
    'blog',
    'Blog Web',
    'blog.app',
    'HTTP',
    'up',
    96,
    [],
    [],
    [102, 98, 95, 101, 97, 94, 99, 96, 93, 96],
  ],
  [
    'mo4',
    'blog',
    'Blog Media',
    'media.blog.app',
    'HTTP',
    'up',
    140,
    [25],
    [],
    [130, 128, 260, 140, 136, 133, 141, 138, 142, 140],
  ],
  [
    'mo5',
    'mirror',
    'Mirror Acture App',
    'mirroracture.io/health',
    'HTTP',
    'degraded',
    920,
    [28, 29],
    [14],
    [220, 240, 230, 260, 280, 300, 640, 880, 910, 920],
  ],
  [
    'mo6',
    'mirror',
    'Mirror sync worker',
    'cron · every 5 min',
    'Cron',
    'up',
    0,
    [],
    [],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ],
];

export function ensureMonitorDemo() {
  if (!demoAllowed() || monitors.size > 0) return;
  for (const [
    id,
    product,
    name,
    target,
    kind,
    status,
    responseMs,
    degraded,
    down,
    latency,
  ] of monitorSeed) {
    const created = ago(24 * 30);
    monitors.set(id, {
      id,
      product,
      name,
      target,
      url: kind === 'Cron' ? '' : `https://${target}`,
      kind,
      method: 'GET',
      intervalSec: 60,
      failureThreshold: 3,
      degradedMs: 400,
      expectStatus: [],
      paused: false,
      status,
      responseMs,
      consecutiveFailures: 0,
      lastCheckedAt: ago(0.01),
      nextCheckAt: 0,
      createdBy: SEEDED_BY,
      createdAt: created,
      updatedAt: ago(0.01),
      source: 'demo',
    });
    const checks: MonitorCheck[] = Array.from({ length: 30 }, (_, i) => {
      const s: UptimeTick = down.includes(i) ? 'down' : degraded.includes(i) ? 'degraded' : 'up';
      return {
        at: ago((30 - i) * 0.5),
        status: s,
        responseMs: latency[Math.max(0, i - 20)] ?? responseMs,
        ...(s === 'down' ? { error: 'Demo: simulated failure' } : {}),
      };
    });
    monitorHistory.set(id, { monitorId: id, checks });
  }
}
