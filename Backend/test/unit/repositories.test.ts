/**
 * Repository contract (ADR 0011): the same assertions against every
 * implementation.
 *
 *  - always: the in-memory repositories (tests, dev),
 *  - with DEVHQ_TEST_PG_URL (`npm run test:pg`): the PostgreSQL repositories,
 *    in a throwaway database created and dropped by this file.
 *
 * Concurrency cases (parallel failed-login counters, key allocation, writers
 * of different fields) are the replica-safety properties: two replicas are
 * just two concurrent callers of one database.
 */

import '../setup.ts';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { memoryRepositories, pgRepositories, type Repositories } from '../../data/index.ts';
import type { Member, Task } from '../../types.ts';
import type { Notification } from '../../domain/collab/types.ts';
import type { SessionRecord } from '../../data/sessions.ts';

const member = (id: string, over: Partial<Member> = {}): Member => ({
  id,
  name: `Member ${id}`,
  email: `${id}@repo.test`,
  role: 'Developer',
  products: ['renewberry'],
  status: 'active',
  passwordHash: 'scrypt$x',
  passkeys: [],
  failedLogins: 0,
  ...over,
});

const task = (key: string, over: Partial<Task> = {}): Task => ({
  key,
  title: `Task ${key}`,
  product: 'renewberry',
  projectId: 'p1',
  type: 'task',
  status: 'backlog',
  priority: 'low',
  assignee: 'r1',
  due: '2026-12-01',
  estimate: 1,
  createdBy: 'r1',
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  ...over,
});

const session = (id: string, memberId: string, lastSeenAt: number): SessionRecord => ({
  id,
  memberId,
  stage: 'verified',
  createdAt: lastSeenAt,
  lastSeenAt,
  verifiedAt: lastSeenAt,
  uaHash: 'ua',
  client: 'Chrome · macOS',
  ip: '127.0.0.1',
  location: {
    city: 'Local',
    country: 'Local',
    countryCode: 'LO',
    region: 'Local',
    lat: 0,
    lon: 0,
    network: 'loopback',
  },
  revoked: false,
  method: 'password',
  lastTotpCounter: -1,
});

const note = (id: string, memberId: string, over: Partial<Notification> = {}): Notification => ({
  memberId,
  kind: 'mention',
  title: 't',
  body: 'b',
  link: '/x',
  refId: `ref-${id}`,
  actor: 'r2',
  id,
  at: '2026-11-05T10:00:00.000Z',
  ...over,
});

interface Target {
  name: string;
  setup(): Promise<Repositories>;
  teardown(): Promise<void>;
}

const targets: Target[] = [
  { name: 'memory', setup: async () => memoryRepositories(), teardown: async () => {} },
];

const pgUrl = process.env.DEVHQ_TEST_PG_URL;
if (pgUrl) {
  const { default: pg } = await import('pg');
  const { migrate } = await import('../../db/migrate.ts');
  const dbName = `devhq_repo_${process.pid}_${Date.now()}`;
  let admin: InstanceType<typeof pg.Client> | undefined;
  let pool: InstanceType<typeof pg.Pool> | undefined;
  targets.push({
    name: 'postgres',
    async setup() {
      admin = new pg.Client({ connectionString: pgUrl });
      await admin.connect();
      await admin.query(`CREATE DATABASE ${dbName}`);
      const u = new URL(pgUrl);
      u.pathname = `/${dbName}`;
      pool = new pg.Pool({ connectionString: u.toString(), max: 8 });
      await migrate(pool);
      return pgRepositories(pool);
    },
    async teardown() {
      await pool?.end();
      await admin?.query(`DROP DATABASE IF EXISTS ${dbName}`);
      await admin?.end();
    },
  });
}

for (const target of targets) {
  describe(`repositories (${target.name})`, () => {
    let r: Repositories;
    before(async () => {
      r = await target.setup();
      for (const id of ['r1', 'r2', 'r3']) assert.equal(await r.members.insert(member(id)), 'ok');
    });
    after(() => target.teardown());

    it('members: insert reports id and email collisions instead of overwriting', async () => {
      assert.equal(await r.members.insert(member('r1', { email: 'other@repo.test' })), 'id_taken');
      assert.equal(await r.members.insert(member('r9', { email: 'R1@repo.test' })), 'email_taken');
      assert.equal((await r.members.findByEmail(' R1@REPO.test '))?.id, 'r1');
      assert.equal(await r.members.get('r9'), undefined);
    });

    it('members: rows are copies; a change is invisible until written back', async () => {
      const m = (await r.members.get('r1'))!;
      m.name = 'Changed';
      assert.equal((await r.members.get('r1'))!.name, 'Member r1');
      await r.members.put(m);
      assert.equal((await r.members.get('r1'))!.name, 'Changed');
    });

    it('members: writers of different fields never undo each other (field-level put)', async () => {
      const a = (await r.members.get('r2'))!;
      const b = (await r.members.get('r2'))!; // a second replica's stale copy
      a.status = 'deactivated';
      await r.members.put(a);
      b.passkeys.push({
        id: 'cred-r2',
        publicKey: 'pk',
        algorithm: -7,
        signCount: 0,
        createdAt: 'now',
        label: 'key',
      });
      await r.members.put(b);
      const stored = (await r.members.get('r2'))!;
      assert.equal(stored.status, 'deactivated', 'the passkey write did not resurrect the member');
      assert.equal(stored.passkeys.length, 1);
      assert.equal((await r.members.findByPasskey('cred-r2'))?.id, 'r2');
      assert.equal(await r.members.findByPasskey('nope'), undefined);
    });

    it('members: update() is an atomic read-modify-write under concurrency', async () => {
      await Promise.all(
        Array.from({ length: 20 }, () =>
          r.members.update('r3', (m) => {
            m.failedLogins += 1;
          }),
        ),
      );
      assert.equal((await r.members.get('r3'))!.failedLogins, 20);
    });

    it('members: filters, counts and keyset pages in insertion order', async () => {
      assert.equal(await r.members.count({ status: 'deactivated' }), 1);
      const all = await r.members.list();
      assert.deepEqual(
        all.map((m) => m.id),
        ['r1', 'r2', 'r3'],
      );
      const p1 = await r.members.page({ limit: 2 });
      const p2 = await r.members.page({ limit: 2, cursor: p1.nextCursor });
      assert.deepEqual(
        [...p1.items, ...p2.items].map((m) => m.id),
        ['r1', 'r2', 'r3'],
      );
      assert.equal(p2.nextCursor, undefined);
    });

    it('sessions: live per member, newest first; revoke-all keeps the named one', async () => {
      await r.sessions.put(session('s1', 'r1', 1000), Date.now() + 60_000);
      await r.sessions.put(session('s2', 'r1', 3000), Date.now() + 60_000);
      await r.sessions.put(session('s3', 'r2', 2000), Date.now() + 60_000);
      assert.deepEqual(
        (await r.sessions.listAll()).map((s) => s.id),
        ['s2', 's3', 's1'],
      );
      assert.equal(await r.sessions.deleteAllFor('r1', 's2'), 1);
      assert.equal(await r.sessions.get('s1'), undefined);
      assert.equal((await r.sessions.get('s2'))?.memberId, 'r1');
      assert.equal(await r.sessions.delete('s2'), true);
      assert.equal(await r.sessions.delete('s2'), false);
      assert.equal(await r.sessions.deleteCreatedBefore(2500), 1);
      assert.equal(await r.sessions.count(), 0);
    });

    it('tasks: keys are unique under concurrent allocation', async () => {
      const keys = await Promise.all(Array.from({ length: 15 }, () => r.tasks.allocateKey('RB')));
      assert.equal(new Set(keys).size, 15);
      for (const k of keys) assert.match(k, /^RB-\d+$/);
    });

    it('tasks: search filters and orders by due then insertion; pages by keyset', async () => {
      await r.tasks.insert(task('RB-1', { due: '2026-12-03' }));
      await r.tasks.insert(task('RB-2', { due: '2026-12-01', status: 'done' }));
      await r.tasks.insert(task('RB-3', { due: '2026-12-01', title: 'Needle here' }));
      await r.tasks.insert(task('BL-1', { product: 'blog' }));
      assert.equal(await r.tasks.insert(task('RB-1')), false, 'duplicate key refused');
      const found = await r.tasks.search({ products: ['renewberry'] }, { limit: 10, offset: 0 });
      assert.equal(found.total, 3);
      assert.deepEqual(
        found.items.map((t) => t.key),
        ['RB-2', 'RB-3', 'RB-1'],
      );
      const q = await r.tasks.search({ q: 'NEEDLE' }, { limit: 10, offset: 0 });
      assert.deepEqual(
        q.items.map((t) => t.key),
        ['RB-3'],
      );
      const open = await r.tasks.search(
        { statuses: ['backlog'], products: ['renewberry'] },
        {
          limit: 1,
          offset: 1,
        },
      );
      assert.equal(open.total, 2);
      assert.deepEqual(
        open.items.map((t) => t.key),
        ['RB-1'],
      );
      const p1 = await r.tasks.page({ products: ['renewberry'] }, { limit: 2 });
      const p2 = await r.tasks.page(
        { products: ['renewberry'] },
        { limit: 2, cursor: p1.nextCursor },
      );
      assert.deepEqual(
        [...p1.items, ...p2.items].map((t) => t.key),
        ['RB-2', 'RB-3', 'RB-1'],
      );
    });

    it('tasks: concurrent patches of different fields both survive', async () => {
      const a = (await r.tasks.get('RB-1'))!;
      const b = (await r.tasks.get('RB-1'))!;
      a.status = 'review';
      b.priority = 'urgent';
      await Promise.all([r.tasks.put(a), r.tasks.put(b)]);
      const t = (await r.tasks.get('RB-1'))!;
      assert.equal(t.status, 'review');
      assert.equal(t.priority, 'urgent');
    });

    it('task events and comments: ordered by time, counted, and deleted with the task', async () => {
      await r.taskEvents.append({
        id: 'e2',
        taskKey: 'RB-3',
        actor: 'r2',
        at: '2026-11-02T00:00:00.000Z',
        kind: 'assignee',
        to: 'r1',
      });
      await r.taskEvents.append({
        id: 'e1',
        taskKey: 'RB-3',
        actor: 'r1',
        at: '2026-11-01T00:00:00.000Z',
        kind: 'created',
      });
      await r.taskEvents.append({
        id: 'e3',
        taskKey: 'RB-3',
        actor: 'r3',
        at: '2026-11-03T00:00:00.000Z',
        kind: 'assignee',
        to: 'r2',
      });
      assert.deepEqual(
        (await r.taskEvents.list(['RB-3'])).map((e) => e.id),
        ['e1', 'e2', 'e3'],
      );
      assert.equal(await r.taskEvents.latestActor('RB-3', 'assignee'), 'r3');
      await r.taskComments.insert({
        id: 'c1',
        taskKey: 'RB-3',
        author: 'r1',
        text: 'hi',
        at: '2026-11-04T00:00:00.000Z',
      });
      await r.taskComments.insert({
        id: 'c2',
        taskKey: 'RB-3',
        author: 'r2',
        text: 'yo',
        at: '2026-11-05T00:00:00.000Z',
      });
      assert.deepEqual(
        [...(await r.taskComments.countByTask(['RB-3', 'RB-2']))],
        [
          ['RB-3', 2],
          ['RB-2', 0],
        ],
      );
      assert.equal(await r.tasks.delete('RB-3'), true);
      assert.deepEqual(await r.taskEvents.list(['RB-3']), []);
      assert.deepEqual(await r.taskComments.list(['RB-3']), []);
    });

    it('notifications: inbox keyset newest first, unread counts, read marks and digest', async () => {
      for (const [i, at] of ['01', '02', '03', '04'].entries())
        await r.notifications.insert(
          note(`ntf-00${i}`, 'r1', { at: `2026-11-${at}T10:00:00.000Z`, refId: `ref-${i}` }),
        );
      await r.notifications.insert(note('ntf-009', 'r2', { kind: 'approval', refId: 'deploy:1' }));
      const p1 = await r.notifications.inbox('r1', { limit: 3 });
      assert.deepEqual(
        p1.items.map((n) => n.id),
        ['ntf-003', 'ntf-002', 'ntf-001'],
      );
      assert.equal(p1.hasMore, true);
      const p2 = await r.notifications.inbox('r1', { limit: 3, before: 'ntf-001' });
      assert.deepEqual(
        p2.items.map((n) => n.id),
        ['ntf-000'],
      );
      assert.equal((await r.notifications.findUnread('r1', 'mention', 'ref-2'))?.id, 'ntf-002');
      assert.equal(
        await r.notifications.markRead('r1', ['ntf-002', 'ntf-009'], '2026-11-06T00:00:00.000Z'),
        1,
      );
      assert.equal(await r.notifications.countUnread('r1'), 3);
      assert.equal(await r.notifications.findUnread('r1', 'mention', 'ref-2'), undefined);
      assert.equal(
        await r.notifications.markRefRead('approval', 'deploy:1', '2026-11-06T00:00:00.000Z'),
        1,
      );
      const digest = await r.notifications.pendingDigest('2026-11-02T12:00:00.000Z');
      assert.deepEqual(digest.map((n) => n.id).sort(), ['ntf-000', 'ntf-001']);
      await r.notifications.markEmailed(['ntf-000'], '2026-11-06T00:00:00.000Z');
      assert.deepEqual(
        (await r.notifications.pendingDigest('2026-11-02T12:00:00.000Z')).map((n) => n.id),
        ['ntf-001'],
      );
      assert.equal(await r.notifications.markRead('r1', 'all', '2026-11-07T00:00:00.000Z'), 3);
      assert.equal(await r.notifications.countUnread('r1'), 0);
    });
  });
}
