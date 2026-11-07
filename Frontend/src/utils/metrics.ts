import { NOW, addDays, endOfDay, formatDay, parseWhen, startOfDay } from './date';
import type { Task, TaskEvent } from '../types/work';
import type { Deployment, Incident, Monitor } from '../types/operations';
import type { PastIncident } from '../data/incidentHistory';
import type { ProductId } from '../types/portfolio';

const DAY = 86_400_000;

/**
 * Whole days back from the relative label the API sends ("3d ago", "4h ago", "now").
 * Anything under a day counts as today, so a fresh deploy lands in the current bucket.
 */
const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Whole days since a relative label: "3d", "2w", "3d ago" (relative()), "just now",
 * minutes/hours (0), or a "Oct 2" day label for anything older (F-FE-1).
 */
export function daysAgo(ago: string): number {
  const s = ago.trim();
  if (s === 'now' || s === 'just now') return 0;
  const rel = /^(\d+)\s*([mhdw])(?:\s+ago)?$/.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    return rel[2] === 'd' ? n : rel[2] === 'w' ? n * 7 : 0;
  }
  const day = /^([A-Z][a-z]{2}) (\d{1,2})$/.exec(s);
  if (day && MONTH_ABBR.includes(day[1])) {
    let d = new Date(NOW.getFullYear(), MONTH_ABBR.indexOf(day[1]), Number(day[2]));
    if (d > NOW) d = new Date(NOW.getFullYear() - 1, d.getMonth(), d.getDate());
    return Math.max(0, Math.round((startOfDay(NOW).getTime() - d.getTime()) / 86_400_000));
  }
  return 0;
}

export interface Bucket {
  start: Date;
  end: Date;
  label: string;
}

/** Up to `max` week-long buckets ending at the end of the range (or today). */
export function weekBuckets(from: Date, to: Date, max = 8): Bucket[] {
  const end = to < NOW ? to : NOW;
  const out: Bucket[] = [];
  let bEnd = endOfDay(end);
  for (let i = 0; i < max; i++) {
    const bStart = startOfDay(addDays(bEnd, -6));
    out.unshift({ start: bStart, end: bEnd, label: formatDay(bStart) });
    if (bStart <= from) break;
    bEnd = new Date(bStart.getTime() - 1);
  }
  return out;
}

const inBucket = (d: Date, b: Bucket) => d >= b.start && d <= b.end;

export function doneEvent(events: TaskEvent[], key: string) {
  return events
    .filter((e) => e.taskKey === key && e.kind === 'status' && e.to === 'done')
    .sort((a, b) => b.at.localeCompare(a.at))[0];
}

/** Tasks moved to Done per week. */
export function throughputByWeek(events: TaskEvent[], keys: Set<string>, buckets: Bucket[]) {
  const done = events
    .filter((e) => keys.has(e.taskKey) && e.kind === 'status' && e.to === 'done')
    .map((e) => new Date(e.at));
  return buckets.map((b) => done.filter((d) => inBucket(d, b)).length);
}

/** Days from first "In progress" (or creation) to Done, using the task history. */
export function cycleTimeDays(events: TaskEvent[], key: string): number | null {
  const own = events.filter((e) => e.taskKey === key).sort((a, b) => a.at.localeCompare(b.at));
  const done = [...own].reverse().find((e) => e.kind === 'status' && e.to === 'done');
  if (!done) return null;
  const start =
    own.find((e) => e.kind === 'status' && e.to === 'in-progress') ??
    own.find((e) => e.kind === 'created');
  if (!start) return null;
  return Math.max(0.1, (new Date(done.at).getTime() - new Date(start.at).getTime()) / DAY);
}

export function cycleTimes(events: TaskEvent[], keys: Set<string>, inRange: (d: Date) => boolean) {
  const out: number[] = [];
  keys.forEach((k) => {
    const d = doneEvent(events, k);
    if (!d || !inRange(new Date(d.at))) return;
    const c = cycleTimeDays(events, k);
    if (c !== null) out.push(c);
  });
  return out;
}

export function median(values: number[]) {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const cycleBands = [
  { label: '<1d', max: 1 },
  { label: '1–3d', max: 3 },
  { label: '3–7d', max: 7 },
  { label: '1–2w', max: 14 },
  { label: '2w+', max: Infinity },
];

export function cycleHistogram(values: number[]) {
  return cycleBands.map(
    (b, i) => values.filter((v) => v < b.max && (i === 0 || v >= cycleBands[i - 1].max)).length,
  );
}

/** Open overdue tasks at the end of each sampled day. */
export function overdueSeries(
  tasks: Task[],
  events: TaskEvent[],
  from: Date,
  to: Date,
  points = 10,
) {
  const end = to < NOW ? to : NOW;
  const start = from > addDays(end, -42) ? from : addDays(end, -42);
  const span = Math.max(1, (end.getTime() - start.getTime()) / DAY);
  const days = Array.from({ length: points }, (_, i) =>
    endOfDay(addDays(start, (span * i) / (points - 1))),
  );
  const doneAt = new Map(tasks.map((t) => [t.key, doneEvent(events, t.key)?.at]));
  const values = days.map(
    (d) =>
      tasks.filter((t) => {
        if (t.createdAt && new Date(t.createdAt) > d) return false;
        if (parseWhen(t.due) >= startOfDay(d)) return false;
        const done = doneAt.get(t.key);
        if (t.status === 'done' && !done) return false;
        return !done || new Date(done) > d;
      }).length,
  );
  return { values, labels: days.map(formatDay) };
}

export function parseDurationMinutes(s: string) {
  const h = s.match(/(\d+)\s*h/);
  const m = s.match(/(\d+)\s*m/);
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
}

export function formatDuration(min: number) {
  if (!min) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h ${m ? `${m}m` : ''}`.trim() : `${m}m`;
}

export interface IncidentRecord {
  id: string;
  product: ProductId;
  severity: 'SEV1' | 'SEV2' | 'SEV3';
  service: string;
  started: Date;
  minutes: number | null;
}

export function incidentRecords(current: Incident[], past: PastIncident[] = []): IncidentRecord[] {
  return [
    ...current.map((i) => ({
      id: i.id,
      product: i.product,
      severity: i.severity,
      service: i.service,
      started: parseWhen(i.started),
      minutes: i.status === 'resolved' ? parseDurationMinutes(i.duration) : null,
    })),
    ...past.map((p) => ({
      id: p.id,
      product: p.product,
      severity: p.severity,
      service: p.service,
      started: parseWhen(p.started),
      minutes: p.minutes,
    })),
  ];
}

export function mttr(records: IncidentRecord[]) {
  const r = records.filter((x) => x.minutes !== null).map((x) => x.minutes as number);
  return r.length ? r.reduce((s, x) => s + x, 0) / r.length : 0;
}

export function incidentsPerBucket(records: IncidentRecord[], buckets: Bucket[]) {
  return buckets.map((b) => records.filter((r) => inBucket(r.started, b)).length);
}

/** Average time-to-resolve per bucket; empty weeks carry the previous value so the line stays honest. */
export function mttrPerBucket(records: IncidentRecord[], buckets: Bucket[]) {
  let prev = 0;
  return buckets.map((b) => {
    const v = mttr(records.filter((r) => inBucket(r.started, b)));
    if (v) prev = v;
    return Math.round(prev);
  });
}

export function severityCounts(records: IncidentRecord[]) {
  return {
    SEV1: records.filter((r) => r.severity === 'SEV1').length,
    SEV2: records.filter((r) => r.severity === 'SEV2').length,
    SEV3: records.filter((r) => r.severity === 'SEV3').length,
  };
}

export function deployStats(list: Deployment[], inRange: (d: Date) => boolean) {
  const scoped = list.filter((d) => inRange(parseWhen(d.ago)));
  const finished = scoped.filter((d) => d.status !== 'running' && d.status !== 'awaiting-approval');
  const failed = finished.filter((d) => d.status === 'failed' || d.status === 'rolled-back').length;
  return {
    total: scoped.length,
    failed,
    rate: finished.length ? (failed / finished.length) * 100 : 0,
  };
}

export function uptimeAvg(list: Monitor[]) {
  return list.length ? list.reduce((s, m) => s + m.uptime, 0) / list.length : 100;
}

export function weekDelta(values: number[], higherIsGood = true) {
  if (values.length < 2) return undefined;
  const a = values[values.length - 2];
  const b = values[values.length - 1];
  if (a === b) return undefined;
  const up = b > a;
  return { label: `${up ? '+' : '−'}${Math.abs(b - a)} wk`, up, good: higherIsGood ? up : !up };
}
