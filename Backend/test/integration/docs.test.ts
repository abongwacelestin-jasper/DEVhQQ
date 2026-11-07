import '../setup.ts';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, type Client, type TestServer } from '../helpers/server.ts';
import { signInAll, type DemoKey } from '../helpers/auth.ts';

interface Doc {
  id: string;
  title: string;
  product: string;
  status: string;
  visibility: string;
  editors: string[];
  updatedBy: string;
  body?: string;
}

let app: TestServer;
let as: Record<DemoKey, Client>;
before(async () => {
  app = await startApp();
  as = await signInAll(app);
});
after(() => app.close());

const draft = (over: Record<string, unknown> = {}) => ({
  projectId: 'p1',
  title: 'Design notes',
  kind: 'spec',
  visibility: 'project',
  body: '# Notes\n\n<script>alert(1)</script> stays text',
  ...over,
});

describe('docs', () => {
  it('lists metadata only (no bodies) and filters by project and q', async () => {
    const all = await as.admin.get<Doc[]>('/api/docs');
    assert.ok(all.json.length >= 2);
    assert.ok(all.json.every((d) => d.body === undefined));
    const p3 = await as.admin.get<Doc[]>('/api/docs?projectId=p3');
    assert.deepEqual(
      p3.json.map((d) => d.id),
      ['doc-api-runbook'],
    );
    const q = await as.admin.get<Doc[]>('/api/docs?q=invoice');
    assert.deepEqual(
      q.json.map((d) => d.id),
      ['doc-payments-spec'],
      'q searches bodies too',
    );
  });

  it('creates a draft with the creator as editor; body is stored verbatim', async () => {
    const res = await as.designer.post<Doc>('/api/docs', draft());
    assert.equal(res.status, 200);
    assert.equal(res.json.status, 'draft');
    assert.deepEqual(res.json.editors, ['m9']);
    assert.equal(res.json.product, 'renewberry');
    assert.match(res.json.id, /^doc-/);
    const read = await as.developer.get<Doc>(`/api/docs/${res.json.id}`);
    assert.equal(read.json.body, draft().body);
  });

  it('refuses smuggled fields and bad enums', async () => {
    for (const over of [
      { editors: ['m2'] },
      { status: 'published' },
      { kind: 'memo' },
      { visibility: 'public' },
      { title: '' },
    ])
      assert.equal(
        (await as.developer.post('/api/docs', draft(over))).status,
        422,
        JSON.stringify(over),
      );
    assert.equal((await as.developer.post('/api/docs', draft({ projectId: 'p4' }))).status, 404);
  });

  it('restricted docs are visible to editors and Owners only; editing adds the editor', async () => {
    const created = await as.developer.post<Doc>(
      '/api/docs',
      draft({ visibility: 'restricted', title: 'Secret' }),
    );
    const id = created.json.id;
    assert.equal((await as.designer.get(`/api/docs/${id}`)).status, 404);
    assert.equal((await as.pm.get(`/api/docs/${id}`)).status, 404);
    assert.ok(
      !(await as.pm.get<Doc[]>('/api/docs')).json.some((d) => d.id === id),
      'hidden from lists',
    );
    assert.equal((await as.admin.get(`/api/docs/${id}`)).status, 200);
    const edited = await as.admin.patch<Doc>(`/api/docs/${id}`, { status: 'in-review' });
    assert.equal(edited.status, 200);
    assert.deepEqual(edited.json.editors, ['m4', 'm1']);
    assert.equal(edited.json.updatedBy, 'm1');
  });

  it('patch validates and only changes provided fields', async () => {
    const { json: d } = await as.developer.post<Doc>('/api/docs', draft());
    const res = await as.developer.patch<Doc>(`/api/docs/${d.id}`, { title: 'Renamed' });
    assert.equal(res.json.title, 'Renamed');
    assert.equal(res.json.body, d.body);
    for (const body of [{ visibility: 'workspace' }, { editors: [] }, { status: 'gone' }])
      assert.equal(
        (await as.developer.patch(`/api/docs/${d.id}`, body)).status,
        422,
        JSON.stringify(body),
      );
  });

  it('a manager deletes; the doc is gone and the deletion is audited as sensitive', async () => {
    const { json: d } = await as.developer.post<Doc>('/api/docs', draft({ title: 'To delete' }));
    assert.equal((await as.pm.delete(`/api/docs/${d.id}`)).status, 204);
    assert.equal((await as.pm.get(`/api/docs/${d.id}`)).status, 404);
    const trail =
      await as.admin.get<{ action: string; target: string; sensitive: boolean }[]>(
        '/api/audit?sensitive=1',
      );
    assert.ok(trail.json.some((e) => e.action === 'doc.deleted' && e.target === 'To delete'));
  });
});
