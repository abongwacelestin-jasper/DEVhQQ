/**
 * Feature computation for the ML service.
 *
 * The same functions build the online prediction payloads and the training
 * export (`GET /api/insights/_export`), so what a model is trained on and what
 * it is asked about cannot drift apart. The Python side validates these rows
 * strictly (Models/devhq_models/features/schema.py — keep the field names in
 * sync; unknown fields are rejected there).
 *
 * Privacy: rows contain no names, emails, IP addresses, cities or free text.
 * Only derived numbers and categories leave the backend.
 */

import { db } from '../../store/db.ts';
import { repos } from '../../data/index.ts';
import { distanceKm } from '../../lib/geo.ts';
import type { Deployment, SignInRecord, Task, TaskComment, TaskEvent } from '../../types.ts';

const DAY = 86_400_000;
const HOUR = 3_600_000;

export interface TaskFeatures {
  estimate: number;
  type: Task['type'];
  priority: Task['priority'];
  status: Task['status'];
  statusAgeDays: number;
  ageDays: number;
  daysToDue: number;
  blocked: boolean;
  comments: number;
  subtasksTotal: number;
  subtasksDone: number;
  loggedHours: number;
  assigneeOpenTasks: number;
  assigneeThroughput30d: number;
  assigneeLateRate: number;
}

export interface DeployFeatures {
  env: Deployment['env'];
  provider: string;
  hourUtc: number;
  weekday: number;
  requesterDeploys90d: number;
  requesterFailureRate: number;
  productFailureRate30d: number;
  productIncidents7d: number;
  openIncidents: number;
  hoursSinceLastDeploy: number;
}

export interface SigninFeatures {
  org: string;
  hourUtc: number;
  weekday: number;
  distanceKmFromUsual: number;
  network: SignInRecord['location']['network'];
  newDevice: boolean;
  velocityKmh: number;
  newCountry: boolean;
}

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const ms = (iso: string) => new Date(iso).getTime();
/** Monday = 0, matching Python's datetime.weekday(). */
const weekday = (t: number) => (new Date(t).getUTCDay() + 6) % 7;

// ── Tasks ──────────────────────────────────────────────────────

/**
 * Task rows the features are computed from, loaded once per request from the
 * repositories (tasks, events and comments are no longer held in memory).
 */
export interface TaskContext {
  tasks: Task[];
  byKey: Map<string, Task>;
  events: TaskEvent[];
  comments: TaskComment[];
}

export async function loadTaskContext(): Promise<TaskContext> {
  const tasks = await repos.tasks.list();
  return {
    tasks,
    byKey: new Map(tasks.map((t) => [t.key, t])),
    events: await repos.taskEvents.list(),
    comments: await repos.taskComments.list(),
  };
}

/** When a task reached "done", from its event history (falls back to updatedAt). */
export function doneAt(t: Task, ctx: TaskContext): number | undefined {
  if (t.status !== 'done') return undefined;
  let at: number | undefined;
  for (const e of ctx.events)
    if (e.taskKey === t.key && e.kind === 'status' && e.to === 'done')
      at = Math.max(at ?? 0, ms(e.at));
  return at ?? ms(t.updatedAt);
}

const dueEnd = (t: Task) => ms(`${t.due}T23:59:59Z`);

function assigneeStats(memberId: string, now: number, ctx: TaskContext) {
  let open = 0;
  let done30 = 0;
  let finished = 0;
  let late = 0;
  for (const t of ctx.tasks) {
    if (t.assignee !== memberId) continue;
    if (t.status !== 'done') {
      open++;
      continue;
    }
    const at = doneAt(t, ctx);
    if (at === undefined || at > now) continue;
    finished++;
    if (at > dueEnd(t)) late++;
    if (now - at <= 30 * DAY) done30++;
  }
  // A light prior keeps one late task from reading as a 100% late rate.
  const lateRate = (late + 1) / (finished + 4);
  return { open, done30, lateRate: round(lateRate, 3) };
}

export function taskFeatures(t: Task, ctx: TaskContext, now = Date.now()): TaskFeatures {
  let statusAt = ms(t.createdAt);
  for (const e of ctx.events)
    if (e.taskKey === t.key && e.kind === 'status') statusAt = Math.max(statusAt, ms(e.at));
  const subtasks = [...db.subtasks.values()].filter((s) => s.taskKey === t.key);
  const minutes = [...db.timeLogs.values()]
    .filter((l) => l.taskKey === t.key)
    .reduce((n, l) => n + l.minutes, 0);
  const blocker = t.blockedBy ? ctx.byKey.get(t.blockedBy) : undefined;
  const stats = assigneeStats(t.assignee, now, ctx);
  return {
    estimate: t.estimate,
    type: t.type,
    priority: t.priority,
    status: t.status,
    statusAgeDays: round(clamp((now - statusAt) / DAY, 0, 3650)),
    ageDays: round(clamp((now - ms(t.createdAt)) / DAY, 0, 3650)),
    daysToDue: round(clamp((dueEnd(t) - now) / DAY, -3650, 3650)),
    blocked: !!blocker && blocker.status !== 'done',
    comments: ctx.comments.filter((c) => c.taskKey === t.key).length,
    subtasksTotal: subtasks.length,
    subtasksDone: subtasks.filter((s) => s.done).length,
    loggedHours: round(minutes / 60, 1),
    assigneeOpenTasks: stats.open,
    assigneeThroughput30d: stats.done30,
    assigneeLateRate: stats.lateRate,
  };
}

// ── Deployments ────────────────────────────────────────────────

const failed = (d: Deployment) => d.status === 'failed' || d.status === 'rolled-back';
const terminal = (d: Deployment) => failed(d) || d.status === 'succeeded';

export function deployFeatures(d: Deployment): DeployFeatures {
  const at = ms(d.createdAt);
  const before = [...db.deployments.values()].filter((x) => x.id !== d.id && ms(x.createdAt) < at);
  const mine = before.filter(
    (x) => x.requestedBy === d.requestedBy && at - ms(x.createdAt) <= 90 * DAY,
  );
  const mineDone = mine.filter(terminal);
  const product = before.filter((x) => x.product === d.product && at - ms(x.createdAt) <= 30 * DAY);
  const productDone = product.filter(terminal);
  const incidents = [...db.incidents.values()].filter((i) => i.product === d.product);
  const last = before
    .filter((x) => x.product === d.product && x.env === d.env)
    .reduce((m, x) => Math.max(m, ms(x.createdAt)), 0);
  return {
    env: d.env,
    provider: d.provider || 'unknown',
    hourUtc: new Date(at).getUTCHours(),
    weekday: weekday(at),
    requesterDeploys90d: mine.length,
    // Priors (1 failure in 10) so a first deploy isn't scored as 0% or 100%.
    requesterFailureRate: round((mineDone.filter(failed).length + 1) / (mineDone.length + 10), 3),
    productFailureRate30d: round(
      (productDone.filter(failed).length + 1) / (productDone.length + 10),
      3,
    ),
    productIncidents7d: incidents.filter(
      (i) => at - ms(i.startedAt) <= 7 * DAY && ms(i.startedAt) <= at,
    ).length,
    openIncidents: incidents.filter(
      (i) => ms(i.startedAt) <= at && (!i.resolvedAt || ms(i.resolvedAt) > at),
    ).length,
    hoursSinceLastDeploy: round(last ? (at - last) / HOUR : 720, 1),
  };
}

// ── Sign-ins ───────────────────────────────────────────────────

const located = (s: SignInRecord) =>
  s.location.countryCode !== 'XX' && s.location.countryCode !== 'LO';

/** The member's sign-ins strictly before this one, newest first. */
export function priorSignIns(s: SignInRecord): SignInRecord[] {
  const at = ms(s.at);
  return db.signIns
    .filter((h) => h.memberId === s.memberId && h.id !== s.id && ms(h.at) < at)
    .sort((a, b) => b.at.localeCompare(a.at));
}

export function signinFeatures(s: SignInRecord): SigninFeatures {
  const at = ms(s.at);
  const prior = priorSignIns(s);
  const good = prior.filter((h) => h.result === 'success' && located(h));
  // "Usual" location: the city this member has signed in from most often.
  const counts = new Map<string, { n: number; rec: SignInRecord }>();
  for (const h of good) {
    const key = `${h.location.city}|${h.location.countryCode}`;
    const c = counts.get(key);
    counts.set(key, { n: (c?.n ?? 0) + 1, rec: c?.rec ?? h });
  }
  const usual = [...counts.values()].sort((a, b) => b.n - a.n)[0]?.rec;
  const here = located(s);
  const distance = usual && here ? distanceKm(usual.location, s.location) : 0;
  const last = good[0];
  const lastKm = last && here ? distanceKm(last.location, s.location) : 0;
  const hours = last ? Math.max((at - ms(last.at)) / HOUR, 0.01) : 1;
  return {
    org: 'default',
    hourUtc: new Date(at).getUTCHours(),
    weekday: weekday(at),
    distanceKmFromUsual: round(clamp(distance, 0, 25_000), 1),
    network: s.location.network,
    // No device fingerprint is stored with sign-ins; a never-seen IP is the proxy.
    newDevice: !prior.some((h) => h.ip === s.ip),
    velocityKmh: round(clamp(lastKm / hours, 0, 1_000_000), 1),
    newCountry:
      here &&
      good.length > 0 &&
      !good.some((h) => h.location.countryCode === s.location.countryCode),
  };
}

// ── Training export ────────────────────────────────────────────

/**
 * Labelled rows for training. Tasks: one row per finished task, with features
 * as they stood at creation and the observed outcome. Deployments: finished
 * deploys and whether they failed. Sign-ins: every record, with a weak label
 * (blocked or high rule-based risk) used only to evaluate the anomaly model.
 */
export async function buildExport(now = Date.now()) {
  const ctx = await loadTaskContext();
  const tasks = ctx.tasks.flatMap((t) => {
    const finished = doneAt(t, ctx);
    if (finished === undefined) return [];
    const created = ms(t.createdAt);
    const f = taskFeatures(t, ctx, created);
    return [
      {
        ...f,
        status: 'backlog' as const,
        statusAgeDays: 0,
        ageDays: 0,
        comments: 0,
        subtasksDone: 0,
        loggedHours: 0,
        asOf: t.createdAt,
        remainingDays: round(clamp((finished - created) / DAY, 0, 3650)),
        late: finished > dueEnd(t),
      },
    ];
  });
  const deployments = [...db.deployments.values()]
    .filter(terminal)
    .map((d) => ({ ...deployFeatures(d), asOf: d.createdAt, failed: failed(d) }));
  const signins = db.signIns.map((s) => ({
    ...signinFeatures(s),
    asOf: s.at,
    anomalous: s.result === 'blocked' || s.risk.score >= 70,
  }));
  return {
    source: 'backend' as const,
    generatedAt: new Date(now).toISOString(),
    featureSchemaVersion: 1,
    tasks,
    deployments,
    signins,
  };
}
