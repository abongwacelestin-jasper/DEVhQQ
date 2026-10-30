import {
  consoleAuditSeed,
  consoleDeployments,
  consoleIncidents,
  consoleMembers,
  consoleProjects,
  consoleSignInSeed,
  consoleTasks,
  DEMO_CODE,
  DEMO_PASSWORD,
  demoRoles,
  geoTable,
  PREVIEW_IP,
} from '../data/consoleSeed';
import type { AuditRow, GeoLocation, SignInRow } from '../types/console';

/**
 * In-browser stand-in for the Node backend so the console works in the preview.
 * Implements the same routes, validation rules, status codes and error shapes.
 * Tokens are self-describing (`pv.<memberId>.<stage>.<nonce>`) so a reload keeps you signed in.
 */

type Json = Record<string, unknown>;
type Stage = 'password' | 'verified';
interface Principal {
  memberId: string;
  stage: Stage;
  token: string;
}
interface Ctx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Json;
  principal: Principal | null;
}
export interface MockResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}
type Guard = 'public' | 'partial' | 'session';
type Handler = (c: Ctx) => MockResult;

const iso = (hAgo: number) => new Date(Date.now() - hAgo * 3_600_000).toISOString();
const ok = (body: unknown, status = 200): MockResult => ({ status, body });
const fail = (status: number, code: string, message: string, details?: unknown): MockResult => ({
  status,
  body: { error: { code, message, ...(details ? { details } : {}) } },
});
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

function hash(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  const a = (h1 >>> 0).toString(16).padStart(8, '0');
  const b = (h2 >>> 0).toString(16).padStart(8, '0');
  return (a + b).repeat(4);
}

// ---------- state ----------
const startedAt = Date.now() - 3 * 3_600_000 - 17 * 60_000;
const tasks = consoleTasks.map((t, i) => ({ ...t, updatedAt: iso(2 + i * 5) }));
const deployments = consoleDeployments.map(({ hoursAgo, ...d }) => ({
  ...d,
  createdAt: iso(hoursAgo),
}));
const incidents = consoleIncidents.map(({ hoursAgo, ...i }) => ({
  ...i,
  startedAt: iso(hoursAgo),
}));
const locate = (ip: string): GeoLocation =>
  geoTable[ip] ?? {
    city: 'Unknown',
    country: 'Unknown',
    countryCode: '??',
    network: 'residential',
  };
const signIns: SignInRow[] = consoleSignInSeed
  .map(([memberId, ip, h, result, score, reasons], i) => ({
    id: `seed${i}`,
    memberId,
    ip,
    at: iso(h),
    result,
    location: locate(ip),
    risk: { score, reasons },
  }))
  .sort((a, b) => b.at.localeCompare(a.at));
const audit: AuditRow[] = [];
const revoked = new Set<string>();
const sessions = new Map<
  string,
  { memberId: string; startedAt: string; lastSeen: string; ip: string; method: string }
>();
const metrics = new Map<string, { durations: number[]; statuses: Record<string, number> }>();

function appendAudit(
  actor: string,
  action: string,
  target: string,
  sensitive = false,
  at = new Date().toISOString(),
) {
  const prev = audit[audit.length - 1];
  const seq = (prev?.seq ?? 0) + 1;
  audit.push({
    seq,
    at,
    actor,
    action,
    target,
    sensitive,
    hash: hash(`${seq}${at}${actor}${action}${target}${prev?.hash ?? ''}`),
  });
}
consoleAuditSeed.forEach(([a, act, t, s, h]) => appendAudit(a, act, t, s, iso(h)));

const member = (id: string) => consoleMembers.find((m) => m.id === id);
const publicMember = (id: string) => {
  const m = member(id)!;
  return { id: m.id, name: m.name, email: m.email, role: m.role, products: m.products };
};
const inScope = (p: Principal, product: string) => {
  const m = member(p.memberId)!;
  return m.role === 'Owner' || m.products.includes(product);
};

function issue(memberId: string, stage: Stage, method: string) {
  const token = `pv.${memberId}.${stage}.${Math.random().toString(36).slice(2, 12)}`;
  if (stage === 'verified')
    sessions.set(token, {
      memberId,
      startedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      ip: PREVIEW_IP,
      method,
    });
  return token;
}

function readPrincipal(auth: string | undefined): Principal | null {
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const [pv, memberId, stage] = token.split('.');
  if (
    pv !== 'pv' ||
    !member(memberId) ||
    (stage !== 'password' && stage !== 'verified') ||
    revoked.has(token)
  )
    return null;
  if (stage === 'verified') {
    const s = sessions.get(token) ?? {
      memberId,
      startedAt: new Date().toISOString(),
      lastSeen: '',
      ip: PREVIEW_IP,
      method: 'password',
    };
    sessions.set(token, { ...s, lastSeen: new Date().toISOString() });
  }
  return { memberId, stage, token };
}

function risk(ip: string) {
  const loc = locate(ip);
  const reasons: string[] = [];
  let score = 0;
  if (loc.network === 'tor') {
    score += 60;
    reasons.push('Tor exit node');
  }
  if (loc.network === 'vpn') {
    score += 25;
    reasons.push('Anonymising VPN');
  }
  if (loc.network === 'datacenter') {
    score += 30;
    reasons.push('Datacenter IP — likely automation');
  }
  if (loc.countryCode === '??') {
    score += 15;
    reasons.push('Unrecognised network');
  }
  score = Math.min(100, score);
  return {
    location: loc,
    score,
    reasons,
    decision: score >= 70 ? 'block' : score >= 40 ? 'challenge' : 'allow',
  };
}

// ---------- query ----------
const collections: Record<string, () => Json[]> = {
  tasks: () => tasks,
  members: () => consoleMembers,
  projects: () => consoleProjects,
  deployments: () => deployments,
  incidents: () => incidents,
  signIns: () => signIns as unknown as Json[],
  audit: () => audit as unknown as Json[],
};
const OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'in', 'exists'];
const getPath = (o: unknown, path: string) =>
  path
    .split('.')
    .reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Json)[k] : undefined), o);
function testCond(actual: unknown, op: string, val: unknown): boolean {
  switch (op) {
    case 'eq':
      return Array.isArray(actual) ? actual.includes(val) : actual === val;
    case 'ne':
      return actual !== val;
    case 'gt':
      return typeof actual === typeof val && (actual as number) > (val as number);
    case 'gte':
      return typeof actual === typeof val && (actual as number) >= (val as number);
    case 'lt':
      return typeof actual === typeof val && (actual as number) < (val as number);
    case 'lte':
      return typeof actual === typeof val && (actual as number) <= (val as number);
    case 'contains':
      return typeof actual === 'string'
        ? actual.toLowerCase().includes(String(val).toLowerCase())
        : Array.isArray(actual) && actual.includes(val);
    case 'in':
      return Array.isArray(val) && val.includes(actual);
    case 'exists':
      return (actual !== undefined && actual !== null) === Boolean(val);
  }
  return false;
}

function runQuery(c: Ctx): MockResult {
  const t0 = performance.now();
  const {
    collection,
    where = {},
    fields,
    sort,
    limit = 50,
  } = c.body as {
    collection?: string;
    where?: Json;
    fields?: string[];
    sort?: string;
    limit?: number;
  };
  const allowed = ['collection', 'where', 'fields', 'sort', 'limit', 'offset'];
  const unknown = Object.keys(c.body).filter((k) => !allowed.includes(k));
  if (unknown.length)
    return fail(422, 'validation_failed', `Unknown field(s): ${unknown.join(', ')}`);
  if (!collection || !collections[collection])
    return fail(
      422,
      'validation_failed',
      `collection must be one of ${Object.keys(collections).join(', ')}`,
    );
  if (typeof where !== 'object' || Array.isArray(where))
    return fail(422, 'validation_failed', 'where must be an object');
  const conds: [string, string, unknown][] = [];
  for (const [f, raw] of Object.entries(where)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_.]{0,40}$/.test(f))
      return fail(422, 'validation_failed', `where.${f} is not a valid field name`);
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const { op, value } = raw as Json;
      if (!OPS.includes(String(op)))
        return fail(422, 'validation_failed', `where.${f}.op must be one of ${OPS.join(', ')}`);
      conds.push([f, String(op), value]);
    } else conds.push([f, 'eq', raw]);
  }
  let rows = collections[collection]().map((r) => {
    const { passwordHash: _p, ...rest } = r as Json;
    return rest;
  });
  rows = rows.filter((r) =>
    typeof r.product === 'string' ? inScope(c.principal!, r.product) : true,
  );
  rows = rows.filter((r) => conds.every(([f, op, v]) => testCond(getPath(r, f), op, v)));
  const total = rows.length;
  if (sort) {
    const desc = sort.startsWith('-');
    const key = sort.replace(/^-/, '');
    rows.sort((a, b) => {
      const x = String(getPath(a, key) ?? '');
      const y = String(getPath(b, key) ?? '');
      return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1);
    });
  }
  rows = rows.slice(0, Math.min(Number(limit) || 50, 500));
  if (fields?.length)
    rows = rows.map((r) => Object.fromEntries(fields.map((f) => [f, getPath(r, f)])));
  appendAudit(c.principal!.memberId, 'query.run', `${collection} · ${total} match`);
  return ok({
    collection,
    total,
    returned: rows.length,
    ms: Math.round((performance.now() - t0) * 100) / 100,
    rows,
  });
}

// ---------- routes ----------
const routes: [string, string, Guard, Handler][] = [
  [
    'GET',
    '/api/health',
    'public',
    () =>
      ok({
        ok: true,
        version: '1.4.0',
        env: 'preview',
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        routes: routes.length,
        demo: { roles: demoRoles.map((r) => r.key), password: DEMO_PASSWORD, mfaCode: DEMO_CODE },
      }),
  ],
  [
    'GET',
    '/api/auth/demo-accounts',
    'public',
    () =>
      ok({
        enabled: true,
        password: DEMO_PASSWORD,
        mfaCode: DEMO_CODE,
        accounts: demoRoles.map((r) => ({
          ...r,
          name: member(r.memberId)!.name,
          email: member(r.memberId)!.email,
        })),
      }),
  ],
  [
    'POST',
    '/api/auth/sign-in',
    'public',
    (c) => {
      const email = str(c.body.email)?.trim().toLowerCase();
      const password = str(c.body.password);
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
        return fail(422, 'validation_failed', 'email must be a valid email address');
      if (!password) return fail(422, 'validation_failed', 'password is required');
      const m = consoleMembers.find((x) => x.email === email);
      if (!m || password !== DEMO_PASSWORD || m.status !== 'active') {
        signIns.unshift({
          id: `si${Date.now()}`,
          memberId: m?.id ?? 'unknown',
          ip: PREVIEW_IP,
          at: new Date().toISOString(),
          result: 'failed',
          location: locate(PREVIEW_IP),
          risk: { score: 0, reasons: [m ? 'Wrong password' : 'Unknown account'] },
        });
        return fail(401, 'invalid_credentials', 'Email or password is incorrect');
      }
      appendAudit(m.id, 'auth.password_ok', locate(PREVIEW_IP).city);
      return ok({
        next: 'totp',
        methods: ['totp'],
        token: issue(m.id, 'password', 'password'),
        tokenType: 'Bearer',
      });
    },
  ],
  [
    'POST',
    '/api/auth/mfa/totp',
    'partial',
    (c) => {
      const code = str(c.body.code);
      if (!code || !/^\d{6}$/.test(code))
        return fail(422, 'validation_failed', 'code must be 6 digits');
      if (code !== DEMO_CODE) return fail(401, 'mfa_invalid', 'Code is incorrect or expired');
      revoked.add(c.principal!.token);
      const token = issue(c.principal!.memberId, 'verified', 'password');
      signIns.unshift({
        id: `si${Date.now()}`,
        memberId: c.principal!.memberId,
        ip: PREVIEW_IP,
        at: new Date().toISOString(),
        result: 'success',
        location: locate(PREVIEW_IP),
        risk: { score: 0, reasons: [] },
      });
      appendAudit(c.principal!.memberId, 'auth.mfa_ok', 'totp', true);
      return ok({
        ok: true,
        token,
        tokenType: 'Bearer',
        member: publicMember(c.principal!.memberId),
      });
    },
  ],
  [
    'POST',
    '/api/auth/demo',
    'public',
    (c) => {
      const role = demoRoles.find((r) => r.key === (str(c.body.roleKey) ?? str(c.body.role)));
      if (!role)
        return fail(
          422,
          'validation_failed',
          `roleKey must be one of ${demoRoles.map((r) => r.key).join(', ')}`,
        );
      const token = issue(role.memberId, 'verified', 'demo');
      signIns.unshift({
        id: `si${Date.now()}`,
        memberId: role.memberId,
        ip: PREVIEW_IP,
        at: new Date().toISOString(),
        result: 'success',
        location: locate(PREVIEW_IP),
        risk: { score: 0, reasons: [] },
      });
      appendAudit(role.memberId, 'auth.demo', `${role.key} · ${locate(PREVIEW_IP).city}`);
      return ok({ ok: true, token, tokenType: 'Bearer', member: publicMember(role.memberId) });
    },
  ],
  [
    'GET',
    '/api/auth/session',
    'session',
    (c) =>
      ok({
        member: publicMember(c.principal!.memberId),
        session: { stage: 'verified', location: 'Lagos, Nigeria' },
        stepUpRequired: false,
        elevations: [],
      }),
  ],
  [
    'POST',
    '/api/auth/sign-out',
    'partial',
    (c) => {
      revoked.add(c.principal!.token);
      sessions.delete(c.principal!.token);
      appendAudit(c.principal!.memberId, 'auth.signed_out', 'console');
      return { status: 204 };
    },
  ],
  [
    'GET',
    '/api/team',
    'session',
    (c) => ok(consoleMembers.filter((m) => m.products.some((p) => inScope(c.principal!, p)))),
  ],
  [
    'GET',
    '/api/tasks',
    'session',
    (c) => {
      const f = Object.fromEntries(c.query);
      const q = f.q?.toLowerCase();
      return ok(
        tasks
          .filter(
            (t) =>
              inScope(c.principal!, t.product) &&
              (!f.status || t.status === f.status) &&
              (!f.product || t.product === f.product) &&
              (!f.assignee || t.assignee === f.assignee) &&
              (!q || `${t.key} ${t.title}`.toLowerCase().includes(q)),
          )
          .slice(0, Math.min(Number(f.limit ?? 200), 500)),
      );
    },
  ],
  [
    'GET',
    '/api/tasks/:key',
    'session',
    (c) => {
      const t = tasks.find((x) => x.key === c.params.key.toUpperCase());
      return t && inScope(c.principal!, t.product) ? ok(t) : fail(404, 'not_found', 'Not found');
    },
  ],
  [
    'POST',
    '/api/tasks',
    'session',
    (c) => {
      const allowed = ['projectId', 'title', 'type', 'priority', 'assignee', 'due', 'estimate'];
      const unknown = Object.keys(c.body).filter((k) => !allowed.includes(k));
      if (unknown.length)
        return fail(422, 'validation_failed', `Unknown field(s): ${unknown.join(', ')}`);
      const project = consoleProjects.find((p) => p.id === c.body.projectId);
      if (!project) return fail(404, 'not_found', 'Project not found');
      if (!inScope(c.principal!, project.product))
        return fail(403, 'forbidden', 'You are not assigned to this product');
      const title = str(c.body.title);
      if (!title || title.length < 3)
        return fail(422, 'validation_failed', 'title must be at least 3 characters');
      const prefix = { renewberry: 'RB', blog: 'BL', mirror: 'MA' }[project.product] ?? 'TK';
      const n =
        Math.max(
          0,
          ...tasks.filter((t) => t.key.startsWith(prefix)).map((t) => Number(t.key.split('-')[1])),
        ) + 1;
      const task = {
        key: `${prefix}-${n}`,
        title,
        product: project.product,
        projectId: project.id,
        type: str(c.body.type) ?? 'task',
        status: 'backlog',
        priority: str(c.body.priority) ?? 'medium',
        assignee: str(c.body.assignee) ?? c.principal!.memberId,
        due: str(c.body.due) ?? '',
        estimate: Number(c.body.estimate ?? 1),
        updatedAt: new Date().toISOString(),
      };
      tasks.unshift(task);
      appendAudit(c.principal!.memberId, 'task.created', `${task.key} · ${task.title}`);
      return ok(task, 201);
    },
  ],
  [
    'PATCH',
    '/api/tasks/:key',
    'session',
    (c) => {
      const t = tasks.find((x) => x.key === c.params.key.toUpperCase());
      if (!t || !inScope(c.principal!, t.product)) return fail(404, 'not_found', 'Not found');
      const allowed = ['status', 'priority', 'assignee', 'reviewer', 'title'];
      const unknown = Object.keys(c.body).filter((k) => !allowed.includes(k));
      if (unknown.length)
        return fail(422, 'validation_failed', `Unknown field(s): ${unknown.join(', ')}`);
      if (
        c.body.status &&
        !['backlog', 'in-progress', 'review', 'done'].includes(String(c.body.status))
      )
        return fail(
          422,
          'validation_failed',
          'status must be one of backlog, in-progress, review, done',
        );
      if (c.body.status === 'done' && (!('reviewer' in t) || t.reviewer === t.assignee))
        return fail(
          409,
          'review_required',
          'Assign a reviewer other than the assignee before closing',
        );
      const before = t.status;
      Object.assign(t, c.body, { updatedAt: new Date().toISOString() });
      appendAudit(
        c.principal!.memberId,
        'task.updated',
        `${t.key}${c.body.status ? ` · ${before} → ${c.body.status}` : ''}`,
      );
      return ok(t);
    },
  ],
  [
    'GET',
    '/api/deployments',
    'session',
    (c) =>
      ok(
        deployments.filter(
          (d) =>
            inScope(c.principal!, d.product) &&
            (!c.query.get('env') || d.env === c.query.get('env')) &&
            (!c.query.get('status') || d.status === c.query.get('status')),
        ),
      ),
  ],
  [
    'GET',
    '/api/incidents',
    'session',
    (c) =>
      ok(
        incidents.filter(
          (i) =>
            inScope(c.principal!, i.product) &&
            (!c.query.get('status') || i.status === c.query.get('status')),
        ),
      ),
  ],
  [
    'GET',
    '/api/audit',
    'session',
    (c) => {
      const sens = c.query.get('sensitive') === '1' || c.query.get('sensitive') === 'true';
      const action = c.query.get('action') ?? '';
      return ok(
        [...audit]
          .reverse()
          .filter((e) => (!sens || e.sensitive) && (!action || e.action.startsWith(action)))
          .slice(0, Number(c.query.get('limit') ?? 200)),
      );
    },
  ],
  [
    'GET',
    '/api/audit/verify',
    'session',
    () => ok({ ok: true, entries: audit.length, head: audit[audit.length - 1]?.hash }),
  ],
  [
    'GET',
    '/api/locations/me',
    'public',
    () => ({
      status: 200,
      body: { ip: PREVIEW_IP, ...locate(PREVIEW_IP), label: 'Lagos, Nigeria' },
    }),
  ],
  [
    'GET',
    '/api/locations/lookup',
    'session',
    (c) => {
      const ip = c.query.get('ip') ?? '';
      if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip))
        return fail(422, 'validation_failed', 'ip must be an IPv4 address');
      const r = risk(ip);
      return ok({
        ip,
        ...r.location,
        risk: { score: r.score, reasons: r.reasons, decision: r.decision },
      });
    },
  ],
  [
    'GET',
    '/api/locations/summary',
    'session',
    () => {
      const by = new Map<
        string,
        { countryCode: string; country: string; total: number; risky: number; cities: Set<string> }
      >();
      for (const s of signIns) {
        const row = by.get(s.location.countryCode) ?? {
          countryCode: s.location.countryCode,
          country: s.location.country,
          total: 0,
          risky: 0,
          cities: new Set<string>(),
        };
        row.total++;
        if (s.risk.score >= 40) row.risky++;
        row.cities.add(s.location.city);
        by.set(s.location.countryCode, row);
      }
      return ok({
        total: signIns.length,
        countries: [...by.values()]
          .map((r) => ({ ...r, cities: [...r.cities] }))
          .sort((a, b) => b.total - a.total),
      });
    },
  ],
  [
    'GET',
    '/api/locations/sign-ins',
    'session',
    (c) =>
      ok(
        signIns
          .filter((s) => !c.query.get('result') || s.result === c.query.get('result'))
          .slice(0, Number(c.query.get('limit') ?? 100)),
      ),
  ],
  [
    'GET',
    '/api/locations/sessions',
    'session',
    (c) =>
      ok(
        [...sessions.entries()].map(([t, s]) => ({
          id: t.slice(-8),
          ...s,
          location: locate(s.ip),
          current: t === c.principal!.token,
        })),
      ),
  ],
  [
    'GET',
    '/api/system/collections',
    'session',
    () =>
      ok(
        Object.entries(collections).map(([name, get]) => ({
          name,
          count: get().length,
          fields: Object.keys(get()[0] ?? {}),
        })),
      ),
  ],
  ['POST', '/api/query', 'session', runQuery],
  [
    'GET',
    '/api/system/metrics',
    'session',
    () => {
      const routesOut = [...metrics.entries()]
        .map(([route, m]) => {
          const sorted = [...m.durations].sort((a, b) => a - b);
          const pct = (p: number) =>
            sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
          return {
            route,
            count: m.durations.length,
            p50: Math.round(pct(0.5)),
            p95: Math.round(pct(0.95)),
            statuses: m.statuses,
          };
        })
        .sort((a, b) => b.count - a.count);
      const statuses: Record<string, number> = {};
      routesOut.forEach((r) =>
        Object.entries(r.statuses).forEach(([k, n]) => (statuses[k] = (statuses[k] ?? 0) + n)),
      );
      return ok({
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        totalRequests: routesOut.reduce((n, r) => n + r.count, 0),
        statuses,
        routes: routesOut,
        memoryMb: {
          heapUsed: 38 + Math.round(Math.random() * 6),
          rss: 92 + Math.round(Math.random() * 8),
        },
        sessions: { active: sessions.size },
        audit: { entries: audit.length, chain: 'intact' },
      });
    },
  ],
  [
    'GET',
    '/api/system/logs',
    'session',
    (c) => {
      const level = c.query.get('level');
      const q = c.query.get('q')?.toLowerCase();
      const order = { debug: 0, info: 1, warn: 2, error: 3 } as const;
      const min = level && level in order ? order[level as keyof typeof order] : 0;
      return ok(
        serverLogs
          .filter(
            (l) =>
              order[l.level] >= min &&
              (!q || `${l.message} ${l.path} ${l.requestId}`.toLowerCase().includes(q)),
          )
          .slice(-Number(c.query.get('limit') ?? 300))
          .reverse(),
      );
    },
  ],
  [
    'GET',
    '/api/system/events',
    'session',
    (c) => {
      const after = Number(c.query.get('after') ?? 0);
      return ok(serverEvents.filter((e) => e.seq > after).slice(-200));
    },
  ],
  [
    'GET',
    '/api/system/codes',
    'public',
    () =>
      ok({
        200: 'OK',
        201: 'Created',
        204: 'No content',
        401: 'Unauthorized',
        403: 'Forbidden',
        404: 'Not found',
        409: 'Conflict',
        422: 'Validation failed',
        429: 'Rate limited',
      }),
  ],
];

function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/');
  const b = path.split('/');
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

/** Simulated latency per call, in ms. */
export const mockLatency = () => 35 + Math.random() * 140;

export function handleMock(
  method: string,
  path: string,
  query: URLSearchParams,
  body: Json,
  auth: string | undefined,
  simulatedMs: number,
): MockResult {
  const pathMatches = routes.filter(([, pattern]) => match(pattern, path));
  const route = pathMatches.find(([m]) => m === method);
  let result: MockResult;
  if (!route) {
    result = pathMatches.length
      ? {
          ...fail(405, 'method_not_allowed', `Use ${pathMatches.map(([m]) => m).join(', ')}`),
          headers: { Allow: pathMatches.map(([m]) => m).join(', ') },
        }
      : fail(404, 'not_found', `No route for ${method} ${path}`);
  } else {
    const [, pattern, guard, handler] = route;
    const principal = readPrincipal(auth);
    if (guard !== 'public' && !principal) result = fail(401, 'unauthenticated', 'Sign in required');
    else if (guard === 'session' && principal?.stage !== 'verified')
      result = fail(401, 'mfa_required', 'Complete MFA to continue');
    else {
      try {
        result = handler({ params: match(pattern, path)!, query, body, principal });
      } catch (e) {
        result = fail(500, 'internal', 'Unexpected error');
        recordLog(
          'error',
          method,
          path,
          500,
          simulatedMs,
          principal?.memberId,
          `Unhandled: ${(e as Error).message}`,
          (e as Error).stack,
        );
      }
    }
    const key = `${method} ${pattern}`;
    const m = metrics.get(key) ?? { durations: [], statuses: {} };
    m.durations.push(simulatedMs);
    m.statuses[result.status] = (m.statuses[result.status] ?? 0) + 1;
    metrics.set(key, m);
  }
  // Polling the log/event feeds would flood them, so those calls are not logged.
  if (!path.startsWith('/api/system/logs') && !path.startsWith('/api/system/events')) {
    const err = (result.body as { error?: { code: string; message: string } } | undefined)?.error;
    const level: LogLevel = result.status >= 500 ? 'error' : result.status >= 400 ? 'warn' : 'info';
    recordLog(
      level,
      method,
      path,
      result.status,
      simulatedMs,
      readPrincipal(auth)?.memberId,
      err ? `${err.code}: ${err.message}` : `${method} ${path} → ${result.status}`,
    );
  }
  return result;
}

// ---------- server logs & live events ----------
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface ServerLog {
  seq: number;
  at: string;
  level: LogLevel;
  method: string;
  path: string;
  status: number;
  ms: number;
  requestId: string;
  actor?: string;
  message: string;
  stack?: string;
}
export interface ServerEvent {
  seq: number;
  at: string;
  kind: 'request' | 'auth' | 'audit' | 'error';
  summary: string;
  status?: number;
  actor?: string;
}
const serverLogs: ServerLog[] = [];
const serverEvents: ServerEvent[] = [];
let logSeq = 0;

function recordLog(
  level: LogLevel,
  method: string,
  path: string,
  status: number,
  ms: number,
  actor: string | undefined,
  message: string,
  stack?: string,
) {
  const entry: ServerLog = {
    seq: ++logSeq,
    at: new Date().toISOString(),
    level,
    method,
    path,
    status,
    ms: Math.round(ms),
    requestId: Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 6),
    actor,
    message,
    stack,
  };
  serverLogs.push(entry);
  if (serverLogs.length > 1000) serverLogs.shift();
  const kind: ServerEvent['kind'] =
    level === 'error'
      ? 'error'
      : path.startsWith('/api/auth')
        ? 'auth'
        : method !== 'GET'
          ? 'audit'
          : 'request';
  serverEvents.push({
    seq: entry.seq,
    at: entry.at,
    kind,
    summary: `${method} ${path}`,
    status,
    actor,
  });
  if (serverEvents.length > 500) serverEvents.shift();
}

// Seed a little history so the views aren't empty on first open.
[
  ['info', 'GET', '/api/health', 200, 'GET /api/health → 200'],
  ['warn', 'POST', '/api/auth/sign-in', 401, 'invalid_credentials: Email or password is incorrect'],
  ['info', 'GET', '/api/tasks', 200, 'GET /api/tasks → 200'],
  [
    'warn',
    'PATCH',
    '/api/tasks/RB-221',
    409,
    'review_required: Assign a reviewer other than the assignee before closing',
  ],
  ['error', 'POST', '/api/deployments/dp-206/approve', 500, 'Unhandled: migration lock timeout'],
  ['info', 'GET', '/api/incidents', 200, 'GET /api/incidents → 200'],
].forEach(([l, m, p, s, msg]) =>
  recordLog(
    l as LogLevel,
    m as string,
    p as string,
    s as number,
    40 + Math.random() * 120,
    'm4',
    msg as string,
    l === 'error'
      ? 'Error: migration lock timeout\n    at runMigrations (backend/src/store/db.ts:212:11)\n    at approve (backend/src/routes/operations.routes.ts:88:5)\n    at Router.handle (backend/src/lib/http.ts:141:24)'
      : undefined,
  ),
);
