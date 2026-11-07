/** Incident recovery steps and follow-ups: CRUD, permissions, scope, validation, records. */
import '../setup.ts';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { errorCode, startApp, type Client, type TestServer } from '../helpers/server.ts';
import { signInAll, type DemoKey } from '../helpers/auth.ts';

interface Action {
  id: string;
  incidentId: string;
  title: string;
  detail: string | null;
  owner: string;
  due: string | null;
  status: 'open' | 'in-progress' | 'done';
  kind: 'mitigation' | 'follow-up';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
}
interface Incident {
  id: string;
  product: string;
  openActions?: number;
  timeline: { by: string; note: string }[];
}
interface AuditRow {
  actor: string;
  action: string;
  target: string;
  requestId?: string;
}
interface NotificationList {
  items: { kind: string; refId: string; link: string; title: string; body: string }[];
}

let app: TestServer;
let as: Record<DemoKey, Client>;
let renewberry: string;
let blog: string;

before(async () => {
  app = await startApp();
  as = await signInAll(app);
  const r = await as.operations.post<Incident>('/api/incidents', {
    product: 'renewberry',
    title: 'Checkout errors spike',
    severity: 'SEV2',
  });
  assert.equal(r.status, 201, r.text);
  renewberry = r.json.id;
  const b = await as.operations.post<Incident>('/api/incidents', {
    product: 'blog',
    title: 'Blog CDN outage',
    severity: 'SEV3',
  });
  assert.equal(b.status, 201, b.text);
  blog = b.json.id;
});
after(() => app.close());

const base = (id: string) => `/api/incidents/${id}/actions`;
const add = (c: Client, id: string, body: Record<string, unknown>) =>
  c.post<Action>(base(id), body);

describe('incident actions — CRUD', () => {
  it('adds, lists, completes, reopens and deletes a step', async () => {
    const created = await add(as.operations, renewberry, {
      title: 'Roll back the payment config',
      detail: 'Revert to the config from Tuesday',
      owner: 'm4',
      due: '2026-11-08',
      kind: 'mitigation',
    });
    assert.equal(created.status, 201, created.text);
    const a = created.json;
    assert.match(a.id, /^act-/);
    assert.deepEqual(
      [a.incidentId, a.owner, a.due, a.status, a.kind, a.createdBy, a.doneAt],
      [renewberry, 'm4', '2026-11-08', 'open', 'mitigation', 'm11', null],
    );
    assert.equal(a.createdAt, a.updatedAt);

    const list = await as.developer.get<Action[]>(base(renewberry));
    assert.equal(list.status, 200);
    assert.ok(
      list.json.some((x) => x.id === a.id),
      'visible to anyone in the product',
    );

    const started = await as.operations.patch<Action>(`${base(renewberry)}/${a.id}`, {
      status: 'in-progress',
    });
    assert.equal(started.json.status, 'in-progress');
    assert.equal(started.json.doneAt, null);

    const done = await as.operations.patch<Action>(`${base(renewberry)}/${a.id}`, {
      status: 'done',
    });
    assert.equal(done.status, 200, done.text);
    assert.equal(done.json.status, 'done');
    assert.ok(done.json.doneAt);
    assert.ok(done.json.updatedAt >= a.updatedAt);

    const reopened = await as.operations.patch<Action>(`${base(renewberry)}/${a.id}`, {
      status: 'open',
    });
    assert.equal(reopened.json.doneAt, null);

    const del = await as.operations.delete(`${base(renewberry)}/${a.id}`);
    assert.equal(del.status, 204);
    const after = await as.operations.get<Action[]>(base(renewberry));
    assert.ok(!after.json.some((x) => x.id === a.id));
    assert.equal((await as.operations.delete(`${base(renewberry)}/${a.id}`)).status, 404);
  });

  it('defaults: owner is the creator, kind is mitigation, no due date or detail', async () => {
    const res = await add(as.admin, renewberry, { title: 'Page the payments vendor' });
    assert.equal(res.status, 201, res.text);
    assert.deepEqual(
      [res.json.owner, res.json.kind, res.json.due, res.json.detail],
      ['m1', 'mitigation', null, null],
    );
  });

  it('edits fields, clears the due date and moves a step to follow-ups', async () => {
    const { json: a } = await add(as.operations, renewberry, {
      title: 'Write postmortem',
      due: '2026-11-20',
    });
    const res = await as.operations.patch<Action>(`${base(renewberry)}/${a.id}`, {
      title: 'Write the postmortem',
      due: null,
      kind: 'follow-up',
    });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(
      [res.json.title, res.json.due, res.json.kind],
      ['Write the postmortem', null, 'follow-up'],
    );
    const noop = await as.operations.patch(`${base(renewberry)}/${a.id}`, { kind: 'follow-up' });
    assert.equal(noop.status, 422);
    assert.equal(errorCode(noop), 'no_change');
  });

  it('the incident list carries an open-action count', async () => {
    const { json: a } = await add(as.operations, blog, { title: 'Purge the CDN cache' });
    const count = async () =>
      (await as.operations.get<Incident[]>('/api/incidents')).json.find((i) => i.id === blog)
        ?.openActions;
    assert.equal(await count(), 1);
    await as.operations.patch(`${base(blog)}/${a.id}`, { status: 'done' });
    assert.equal(await count(), 0);
  });

  it('an action id from another incident is 404', async () => {
    const { json: a } = await add(as.operations, blog, { title: 'Blog-only step' });
    const res = await as.operations.patch(`${base(renewberry)}/${a.id}`, { status: 'done' });
    assert.equal(res.status, 404);
    assert.equal((await as.operations.delete(`${base(renewberry)}/${a.id}`)).status, 404);
  });
});

describe('incident actions — permissions', () => {
  it('create/update need Infrastructure ≥ contribute (Owner, Operations only)', async () => {
    const { json: a } = await add(as.operations, renewberry, { title: 'Scale the API pool' });
    for (const key of ['pm', 'developer', 'designer', 'tester'] as const) {
      const c = await add(as[key], renewberry, { title: `By ${key}` });
      assert.equal(c.status, 403, `${key} create`);
      assert.equal(errorCode(c), 'forbidden');
      const u = await as[key].patch(`${base(renewberry)}/${a.id}`, { status: 'done' });
      assert.equal(u.status, 403, `${key} update`);
      const d = await as[key].delete(`${base(renewberry)}/${a.id}`);
      assert.equal(d.status, 403, `${key} delete`);
      assert.equal((await as[key].get(base(renewberry))).status, 200, `${key} can read`);
    }
    for (const key of ['admin', 'operations'] as const)
      assert.equal((await add(as[key], renewberry, { title: `By ${key}` })).status, 201, key);
  });

  it('delete needs Infrastructure ≥ manage: a contribute-scoped token can add but not delete', async () => {
    const issued = await as.operations.post<{ token: string }>('/api/tokens', {
      name: 'incident bot',
      scopes: ['infrastructure:contribute'],
      expiresInDays: 7,
    });
    assert.equal(issued.status, 201, issued.text);
    const bot = app.client({ token: issued.json.token });
    const created = await add(bot, renewberry, { title: 'Added by a token' });
    assert.equal(created.status, 201, created.text);
    const del = await bot.delete(`${base(renewberry)}/${created.json.id}`);
    assert.equal(del.status, 403);
    assert.equal(errorCode(del), 'forbidden');
    assert.equal((await as.admin.delete(`${base(renewberry)}/${created.json.id}`)).status, 204);
  });

  it('an incident outside the caller’s products is 404, whatever the role', async () => {
    const { json: a } = await add(as.operations, blog, { title: 'Blog step' });
    for (const key of ['pm', 'developer', 'designer', 'tester'] as const) {
      assert.equal((await as[key].get(base(blog))).status, 404, `${key} list`);
      assert.equal((await add(as[key], blog, { title: 'x' })).status, 404, `${key} create`);
      assert.equal(
        (await as[key].patch(`${base(blog)}/${a.id}`, { status: 'done' })).status,
        404,
        `${key} update`,
      );
      assert.equal((await as[key].delete(`${base(blog)}/${a.id}`)).status, 404, `${key} delete`);
    }
    assert.equal((await as.operations.get(base('INC-99999'))).status, 404);
  });
});

describe('incident actions — validation', () => {
  it('rejects bad bodies with 422', async () => {
    for (const body of [
      {},
      { title: '' },
      { title: 'x'.repeat(201) },
      { title: 'ok', kind: 'cleanup' },
      { title: 'ok', status: 'done' },
      { title: 'ok', due: '2026-02-30' },
      { title: 'ok', due: 'tomorrow' },
      { title: 'ok', detail: 'x'.repeat(2001) },
      { title: 'ok', owner: 'm 4' },
      { title: 'ok', role: 'Owner' },
    ]) {
      const res = await add(as.operations, renewberry, body);
      assert.equal(res.status, 422, JSON.stringify(body));
      assert.equal(errorCode(res), 'validation_failed', JSON.stringify(body));
    }
    assert.equal((await add(as.operations, renewberry, { title: 'x'.repeat(200) })).status, 201);
  });

  it('the owner must be an active member who can see the product', async () => {
    for (const owner of ['m4' /* renewberry only */, 'm12' /* invited */, 'm999']) {
      const res = await add(as.operations, blog, { title: 'Wrong owner', owner });
      assert.equal(res.status, 422, owner);
      assert.equal(errorCode(res), 'invalid_owner', owner);
    }
    const { json: a } = await add(as.operations, blog, { title: 'Right owner', owner: 'm6' });
    const res = await as.operations.patch(`${base(blog)}/${a.id}`, { owner: 'm4' });
    assert.equal(res.status, 422);
    assert.equal(errorCode(res), 'invalid_owner');
    const bad = await as.operations.patch(`${base(blog)}/${a.id}`, { status: 'closed' });
    assert.equal(bad.status, 422);
  });
});

describe('incident actions — records', () => {
  it('every write appends a timeline entry and an audit entry', async () => {
    const { json: a } = await add(as.operations, renewberry, {
      title: 'Disable the new checkout flag',
      owner: 'm4',
    });
    await as.operations.patch(`${base(renewberry)}/${a.id}`, { status: 'done' });
    await as.operations.delete(`${base(renewberry)}/${a.id}`);

    const inc = await as.operations.get<Incident>(`/api/incidents/${renewberry}`);
    const notes = inc.json.timeline
      .map((t) => t.note)
      .filter((n) => n.includes('Disable the new checkout flag'));
    assert.equal(notes.length, 3, JSON.stringify(notes));
    assert.match(notes[0], /^Action added · Mitigation: .* → Kofi/);
    assert.match(notes[1], /^Action completed: /);
    assert.match(notes[2], /^Action removed: /);
    assert.ok(inc.json.timeline.slice(-3).every((t) => t.by === 'm11'));

    const audit = await as.admin.get<AuditRow[]>('/api/audit?action=incident.action_&limit=500');
    const mine = audit.json.filter((e) => e.target.includes(a.id));
    assert.deepEqual(mine.map((e) => e.action).sort(), [
      'incident.action_added',
      'incident.action_completed',
      'incident.action_removed',
    ]);
    assert.ok(
      mine.every((e) => e.actor === 'm11' && e.requestId && e.target.startsWith(renewberry)),
    );
  });

  it('assigning an owner notifies them; reassigning notifies the new owner', async () => {
    const { json: a } = await add(as.operations, renewberry, {
      title: 'Rotate the leaked API key',
      owner: 'm4',
    });
    const devInbox = await as.developer.get<NotificationList>('/api/notifications?kind=assignment');
    const n = devInbox.json.items.find((x) => x.refId === `incident-action:${a.id}:owner:m4`);
    assert.ok(n, 'developer notified');
    assert.equal(n.link, `/incidents/${renewberry}`);
    assert.equal(n.body, 'Rotate the leaked API key');

    const moved = await as.operations.patch<Action>(`${base(renewberry)}/${a.id}`, {
      owner: 'm10',
    });
    assert.equal(moved.json.owner, 'm10');
    const testerInbox = await as.tester.get<NotificationList>('/api/notifications?kind=assignment');
    assert.ok(testerInbox.json.items.some((x) => x.refId === `incident-action:${a.id}:owner:m10`));
    const inc = await as.operations.get<Incident>(`/api/incidents/${renewberry}`);
    assert.match(inc.json.timeline.at(-1)!.note, /^Action reassigned: .* → Ravi/);

    // Assigning yourself sends nothing.
    const self = await add(as.operations, renewberry, { title: 'Watch the dashboards' });
    const opsInbox = await as.operations.get<NotificationList>(
      '/api/notifications?kind=assignment',
    );
    assert.ok(
      !opsInbox.json.items.some((x) => x.refId.startsWith(`incident-action:${self.json.id}`)),
    );
  });
});
