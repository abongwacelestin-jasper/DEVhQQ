import { describe, expect, it } from 'vitest';
import type { Task, TaskEvent } from '../types/work';
import type { Deployment, Incident, Monitor } from '../types/operations';
import { NOW, addDays, relative } from './date';
import {
  cycleBands,
  cycleHistogram,
  cycleTimeDays,
  cycleTimes,
  daysAgo,
  deployStats,
  doneEvent,
  formatDuration,
  incidentRecords,
  incidentsPerBucket,
  median,
  mttr,
  mttrPerBucket,
  overdueSeries,
  parseDurationMinutes,
  severityCounts,
  throughputByWeek,
  uptimeAvg,
  weekBuckets,
  weekDelta,
} from './metrics';

const oct = (d: number, h = 12) => new Date(2026, 9, d, h);
let seq = 0;
const ev = (taskKey: string, kind: TaskEvent['kind'], at: Date, to?: string): TaskEvent => ({
  id: `e${seq++}`,
  taskKey,
  actor: 'm1',
  at: at.toISOString(),
  kind,
  to,
});
const task = (key: string, patch: Partial<Task> = {}): Task => ({
  key,
  title: key,
  product: 'renewberry',
  projectId: 'p1',
  type: 'task',
  status: 'backlog',
  priority: 'medium',
  assignee: 'm4',
  due: 'Oct 10',
  estimate: 1,
  comments: 0,
  createdAt: new Date(2026, 8, 1).toISOString(),
  ...patch,
});
const deployment = (ago: string, status: Deployment['status']): Deployment => ({
  id: `d-${ago}-${status}`,
  product: 'renewberry',
  env: 'production',
  sha: 'abc1234',
  message: 'm',
  author: 'm4',
  provider: 'GitHub Actions',
  status,
  ago,
  duration: '2m',
});
const incident = (patch: Partial<Incident>): Incident => ({
  id: 'INC-1',
  product: 'renewberry',
  title: 'API errors',
  severity: 'SEV2',
  status: 'resolved',
  owner: 'm11',
  started: '2d ago',
  duration: '1h 30m',
  service: 'renewberry-api',
  impact: 'Some users',
  events: [],
  nextSteps: [],
  ...patch,
});
const monitor = (uptime: number): Monitor => ({
  id: `mon-${uptime}`,
  product: 'renewberry',
  name: 'api',
  target: 'https://example.test',
  kind: 'HTTP',
  status: 'up',
  responseMs: 100,
  uptime,
  ticks: [],
  latency: [],
});

describe('daysAgo', () => {
  it.each([
    ['now', 0],
    ['3d', 3],
    ['2w', 14],
    ['4h', 0],
    ['12m', 0],
    ['garbage', 0],
  ])('%s → %i', (input, days) => {
    expect(daysAgo(input)).toBe(days);
  });

  // FINDING F-FE-1: daysAgo only recognises bare "3d"/"2w". The labels the API
  // adapter produces (hooks/useDeployments.ts → relative()) are "3d ago" and,
  // past two weeks, "Oct 2". Both return 0, so every API deployment is counted
  // as "today": DeployFrequencyChart puts them all in today's bar and the
  // overview's "failed in the last 7 days" counts failures of any age.
  it.fails('understands the "Nd ago" labels produced by relative() (F-FE-1)', () => {
    expect(daysAgo('3d ago')).toBe(3);
    expect(daysAgo(relative(addDays(NOW, -5)))).toBe(5);
    expect(daysAgo(relative(addDays(NOW, -20)))).toBeGreaterThanOrEqual(7);
  });
});

describe('weekBuckets', () => {
  it('builds contiguous 7-day buckets ending today and covering the range', () => {
    const b = weekBuckets(addDays(NOW, -20), NOW);
    expect(b.map((x) => x.label)).toEqual(['Oct 3', 'Oct 10', 'Oct 17']);
    expect(b[2].end).toEqual(new Date(2026, 9, 23, 23, 59, 59, 999));
    for (let i = 1; i < b.length; i++) expect(b[i].start.getTime()).toBe(b[i - 1].end.getTime() + 1);
  });

  it('never extends past NOW and respects max', () => {
    const future = weekBuckets(addDays(NOW, -200), addDays(NOW, 30), 4);
    expect(future).toHaveLength(4);
    expect(future[3].end).toEqual(new Date(2026, 9, 23, 23, 59, 59, 999));
  });
});

describe('task flow metrics', () => {
  const events = [
    ev('A', 'created', oct(1)),
    ev('A', 'status', oct(3), 'in-progress'),
    ev('A', 'status', oct(8), 'done'),
    ev('B', 'created', oct(10)),
    ev('B', 'status', oct(12), 'done'),
    ev('C', 'created', oct(20)),
    ev('D', 'status', oct(21), 'done'),
  ];

  it('doneEvent returns the latest move to done', () => {
    const reopened = [...events, ev('A', 'status', oct(9), 'in-progress'), ev('A', 'status', oct(15), 'done')];
    expect(doneEvent(reopened, 'A')?.at).toBe(oct(15).toISOString());
    expect(doneEvent(events, 'C')).toBeUndefined();
  });

  it('cycleTimeDays measures from first in-progress (or creation) to done', () => {
    expect(cycleTimeDays(events, 'A')).toBe(5);
    expect(cycleTimeDays(events, 'B')).toBe(2);
    expect(cycleTimeDays(events, 'C')).toBeNull(); // not done
    expect(cycleTimeDays(events, 'D')).toBeNull(); // no start
    const instant = [ev('E', 'created', oct(5)), ev('E', 'status', oct(5), 'done')];
    expect(cycleTimeDays(instant, 'E')).toBe(0.1);
  });

  it('cycleTimes keeps only tasks done inside the range', () => {
    const keys = new Set(['A', 'B', 'C', 'D']);
    expect(cycleTimes(events, keys, () => true).sort()).toEqual([2, 5]);
    expect(cycleTimes(events, keys, (d) => d >= oct(10, 0))).toEqual([2]);
  });

  it('throughputByWeek counts done moves per bucket for the selected tasks only', () => {
    const buckets = weekBuckets(addDays(NOW, -20), NOW);
    expect(throughputByWeek(events, new Set(['A', 'B', 'D']), buckets)).toEqual([1, 1, 1]);
    expect(throughputByWeek(events, new Set(['B']), buckets)).toEqual([0, 1, 0]);
  });

  it('overdueSeries counts open overdue tasks at the end of each sampled day', () => {
    const tasks = [
      task('A'), // due Oct 10, still open
      task('B', { status: 'done' }), // due Oct 10, done Oct 14
      task('C', { status: 'done' }), // done without a recorded event: never counted
      task('D', { due: 'Oct 1', createdAt: oct(20).toISOString() }), // created late
    ];
    const done = [ev('B', 'status', oct(14), 'done')];
    const s = overdueSeries(tasks, done, new Date(2026, 9, 9), NOW, 3);
    expect(s.labels).toEqual(['Oct 9', 'Oct 16', 'Oct 23']);
    expect(s.values).toEqual([0, 1, 2]);
  });
});

describe('statistics helpers', () => {
  it('median', () => {
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('cycleHistogram puts each value in exactly one band (lower bound inclusive)', () => {
    const values = [0.5, 1, 2.9, 3, 7, 13.9, 14, 100];
    const h = cycleHistogram(values);
    expect(h).toEqual([1, 2, 1, 2, 2]);
    expect(h).toHaveLength(cycleBands.length);
    for (let n = 0; n < 200; n++) {
      const sample = Array.from({ length: n % 17 }, (_, i) => ((i * 7919 + n * 31) % 4000) / 100);
      expect(cycleHistogram(sample).reduce((a, b) => a + b, 0)).toBe(sample.length);
    }
  });

  it('weekDelta compares the last two points', () => {
    expect(weekDelta([1])).toBeUndefined();
    expect(weekDelta([2, 2])).toBeUndefined();
    expect(weekDelta([2, 5])).toEqual({ label: '+3 wk', up: true, good: true });
    expect(weekDelta([2, 5], false)).toEqual({ label: '+3 wk', up: true, good: false });
    expect(weekDelta([5, 2])).toEqual({ label: '−3 wk', up: false, good: false });
  });
});

describe('durations', () => {
  it.each([
    ['1h 30m', 90],
    ['45m', 45],
    ['2h', 120],
    ['', 0],
    ['—', 0],
  ])('parseDurationMinutes(%j) = %i', (s, m) => {
    expect(parseDurationMinutes(s)).toBe(m);
  });

  it.each([
    [0, '—'],
    [45, '45m'],
    [60, '1h'],
    [90, '1h 30m'],
    [125.4, '2h 5m'],
  ])('formatDuration(%d) = %s', (m, s) => {
    expect(formatDuration(m)).toBe(s);
  });

  it('round-trips whole minutes', () => {
    for (let m = 1; m < 600; m += 7) expect(parseDurationMinutes(formatDuration(m))).toBe(m);
  });
});

describe('incidents', () => {
  const records = incidentRecords(
    [
      incident({ id: 'INC-1', started: '2d ago', duration: '1h 30m', severity: 'SEV1' }),
      incident({ id: 'INC-2', status: 'investigating', started: '3h ago', severity: 'SEV2' }),
    ],
    [
      {
        id: 'P-1',
        product: 'blog',
        severity: 'SEV3',
        service: 'blog-web',
        title: 't',
        started: 'Oct 5',
        minutes: 30,
        owner: 'm6',
      },
    ],
  );

  it('normalises current and past incidents; open ones have no duration', () => {
    expect(records.map((r) => [r.id, r.minutes])).toEqual([
      ['INC-1', 90],
      ['INC-2', null],
      ['P-1', 30],
    ]);
    expect(records[2].started).toEqual(new Date(2026, 9, 5));
  });

  it('mttr averages resolved incidents only', () => {
    expect(mttr(records)).toBe(60);
    expect(mttr([])).toBe(0);
    expect(severityCounts(records)).toEqual({ SEV1: 1, SEV2: 1, SEV3: 1 });
  });

  it('per-bucket counts and MTTR carry the last value through empty weeks', () => {
    const buckets = weekBuckets(addDays(NOW, -20), NOW);
    expect(incidentsPerBucket(records, buckets)).toEqual([1, 0, 2]);
    expect(mttrPerBucket(records, buckets)).toEqual([30, 30, 90]);
  });
});

describe('deployments and monitors', () => {
  it('deployStats counts failures over finished deploys in range', () => {
    const list = [
      deployment('2d', 'succeeded'),
      deployment('3d', 'failed'),
      deployment('4d', 'rolled-back'),
      deployment('1d', 'running'),
      deployment('1h', 'awaiting-approval'),
      deployment('30d', 'failed'),
    ];
    const lastWeek = (d: Date) => d >= addDays(NOW, -7);
    expect(deployStats(list, lastWeek)).toEqual({ total: 5, failed: 2, rate: (2 / 3) * 100 });
    expect(deployStats([], lastWeek)).toEqual({ total: 0, failed: 0, rate: 0 });
  });

  it('uptimeAvg is the mean, and 100 when there is nothing to measure', () => {
    expect(uptimeAvg([monitor(99), monitor(97)])).toBe(98);
    expect(uptimeAvg([])).toBe(100);
  });
});
