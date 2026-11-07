import '../setup.ts';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { errorCode, startApp, type Client, type TestServer } from '../helpers/server.ts';
import { signInAll, type DemoKey } from '../helpers/auth.ts';

interface TaskJson {
  key: string;
  title: string;
  product: string;
  status: string;
  assignee: string;
  reviewer?: string;
  priority: string;
  comments: number;
  overdue: boolean;
  createdBy: string;
}

let app: TestServer;
let as: Record<DemoKey, Client>;
before(async () => {
  app = await startApp();
  as = await signInAll(app);
});
after(() => app.close());

const newTask = (over: Record<string, unknown> = {}) => ({
  projectId: 'p1',
  title: 'Integration task',
  type: 'task',
  priority: 'medium',
  assignee: 'm4',
  due: '2030-01-31',
  estimate: 2,
  ...over,
});

async function create(c: Client, over: Record<string, unknown> = {}) {
  const res = await c.post<TaskJson>('/api/tasks', newTask(over));
  assert.equal(res.status, 201, res.text);
  return res;
}

describe('tasks — create', () => {
  it('creates with server-assigned key, product, creator and backlog status', async () => {
    const res = await create(as.developer);
    assert.match(res.json.key, /^RB-\d+$/);
    assert.equal(res.json.product, 'renewberry');
    assert.equal(res.json.status, 'backlog');
    assert.equal(res.json.createdBy, 'm4');
    assert.equal(res.json.comments, 0);
    assert.equal(res.headers.get('location'), `/api/tasks/${res.json.key}`);
  });

  it('keys increase monotonically per product', async () => {
    const a = await create(as.developer);
    const b = await create(as.developer);
    assert.equal(Number(b.json.key.split('-')[1]), Number(a.json.key.split('-')[1]) + 1);
  });

  it('validates the body (types, bounds, unknown fields)', async () => {
    const bad: Record<string, unknown>[] = [
      { title: 'ab' },
      { title: 'x'.repeat(161) },
      { type: 'epic' },
      { priority: 'critical' },
      { due: '31/01/2030' },
      { estimate: 0 },
      { estimate: 41 },
      { estimate: 1.5 },
      { status: 'archived' },
      { createdBy: 'm1' },
      { product: 'blog' },
    ];
    for (const over of bad) {
      const res = await as.developer.post('/api/tasks', newTask(over));
      assert.equal(res.status, 422, JSON.stringify(over));
    }
  });

  it('refuses assignees and reviewers outside the product or inactive', async () => {
    for (const over of [
      { assignee: 'm6' },
      { assignee: 'm12' },
      { assignee: 'nobody' },
      { reviewer: 'm3' },
    ]) {
      const res = await as.developer.post('/api/tasks', newTask(over));
      assert.equal(res.status, 422, JSON.stringify(over));
      assert.equal(errorCode(res), 'assignee_invalid');
    }
  });

  it('cannot create in another product’s project (404, not 403)', async () => {
    const res = await as.developer.post('/api/tasks', newTask({ projectId: 'p4', assignee: 'm6' }));
    assert.equal(res.status, 404);
    const missing = await as.developer.post('/api/tasks', newTask({ projectId: 'p999' }));
    assert.equal(missing.status, 404);
  });
});

describe('tasks — update and workflow rules', () => {
  it('records one event per changed field and ignores unchanged ones', async () => {
    const { json: t } = await create(as.developer);
    const res = await as.developer.patch<TaskJson>(`/api/tasks/${t.key}`, {
      priority: 'high',
      status: 'in-progress',
      title: t.title,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.priority, 'high');
    const act = await as.developer.get<{
      events: { taskKey: string; kind: string; from?: string; to?: string }[];
    }>('/api/tasks/_activity');
    const events = act.json.events.filter((e) => e.taskKey === t.key);
    assert.deepEqual(events[0].kind, 'created');
    assert.deepEqual(
      events
        .slice(1)
        .map((e) => [e.kind, e.from, e.to])
        .sort(),
      [
        ['priority', 'medium', 'high'],
        ['status', 'backlog', 'in-progress'],
      ],
      'one event per changed field; the unchanged title records nothing',
    );
  });

  it('an assignee cannot move their own task to done; a reviewer or manager can', async () => {
    const { json: t } = await create(as.developer, { reviewer: 'm10' });
    const self = await as.developer.patch(`/api/tasks/${t.key}`, { status: 'done' });
    assert.equal(self.status, 403);
    assert.equal(errorCode(self), 'self_close');
    const reviewer = await as.tester.patch<TaskJson>(`/api/tasks/${t.key}`, { status: 'done' });
    assert.equal(reviewer.status, 200);
    assert.equal(reviewer.json.status, 'done');
  });

  it('a manager may close their own task', async () => {
    const { json: t } = await create(as.pm, { assignee: 'm2' });
    const res = await as.pm.patch(`/api/tasks/${t.key}`, { status: 'done' });
    assert.equal(res.status, 200);
  });

  // FINDING B-6 — FIXED on wave4/integration, kept as a regression guard. Was (routes/tasks.routes.ts:256): the self-close rule only checks
  // the *current* assignee. An assignee can hand the task to a colleague and
  // close it in the same PATCH ({assignee:'m5', status:'done'}) — nobody else
  // ever looked at it. The rule should apply to the caller being the
  // assignee before or after the patch.
  it('the self-close rule cannot be bypassed by reassigning in the same request', async () => {
    const { json: t } = await create(as.developer);
    const res = await as.developer.patch(`/api/tasks/${t.key}`, {
      assignee: 'm5',
      status: 'done',
    });
    assert.equal(res.status, 403);
  });

  it('validates patches and rejects unknown fields', async () => {
    const { json: t } = await create(as.developer);
    for (const body of [
      { role: 'Owner' },
      { status: 'nope' },
      { estimate: 99 },
      { key: 'RB-1' },
      { product: 'blog' },
    ])
      assert.equal(
        (await as.developer.patch(`/api/tasks/${t.key}`, body)).status,
        422,
        JSON.stringify(body),
      );
  });

  it('keys are case-insensitive', async () => {
    const { json: t } = await create(as.developer);
    assert.equal((await as.developer.get(`/api/tasks/${t.key.toLowerCase()}`)).status, 200);
  });
});

describe('tasks — comments, subtasks, time', () => {
  it('derives the comment count on read and records activity', async () => {
    const { json: t } = await create(as.developer);
    const c = await as.designer.post<{ author: string }>(`/api/tasks/${t.key}/comments`, {
      text: 'x'.repeat(100),
    });
    assert.equal(c.status, 201);
    assert.equal(c.json.author, 'm9');
    assert.equal((await as.developer.get<TaskJson>(`/api/tasks/${t.key}`)).json.comments, 1);
    const act = await as.developer.get<{
      events: { taskKey: string; kind: string; note?: string }[];
    }>('/api/tasks/_activity');
    const note = act.json.events.find((e) => e.taskKey === t.key && e.kind === 'comment')?.note;
    assert.equal(note, `${'x'.repeat(80)}…`, 'long comments are abbreviated in the timeline');
  });

  it('completes and reopens subtasks, tracking who did it', async () => {
    const { json: t } = await create(as.developer);
    const st = await as.developer.post<{ id: string }>(`/api/tasks/${t.key}/subtasks`, {
      title: 'step',
    });
    assert.equal(st.status, 201);
    const done = await as.tester.patch<{ done: boolean; doneBy?: string }>(
      `/api/tasks/${t.key}/subtasks/${st.json.id}`,
      { done: true },
    );
    assert.deepEqual([done.json.done, done.json.doneBy], [true, 'm10']);
    const reopened = await as.developer.patch<{ done: boolean; doneBy?: string }>(
      `/api/tasks/${t.key}/subtasks/${st.json.id}`,
      { done: false },
    );
    assert.deepEqual([reopened.json.done, reopened.json.doneBy], [false, undefined]);
    const other = await create(as.developer);
    const wrongTask = await as.developer.patch(
      `/api/tasks/${other.json.key}/subtasks/${st.json.id}`,
      { done: true },
    );
    assert.equal(wrongTask.status, 404, 'subtask must belong to the task in the URL');
  });

  it('logs time within bounds', async () => {
    const { json: t } = await create(as.developer);
    assert.equal(
      (await as.developer.post(`/api/tasks/${t.key}/time`, { minutes: 30, note: 'pairing' }))
        .status,
      201,
    );
    for (const minutes of [0, 24 * 60 + 1, 2.5, -1])
      assert.equal(
        (await as.developer.post(`/api/tasks/${t.key}/time`, { minutes })).status,
        422,
        String(minutes),
      );
  });
});

describe('tasks — list and delete', () => {
  it('filters by status, priority, assignee=me and q, and pages', async () => {
    const mine = await as.developer.get<{ items: TaskJson[]; total: number }>(
      '/api/tasks?assignee=me&limit=200',
    );
    assert.ok(mine.json.items.length > 0);
    assert.ok(mine.json.items.every((t) => t.assignee === 'm4'));
    const urgent = await as.developer.get<{ items: TaskJson[] }>('/api/tasks?priority=urgent,high');
    assert.ok(urgent.json.items.every((t) => ['urgent', 'high'].includes(t.priority)));
    const q = await as.admin.get<{ items: TaskJson[] }>('/api/tasks?q=password%20reset');
    assert.ok(q.json.items.some((t) => t.key === 'RB-212'));
    const page = await as.admin.get<{ items: TaskJson[]; limit: number; total: number }>(
      '/api/tasks?limit=2&offset=1',
    );
    assert.equal(page.json.items.length, 2);
    assert.equal(page.headers.get('x-total-count'), String(page.json.total));
    const clamped = await as.admin.get<{ limit: number }>('/api/tasks?limit=100000');
    assert.equal(clamped.json.limit, 200);
  });

  it('a manager deletes a task and its activity; it is gone afterwards', async () => {
    const { json: t } = await create(as.developer);
    await as.developer.post(`/api/tasks/${t.key}/comments`, { text: 'bye' });
    assert.equal((await as.pm.delete(`/api/tasks/${t.key}`)).status, 204);
    assert.equal((await as.pm.get(`/api/tasks/${t.key}`)).status, 404);
    const act = await as.pm.get<{ events: { taskKey: string }[]; comments: { taskKey: string }[] }>(
      '/api/tasks/_activity',
    );
    assert.ok(!act.json.events.some((e) => e.taskKey === t.key));
    assert.ok(!act.json.comments.some((e) => e.taskKey === t.key));
  });

  it('every write is in the audit trail', async () => {
    const { json: t } = await create(as.developer);
    const trail =
      await as.admin.get<{ action: string; target: string }[]>('/api/audit?action=task.');
    assert.ok(trail.json.some((e) => e.action === 'task.created' && e.target.startsWith(t.key)));
  });
});
