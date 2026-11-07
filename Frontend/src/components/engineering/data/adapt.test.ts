import { describe, expect, it } from 'vitest';
import {
  checkList,
  ciList,
  findingList,
  hookList,
  integrationList,
  monitorList,
  pullList,
  repoList,
  toCheck,
  toCiRun,
  toDelivery,
  toFinding,
  toGitHubApp,
  toHook,
  toHookCreated,
  toIntegration,
  toMonitor,
  toPull,
  toPullDetail,
  toRepo,
  toRepoDetail,
  type WireCiRun,
  type WireDelivery,
  type WireFinding,
  type WireHook,
  type WireMonitor,
  type WirePull,
  type WireRepo,
} from './adapt';

const repo: WireRepo = {
  id: 'r1',
  name: 'devhq/renewberry',
  product: 'renewberry',
  defaultBranch: 'main',
};

const run = (over: Partial<WireCiRun> = {}): WireCiRun => ({
  id: 'run1',
  repoId: 'r1',
  repo: 'devhq/renewberry',
  name: 'CI',
  branch: 'main',
  sha: 'abc1234',
  status: 'completed',
  conclusion: 'success',
  startedAt: '2026-11-01T10:00:00Z',
  ...over,
});

const pull: WirePull = {
  repoId: 'r1',
  repo: 'devhq/renewberry',
  number: 148,
  title: 'Retry payments',
  product: 'renewberry',
  state: 'open',
  branch: 'rb-221-retry',
  author: 'm4',
  reviewers: ['m5'],
  ci: 'passing',
  review: 'pending' as WirePull['review'],
  createdAt: '2026-11-01T09:00:00Z',
};

describe('engineering/adapt — repos', () => {
  it('maps the minimal wire repo without inventing values', () => {
    const r = toRepo(repo);
    expect(r).toMatchObject({
      id: 'r1',
      name: 'devhq/renewberry',
      product: 'renewberry',
      defaultBranch: 'main',
    });
    for (const k of [
      'language',
      'url',
      'openPrs',
      'ci',
      'lastCommit',
      'latestTag',
      'weeklyCommits',
      'source',
    ] as const)
      expect(r[k], k).toBeUndefined();
  });

  it('turns null/empty optional fields into undefined', () => {
    const r = toRepo({ ...repo, url: null, language: '', latestTag: '' });
    expect(r.url).toBeUndefined();
    expect(r.language).toBeUndefined();
    expect(r.latestTag).toBeUndefined();
  });

  it('keeps a last commit only when it has a sha and a timestamp', () => {
    const c = { sha: 'abc', message: 'fix', author: 'm4', at: '2026-11-01T00:00:00Z' };
    expect(toRepo({ ...repo, lastCommit: c }).lastCommit).toEqual(c);
    expect(toRepo({ ...repo, lastCommit: { ...c, at: null } }).lastCommit).toBeUndefined();
    expect(toRepo({ ...repo, lastCommit: { ...c, sha: '' } }).lastCommit).toBeUndefined();
  });

  it('detail drops undated commits, maps runs and nulls branch protection to undefined', () => {
    const d = toRepoDetail({
      ...repo,
      commits: [
        { sha: 'a', message: 'one', author: 'm4', at: '2026-11-01T00:00:00Z' },
        { sha: 'b', message: 'two', author: 'm4', at: null },
      ],
      branchProtection: null,
      recentRuns: [run()],
    });
    expect((d.recentCommits ?? []).map((c) => c.sha)).toEqual(['a']);
    expect(d.branchProtection).toBeUndefined();
    expect(d.recentRuns?.[0]?.status).toBe('passed');
    expect(toRepoDetail(repo)).toMatchObject({ recentCommits: [], recentRuns: [] });
  });

  it('list adapters accept {items,nextCursor,source}, bare arrays and undefined', () => {
    expect(repoList({ items: [repo], nextCursor: 'c2', source: 'demo' })).toMatchObject({
      items: [{ id: 'r1' }],
      nextCursor: 'c2',
      source: 'demo',
    });
    expect(repoList([repo]).items).toHaveLength(1);
    expect(repoList(undefined)).toEqual({ items: [] });
    expect(repoList({ items: [] }).nextCursor).toBeNull();
  });
});

describe('engineering/adapt — CI runs', () => {
  it.each<[Partial<WireCiRun>, string]>([
    [{ status: 'queued', conclusion: null }, 'queued'],
    [{ status: 'in_progress', conclusion: null }, 'running'],
    [{ conclusion: 'success' }, 'passed'],
    [{ conclusion: 'neutral' }, 'passed'],
    [{ conclusion: 'skipped' }, 'passed'],
    [{ conclusion: 'cancelled' }, 'cancelled'],
    [{ conclusion: 'failure' }, 'failed'],
    [{ conclusion: 'timed_out' }, 'failed'],
    [{ conclusion: 'action_required' }, 'failed'],
    [{ conclusion: null, ci: 'failing' }, 'failed'],
  ])('%o → %s', (over, status) => {
    expect(toCiRun(run(over)).status).toBe(status);
  });

  it('renames fields, converts seconds to ms and takes the first PR', () => {
    const r = toCiRun(
      run({
        durationSec: 42,
        prNumbers: [148, 150],
        completedAt: '2026-11-01T10:01:00Z',
        url: null,
      }),
    );
    expect(r).toMatchObject({
      workflow: 'CI',
      durationMs: 42_000,
      pr: 148,
      finishedAt: '2026-11-01T10:01:00Z',
    });
    expect(r.url).toBeUndefined();
    expect(toCiRun(run()).durationMs).toBeUndefined();
    expect(toCiRun(run({ durationSec: 0 })).durationMs).toBe(0);
    expect(ciList([run(), run({ id: 'run2' })]).items.map((x) => x.id)).toEqual(['run1', 'run2']);
  });
});

describe('engineering/adapt — pull requests', () => {
  it('passes the PR through with url null → undefined', () => {
    expect(toPull({ ...pull, url: null }).url).toBeUndefined();
    expect(toPull({ ...pull, url: 'https://github.com/x/y/pull/148' }).url).toBe(
      'https://github.com/x/y/pull/148',
    );
    expect(pullList({ items: [pull] }).items[0].number).toBe(148);
  });

  it('maps review states to decisions and drops dismissed reviews', () => {
    const d = toPullDetail({
      ...pull,
      reviews: [
        { by: 'm5', state: 'approved', at: 't1' },
        { by: 'm7', state: 'changes_requested', at: 't2', body: 'nit' },
        { by: 'm9', state: 'commented', at: 't3' },
        { by: 'm2', state: 'dismissed', at: 't4' },
      ],
      checks: [run({ conclusion: 'failure' })],
    });
    expect((d.reviews ?? []).map((r) => [r.by, r.decision])).toEqual([
      ['m5', 'approve'],
      ['m7', 'request-changes'],
      ['m9', 'comment'],
    ]);
    expect(d.reviews?.[1]?.body).toBe('nit');
    expect(d.checks?.[0]?.status).toBe('failed');
    expect(toPullDetail(pull)).toMatchObject({ reviews: [], checks: [] });
  });
});

describe('engineering/adapt — monitors', () => {
  const mon: WireMonitor = {
    id: 'mon1',
    product: 'renewberry',
    name: 'API',
    url: 'https://api.example.test/health',
    status: 'up' as WireMonitor['status'],
    intervalSec: 60,
    responseMs: 120,
    uptime: 100,
  };

  it('does not present latency or uptime that were never measured', () => {
    const m = toMonitor(mon);
    expect(m.lastLatencyMs).toBeUndefined();
    expect(m.uptimePct).toBeUndefined();
    const measured = toMonitor({
      ...mon,
      lastCheckedAt: '2026-11-01T00:00:00Z',
      checksStored: 10,
      uptime: 99.5,
    });
    expect(measured.lastLatencyMs).toBe(120);
    expect(measured.uptimePct).toBe(99.5);
  });

  it('maps expectStatus, incident and demo read-only flag', () => {
    const m = toMonitor({
      ...mon,
      expectStatus: [204, 200],
      openIncidentId: 'INC-40',
      source: 'demo',
    });
    expect(m).toMatchObject({
      expectedStatus: 204,
      incidentId: 'INC-40',
      readOnly: true,
      source: 'demo',
    });
    expect(toMonitor(mon).readOnly).toBe(false);
    expect(monitorList([mon]).items).toHaveLength(1);
  });

  it('checks: only "down" is not ok', () => {
    expect(toCheck({ at: 't', status: 'up', responseMs: 10 })).toMatchObject({
      ok: true,
      latencyMs: 10,
    });
    expect(toCheck({ at: 't', status: 'degraded' }).ok).toBe(true);
    expect(toCheck({ at: 't', status: 'down', error: 'timeout' })).toMatchObject({
      ok: false,
      error: 'timeout',
    });
    expect(checkList({ items: [{ at: 't', status: 'up' }] }).items[0].status).toBe('up');
  });
});

describe('engineering/adapt — integrations and webhooks', () => {
  it('maps not-connected to available and keeps events as scopes', () => {
    const i = toIntegration({
      id: 'i1',
      kind: 'slack',
      name: 'Slack',
      status: 'not-connected',
      events: ['deploy'],
    });
    expect(i).toMatchObject({ status: 'available', scopes: ['deploy'], events: ['deploy'] });
    expect(
      toIntegration({ id: 'i2', kind: 'gh', name: 'GitHub', status: 'degraded', detail: 'x' }),
    ).toMatchObject({
      status: 'degraded',
      description: 'x',
    });
    expect(integrationList({ items: [], events: ['a'] })).toEqual({
      items: [],
      nextCursor: null,
      source: undefined,
    });
  });

  const delivery = (over: Partial<WireDelivery> = {}): WireDelivery => ({
    id: 'dl1',
    event: 'deploy.succeeded',
    status: 200,
    state: 'succeeded',
    attempts: 1,
    nextAttemptAt: null,
    error: null,
    webhookId: 'wh1',
    createdAt: 't0',
    updatedAt: 't1',
    duration: '120ms',
    ...over,
  });

  it('deliveries: parse duration, status 0 → undefined, nulls → undefined', () => {
    expect(toDelivery(delivery())).toMatchObject({
      ok: true,
      httpStatus: 200,
      durationMs: 120,
      at: 't1',
      attempt: 1,
    });
    const pending = toDelivery(
      delivery({
        status: 0,
        state: 'pending',
        attempts: 0,
        duration: undefined,
        nextAttemptAt: 't9',
      }),
    );
    expect(pending).toMatchObject({
      ok: false,
      httpStatus: undefined,
      durationMs: undefined,
      nextRetryAt: 't9',
    });
    expect(toDelivery(delivery({ duration: 'n/a' })).durationMs).toBeUndefined();
    expect(toDelivery(delivery({ state: 'failed', error: 'HTTP 500' })).error).toBe('HTTP 500');
  });

  const hook: WireHook = {
    id: 'wh1',
    integrationId: 'i1',
    url: 'https://hooks.example.test/x',
    events: ['deploy.succeeded'],
    active: true,
    createdAt: 't0',
  };

  it('hooks get only their own deliveries; null url becomes empty string', () => {
    const list = hookList({
      items: [hook, { ...hook, id: 'wh2', url: null }],
      deliveries: [delivery(), delivery({ id: 'dl2', webhookId: 'wh2' }), delivery({ id: 'dl3' })],
    });
    expect((list.items[0]?.deliveries ?? []).map((d) => d.id)).toEqual(['dl1', 'dl3']);
    expect((list.items[1]?.deliveries ?? []).map((d) => d.id)).toEqual(['dl2']);
    expect(list.items[1].url).toBe('');
    expect(hookList(undefined)).toEqual({ items: [], nextCursor: null });
    expect(toHook(hook).deliveries).toEqual([]);
  });

  it('the signing secret is surfaced only on the create response', () => {
    expect(toHookCreated({ ...hook, signingSecret: 'whsec_1' }).secret).toBe('whsec_1');
    expect('secret' in toHook(hook)).toBe(false);
  });
});

describe('engineering/adapt — GitHub App', () => {
  it('installed when an installation exists or the server runs as app/token', () => {
    expect(toGitHubApp({ mode: 'unconfigured', configured: false }).installed).toBe(false);
    expect(toGitHubApp({ mode: 'demo', configured: false }).installed).toBe(false);
    expect(toGitHubApp({ mode: 'token', configured: true }).installed).toBe(true);
    const app = toGitHubApp({
      mode: 'webhook-only',
      configured: true,
      installations: [
        { id: 7, account: 'devhq', suspended: false, repositories: ['a'], createdAt: 't0' },
      ],
    });
    expect(app).toMatchObject({
      installed: true,
      account: 'devhq',
      installationId: 7,
      installedAt: 't0',
      suspended: false,
    });
    expect(app.repositorySelection).toBeUndefined();
  });
});

describe('engineering/adapt — code findings', () => {
  const finding = (over: Partial<WireFinding> = {}): WireFinding => ({
    id: 'f1',
    kind: 'secret' as WireFinding['kind'],
    severity: 'high' as WireFinding['severity'],
    title: 'AWS key',
    repoId: 'r1',
    repo: 'devhq/renewberry',
    detectedAt: 't0',
    status: 'open' as WireFinding['status'],
    ...over,
  });

  it('splits file:line and only accepts a numeric line', () => {
    expect(toFinding(finding({ location: 'src/config.ts:42' }))).toMatchObject({
      file: 'src/config.ts',
      line: 42,
    });
    expect(toFinding(finding({ location: 'src/config.ts:42:7' }))).toMatchObject({
      file: 'src/config.ts',
      line: 42,
    });
    expect(toFinding(finding({ location: 'package.json' }))).toMatchObject({
      file: 'package.json',
      line: undefined,
    });
    expect(toFinding(finding({ location: 'a.ts:x' })).line).toBeUndefined();
    expect(toFinding(finding())).toMatchObject({ file: undefined, line: undefined });
  });

  it('advisory prefers the CVE, then the rule id', () => {
    expect(toFinding(finding({ cve: 'CVE-2026-1', ruleId: 'r' })).advisory).toBe('CVE-2026-1');
    expect(toFinding(finding({ ruleId: 'aws-key' })).advisory).toBe('aws-key');
    expect(findingList({ items: [finding()] }).items).toHaveLength(1);
  });
});
