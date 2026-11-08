/**
 * Data store seeded to match the frontend demo data exactly (same IDs, emails,
 * roles and products), so the web app and the API agree.
 *
 * Members, tasks, task events and task comments live in the relational data
 * layer (`repos` from data/index.ts, ADR 0011): queried on demand, never held
 * in memory. Every other table here is a persisted Collection
 * (store/collection.ts): reads stay synchronous and in memory; writes go
 * through the installed driver — in-memory by default, PostgreSQL when
 * DATABASE_URL is set (see db/README.md). In-place mutations of a Collection
 * row must be followed by `db.<table>.save(key)`; a repository row must be
 * written back with `repos.<x>.put(row)`.
 *
 * Seeding: the demo data loads in memory mode, or with PostgreSQL only when
 * NODE_ENV !== 'production' and the database is empty (see db/boot.ts).
 */

import { config } from '../config/env.ts';
import { hashPassword } from '../security/crypto.ts';
import { lookupIp } from '../lib/geo.ts';
import { createCollection } from './collection.ts';
import { repos } from '../data/index.ts';
import { signInLog } from './signInLog.ts';
import {
  seedComments,
  seedEvents,
  seedSubtasks,
  seedTimeLogs,
  taskBlockedBy,
  taskCreation,
  taskPullRequests,
} from './taskActivity.ts';
import type {
  Deployment,
  Incident,
  Member,
  Project,
  ProjectDoc,
  RoleName,
  SignInRecord,
  Subtask,
  Task,
  TimeLog,
} from '../types.ts';

export const db = {
  projects: createCollection<Project>('projects'),
  docs: createCollection<ProjectDoc>('docs'),
  subtasks: createCollection<Subtask>('subtasks'),
  timeLogs: createCollection<TimeLog>('timeLogs'),
  deployments: createCollection<Deployment>('deployments'),
  incidents: createCollection<Incident>('incidents'),
  /** Newest-first, bounded in-memory window; every record is persisted (store/signInLog.ts). */
  signIns: signInLog,
};

/** Demo credentials — identical to the frontend (data/roles.ts). Never active in production. */
export const DEMO = {
  password: process.env.DEMO_PASSWORD ?? 'devhq-demo',
  mfaCode: process.env.DEMO_MFA_CODE ?? '246810',
  // config.env is validated (CYBER-008): only an exact development/test environment enables demo.
  enabled: config.env !== 'production' && process.env.DEMO_DISABLED !== '1',
};

/** Demo role keys used by the sign-in screen and the console's quick-login buttons. */
export const demoAccounts: { key: string; label: string; memberId: string }[] = [
  { key: 'admin', label: 'Admin', memberId: 'm1' },
  { key: 'pm', label: 'Project manager', memberId: 'm2' },
  { key: 'developer', label: 'Developer', memberId: 'm4' },
  { key: 'designer', label: 'Designer', memberId: 'm9' },
  { key: 'tester', label: 'Tester', memberId: 'm10' },
  { key: 'operations', label: 'Operations', memberId: 'm11' },
];

type SeedMember = {
  id: string;
  name: string;
  email: string;
  role: RoleName;
  products: Member['products'];
  status: Member['status'];
};

const seedMembers: SeedMember[] = [
  {
    id: 'm1',
    name: 'Amara Okafor',
    email: 'amara@techorg.io',
    role: 'Owner',
    products: ['renewberry', 'blog', 'mirror'],
    status: 'active',
  },
  {
    id: 'm2',
    name: 'Daniel Reyes',
    email: 'daniel@techorg.io',
    role: 'Project manager',
    products: ['renewberry'],
    status: 'active',
  },
  {
    id: 'm3',
    name: 'Priya Nair',
    email: 'priya@techorg.io',
    role: 'Project manager',
    products: ['blog', 'mirror'],
    status: 'active',
  },
  {
    id: 'm4',
    name: 'Kofi Mensah',
    email: 'kofi@techorg.io',
    role: 'Developer',
    products: ['renewberry'],
    status: 'active',
  },
  {
    id: 'm5',
    name: 'Lena Fischer',
    email: 'lena@techorg.io',
    role: 'Developer',
    products: ['renewberry', 'mirror'],
    status: 'active',
  },
  {
    id: 'm6',
    name: 'Tomás Silva',
    email: 'tomas@techorg.io',
    role: 'Developer',
    products: ['blog'],
    status: 'active',
  },
  {
    id: 'm7',
    name: 'Yuki Tanaka',
    email: 'yuki@techorg.io',
    role: 'Developer',
    products: ['renewberry', 'mirror'],
    status: 'active',
  },
  {
    id: 'm8',
    name: 'Sam Carter',
    email: 'sam@techorg.io',
    role: 'Developer',
    products: ['blog', 'mirror'],
    status: 'active',
  },
  {
    id: 'm9',
    name: 'Inès Moreau',
    email: 'ines@techorg.io',
    role: 'Designer',
    products: ['renewberry', 'mirror'],
    status: 'active',
  },
  {
    id: 'm10',
    name: 'Ravi Patel',
    email: 'ravi@techorg.io',
    role: 'Tester',
    products: ['renewberry', 'mirror'],
    status: 'active',
  },
  {
    id: 'm11',
    name: 'Grace Liu',
    email: 'grace@techorg.io',
    role: 'Operations',
    products: ['renewberry', 'blog', 'mirror'],
    status: 'active',
  },
  {
    id: 'm12',
    name: 'Noah Adeyemi',
    email: 'noah@techorg.io',
    role: 'Developer',
    products: ['blog'],
    status: 'invited',
  },
];

/**
 * Ids of the seeded demo accounts. The shared demo MFA code is honoured only for
 * these, never for real members invited into a demo-enabled (dev/staging) system.
 */
export const DEMO_MEMBER_IDS: ReadonlySet<string> = new Set(seedMembers.map((m) => m.id));

const seedProjects: Project[] = [
  { id: 'p1', product: 'renewberry', name: 'Payments v2', lead: 'm2', status: 'at-risk' },
  {
    id: 'p2',
    product: 'renewberry',
    name: 'Authentication redesign',
    lead: 'm2',
    status: 'on-track',
  },
  { id: 'p3', product: 'renewberry', name: 'Billing reliability', lead: 'm4', status: 'on-track' },
  { id: 'p4', product: 'blog', name: 'Editor refresh', lead: 'm3', status: 'on-track' },
  { id: 'p5', product: 'blog', name: 'Comments v2', lead: 'm3', status: 'planned' },
  { id: 'p6', product: 'mirror', name: 'Beta launch', lead: 'm3', status: 'at-risk' },
  { id: 'p7', product: 'mirror', name: 'Platform hardening', lead: 'm11', status: 'blocked' },
];

const now = () => new Date().toISOString();
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const seedTasks: Omit<Task, 'updatedAt' | 'createdAt' | 'createdBy'>[] = [
  {
    key: 'RB-212',
    title: 'Implement password reset',
    product: 'renewberry',
    projectId: 'p2',
    type: 'feature',
    status: 'review',
    priority: 'high',
    assignee: 'm5',
    reviewer: 'm10',
    due: '2026-10-28',
    estimate: 5,
    description: 'Email-based reset with signed, single-use tokens that expire after 30 minutes.',
  },
  {
    key: 'RB-221',
    title: 'Retry failed payments',
    product: 'renewberry',
    projectId: 'p1',
    type: 'bug',
    status: 'in-progress',
    priority: 'urgent',
    assignee: 'm4',
    reviewer: 'm5',
    due: '2026-10-25',
    estimate: 3,
  },
  {
    key: 'RB-226',
    title: 'Payment method update modal',
    product: 'renewberry',
    projectId: 'p1',
    type: 'design',
    status: 'in-progress',
    priority: 'medium',
    assignee: 'm9',
    due: '2026-10-30',
    estimate: 2,
  },
  {
    key: 'RB-230',
    title: 'Invoice export to CSV',
    product: 'renewberry',
    projectId: 'p1',
    type: 'feature',
    status: 'backlog',
    priority: 'medium',
    assignee: 'm7',
    due: '2026-11-03',
    estimate: 3,
  },
  {
    key: 'RB-218',
    title: '2FA enrollment flow',
    product: 'renewberry',
    projectId: 'p2',
    type: 'feature',
    status: 'backlog',
    priority: 'high',
    assignee: 'm5',
    due: '2026-11-10',
    estimate: 8,
  },
  {
    key: 'RB-209',
    title: 'Billing webhook deduplication',
    product: 'renewberry',
    projectId: 'p3',
    type: 'bug',
    status: 'done',
    priority: 'urgent',
    assignee: 'm4',
    reviewer: 'm10',
    due: '2026-10-21',
    estimate: 3,
  },
  {
    key: 'BL-17',
    title: 'Editor toolbar',
    product: 'blog',
    projectId: 'p4',
    type: 'feature',
    status: 'done',
    priority: 'high',
    assignee: 'm6',
    reviewer: 'm8',
    due: '2026-10-20',
    estimate: 5,
  },
  {
    key: 'BL-22',
    title: 'Draft autosave',
    product: 'blog',
    projectId: 'p4',
    type: 'feature',
    status: 'in-progress',
    priority: 'medium',
    assignee: 'm6',
    due: '2026-11-04',
    estimate: 3,
  },
  {
    key: 'BL-24',
    title: 'SEO meta fields',
    product: 'blog',
    projectId: 'p4',
    type: 'task',
    status: 'review',
    priority: 'medium',
    assignee: 'm8',
    reviewer: 'm6',
    due: '2026-10-29',
    estimate: 2,
  },
  {
    key: 'MA-38',
    title: 'Beta onboarding screens',
    product: 'mirror',
    projectId: 'p6',
    type: 'design',
    status: 'in-progress',
    priority: 'high',
    assignee: 'm9',
    due: '2026-10-20',
    estimate: 5,
  },
  {
    key: 'MA-44',
    title: '/health returns 503 under load',
    product: 'mirror',
    projectId: 'p7',
    type: 'bug',
    status: 'in-progress',
    priority: 'urgent',
    assignee: 'm11',
    due: '2026-10-24',
    estimate: 3,
  },
  {
    key: 'MA-40',
    title: 'Beta invite emails',
    product: 'mirror',
    projectId: 'p6',
    type: 'feature',
    status: 'backlog',
    priority: 'high',
    assignee: 'm8',
    due: '2026-10-21',
    estimate: 3,
  },
  {
    key: 'RB-231',
    title: 'Sign off Payments v2 requirements',
    product: 'renewberry',
    projectId: 'p1',
    type: 'task',
    status: 'in-progress',
    priority: 'high',
    assignee: 'm1',
    due: '2026-10-24',
    estimate: 1,
  },
  {
    key: 'BL-18',
    title: 'Tag filters',
    product: 'blog',
    projectId: 'p4',
    type: 'feature',
    status: 'backlog',
    priority: 'low',
    assignee: 'm6',
    due: '2026-11-08',
    estimate: 2,
  },
  {
    key: 'BL-26',
    title: 'Approve Blog v1.9 release notes',
    product: 'blog',
    projectId: 'p4',
    type: 'task',
    status: 'backlog',
    priority: 'medium',
    assignee: 'm1',
    due: '2026-11-10',
    estimate: 1,
  },
  {
    key: 'MA-36',
    title: 'Session timeout copy',
    product: 'mirror',
    projectId: 'p7',
    type: 'task',
    status: 'review',
    priority: 'low',
    assignee: 'm7',
    reviewer: 'm10',
    due: '2026-10-22',
    estimate: 1,
  },
  {
    key: 'MA-41',
    title: 'Mirror sharing links',
    product: 'mirror',
    projectId: 'p6',
    type: 'feature',
    status: 'backlog',
    priority: 'medium',
    assignee: 'm5',
    due: '2026-11-14',
    estimate: 5,
  },
  {
    key: 'MA-35',
    title: 'Dark mode tokens',
    product: 'mirror',
    projectId: 'p7',
    type: 'design',
    status: 'done',
    priority: 'medium',
    assignee: 'm9',
    reviewer: 'm7',
    due: '2026-10-18',
    estimate: 2,
  },
];

const seedDeployments: Deployment[] = [
  {
    id: 'd-1042',
    product: 'renewberry',
    env: 'production',
    version: 'v2.3.2',
    sha: 'a91e3f0',
    status: 'succeeded',
    provider: 'GitHub Actions',
    requestedBy: 'm4',
    approvedBy: 'm11',
    createdAt: hoursAgo(20),
  },
  {
    id: 'd-1043',
    product: 'renewberry',
    env: 'staging',
    version: 'v2.4.0-rc1',
    sha: 'c02b77d',
    status: 'succeeded',
    provider: 'GitHub Actions',
    requestedBy: 'm5',
    createdAt: hoursAgo(6),
  },
  {
    id: 'd-1044',
    product: 'blog',
    env: 'production',
    version: 'v1.9.0',
    sha: '7d1aa20',
    status: 'awaiting-approval',
    provider: 'Coolify',
    requestedBy: 'm6',
    createdAt: hoursAgo(2),
  },
  {
    id: 'd-1045',
    product: 'mirror',
    env: 'staging',
    version: 'beta-14',
    sha: '3f9d0c1',
    status: 'failed',
    provider: 'Coolify',
    requestedBy: 'm8',
    createdAt: hoursAgo(1),
  },
];

const seedIncidents: Incident[] = [
  {
    id: 'INC-31',
    product: 'renewberry',
    title: 'API 5xx spike on /payments',
    severity: 'SEV2',
    status: 'monitoring',
    owner: 'm11',
    service: 'renewberry-api',
    impact: 'About 6% of API requests fail. Checkout retries and invoice downloads are affected.',
    startedAt: hoursAgo(5),
    timeline: [
      { at: hoursAgo(5), by: 'm11', note: 'Declared from alert' },
      { at: hoursAgo(4), by: 'm4', note: 'Rolled back retry worker' },
    ],
  },
  {
    id: 'INC-32',
    product: 'mirror',
    title: '/health returns 503 under load',
    severity: 'SEV3',
    status: 'investigating',
    owner: 'm11',
    service: 'mirror-app',
    impact: 'Health checks fail under load; no user-facing errors observed yet.',
    startedAt: hoursAgo(1),
    timeline: [{ at: hoursAgo(1), by: 'm11', note: 'Declared' }],
  },
];

let seeded = false;

/** Seeds demo data. Idempotent. Demo credentials exist only outside production. */
export async function seed() {
  if (seeded) return;
  seeded = true;
  // Members first: tasks, sessions and notifications reference them.
  // Production has no demo accounts: members are provisioned through invites only.
  const hash = DEMO.enabled ? await hashPassword(DEMO.password) : '!disabled';
  for (const m of seedMembers)
    await repos.members.put({
      ...m,
      passwordHash: hash,
      passkeys: [],
      failedLogins: 0,
      totpSecret: process.env.DEMO_TOTP_SECRET,
    });
  for (const p of seedProjects) db.projects.set(p.id, p);
  for (const s of seedTasks) {
    const creation = taskCreation[s.key];
    const task: Task = {
      ...s,
      pr: taskPullRequests[s.key],
      blockedBy: taskBlockedBy[s.key],
      createdBy: creation?.by ?? 'm2',
      createdAt: creation?.at ?? hoursAgo(72),
      updatedAt: hoursAgo(Math.random() * 72),
    };
    await repos.tasks.put(task);
    await repos.taskEvents.append({
      id: `created-${task.key}`,
      taskKey: task.key,
      actor: task.createdBy,
      at: task.createdAt,
      kind: 'created',
    });
  }
  for (const e of seedEvents) await repos.taskEvents.append(e);
  for (const c of seedComments) await repos.taskComments.insert(c);
  for (const s of seedSubtasks) db.subtasks.set(s.id, s);
  for (const l of seedTimeLogs) db.timeLogs.set(l.id, l);
  for (const d of seedDeployments) db.deployments.set(d.id, d);
  for (const i of seedIncidents) db.incidents.set(i.id, i);
  db.docs.set('doc-payments-spec', {
    id: 'doc-payments-spec',
    projectId: 'p1',
    product: 'renewberry',
    title: 'Payments v2 — retry & invoices',
    kind: 'spec',
    status: 'published',
    visibility: 'project',
    body: '# Payments v2 — retry & invoices\n\n> Retry failed charges and export invoices.\n\n## Goals\n- Retry with backoff\n- CSV invoice export',
    editors: ['m2', 'm4'],
    updatedBy: 'm2',
    updatedAt: hoursAgo(26),
  });
  db.docs.set('doc-api-runbook', {
    id: 'doc-api-runbook',
    projectId: 'p3',
    product: 'renewberry',
    title: 'Runbook: renewberry api 5xx',
    kind: 'runbook',
    status: 'published',
    visibility: 'restricted',
    body: '# Runbook: renewberry api 5xx\n\n## Mitigate\n- [ ] Check worker queue depth\n- [ ] Roll back last deploy',
    editors: ['m4', 'm11'],
    updatedBy: 'm11',
    updatedAt: hoursAgo(50),
  });

  // Sample sign-in history so location intelligence has data on first boot.
  const history: [string, string, number, SignInRecord['result'], number, string[]][] = [
    ['m11', '102.89.14.22', 1, 'success', 0, []],
    ['m4', '154.160.2.71', 3, 'success', 0, []],
    ['m5', '91.64.120.9', 5, 'success', 0, []],
    ['m2', '83.44.201.18', 8, 'success', 0, []],
    ['m7', '133.32.10.4', 30, 'success', 0, []],
    [
      'm7',
      '185.220.101.4',
      2,
      'blocked',
      90,
      ['Tor exit node', 'Impossible travel: 13990 km in 28.0 h from Tokyo'],
    ],
    ['m10', '49.36.88.150', 6, 'success', 0, []],
    ['m1', '102.89.40.11', 4, 'success', 0, []],
    ['m1', '52.14.3.9', 12, 'failed', 30, ['Datacenter IP — likely automation']],
    [
      'm8',
      '104.28.7.30',
      9,
      'challenged',
      45,
      ['Anonymising VPN', 'First sign-in from VPN provider'],
    ],
  ];

  db.signIns.push(
    ...history
      .map(([memberId, ip, h, result, score, reasons], i): SignInRecord => ({
        id: `seed${i}`,
        memberId,
        ip,
        at: hoursAgo(h),
        method: 'password',
        result,
        location: lookupIp(ip),
        risk: { score, reasons },
      }))
      .sort((a, b) => b.at.localeCompare(a.at)),
  );
}

export function findMemberByEmail(email: string): Promise<Member | undefined> {
  return repos.members.findByEmail(email);
}

export function touch<T extends { updatedAt: string }>(row: T): T {
  row.updatedAt = now();
  return row;
}

/** Public projection of a member — never includes hashes, secrets or key material. */
export function publicMember(m: Member) {
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    role: m.role,
    products: m.products,
    status: m.status,
    mfa: m.passkeys.length > 0 || !!m.totpSecret || DEMO.enabled,
    passkeys: m.passkeys.length,
  };
}

/**
 * Serializable snapshot of the db.* tables for backups. Migrated data
 * (members, tasks, task events and comments) is backed up through
 * data/index.ts → relationalTables() instead.
 */
export function snapshot() {
  return {
    projects: [...db.projects.values()],
    docs: [...db.docs.values()],
    subtasks: [...db.subtasks.values()],
    timeLogs: [...db.timeLogs.values()],
    deployments: [...db.deployments.values()],
    incidents: [...db.incidents.values()],
  };
}
