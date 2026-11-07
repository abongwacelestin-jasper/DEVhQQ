/**
 * End-to-end smoke test. Boots the app in-process on a random port and walks
 * the critical paths: health, demo sign-in for every role, password + MFA,
 * scoped reads, a write, the query runner and the security checks that must
 * fail closed. Exits non-zero on the first failure.
 *
 *   npm run smoke   (also: npm test)
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

// Isolate each run's audit file so repeated gate runs never share state.
process.env.AUDIT_LOG_FILE = `/tmp/devhq-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`;
// STORAGE: fresh local object store per run (unused when S3_ENDPOINT points at MinIO).
process.env.STORAGE_LOCAL_DIR ??= `/tmp/devhq-smoke-objects-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const { buildApp } = await import('../server.ts');
const router = await buildApp();
const server = createServer((req, res) => void router.handle(req, res));
await new Promise<void>((r) => server.listen(0, r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
let passed = 0;

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-DevHQ-Client': 'console',
      'User-Agent': 'devhq-smoke',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

function expect(name: string, cond: boolean, detail?: unknown) {
  if (!cond) {
    console.error(`✗ ${name}`, detail ?? '');
    server.close();
    process.exit(1);
  }
  passed++;
  console.log(`✓ ${name}`);
}

async function raw(path: string) {
  const res = await fetch(base + path, { headers: { 'User-Agent': 'devhq-smoke' } });
  return {
    status: res.status,
    text: await res.text(),
    type: res.headers.get('content-type') ?? '',
    csp: res.headers.get('content-security-policy') ?? '',
  };
}

const health = await call('GET', '/api/health');
expect('health is 200', health.status === 200);

const consolePage = await raw('/console');
expect(
  'backend console renders the operations UI',
  consolePage.status === 200 &&
    consolePage.type.startsWith('text/html') &&
    consolePage.text.includes('<title>DevHQ · Backend control room</title>') &&
    consolePage.text.includes('API explorer') &&
    consolePage.text.includes('Security & audit') &&
    consolePage.text.includes('Team & access') &&
    consolePage.text.includes('@media (max-width: 860px)') &&
    consolePage.text.includes('@media (max-width: 430px)'),
  `${consolePage.status} ${consolePage.type}`,
);
expect(
  'console navigation exposes functional sidebar, mobile drawer and command search',
  consolePage.text.includes('id="sidebar-collapse"') &&
    consolePage.text.includes('id="mobile-more"') &&
    consolePage.text.includes('id="global-search"') &&
    consolePage.text.includes('id="refresh-current"') &&
    consolePage.text.includes('id="profile-menu"'),
);
expect(
  'console exposes guided deployment, incident, backup and access controls',
  consolePage.text.includes('id="deployment-form"') &&
    consolePage.text.includes('id="incident-update-form"') &&
    consolePage.text.includes('data-action="create-backup"') &&
    consolePage.text.includes('id="member-update-form"') &&
    consolePage.text.includes('id="grant-form"') &&
    consolePage.text.includes('id="sessions-table"') &&
    consolePage.text.includes('id="signins-table"'),
);
expect(
  'console exposes structured metrics and query export',
  consolePage.text.includes('id="metrics-table"') &&
    consolePage.text.includes('id="query-result-table"') &&
    consolePage.text.includes('id="export-query"') &&
    consolePage.text.includes('.overview-stats'),
);
expect(
  'console scripts are protected by a per-response nonce',
  /script-src 'nonce-[^']+'/.test(consolePage.csp) &&
    /<script nonce="[^"]+">/.test(consolePage.text),
);
const backendAlias = await raw('/backend.html');
expect(
  'backend.html alias serves the same console',
  backendAlias.status === 200 &&
    backendAlias.text.includes('<title>DevHQ · Backend control room</title>'),
);

const spec = await call('GET', '/api/openapi.json');
expect(
  'OpenAPI document lists the task routes',
  spec.status === 200 && !!(spec.json.paths as Record<string, unknown> | undefined)?.['/api/tasks'],
  spec.status,
);

for (const role of ['admin', 'pm', 'developer', 'designer', 'tester', 'operations']) {
  const r = await call('POST', '/api/auth/demo', { role });
  expect(`demo sign-in: ${role}`, r.status === 200 && typeof r.json.token === 'string', r.json);
}

const pw = await call('POST', '/api/auth/sign-in', {
  email: 'kofi@techorg.io',
  password: 'devhq-demo',
});
expect('password step accepted', pw.status === 200 && typeof pw.json.token === 'string', pw.json);
const early = await call('GET', '/api/tasks', undefined, pw.json.token as string);
expect('API refused before MFA', early.status === 401);
const mfa = await call('POST', '/api/auth/mfa/totp', { code: '246810' }, pw.json.token as string);
expect('MFA accepted', mfa.status === 200, mfa.json);
const dev = mfa.json.token as string;

const tasks = await call('GET', '/api/tasks', undefined, dev);
const items = (tasks.json.items as { product: string }[]) ?? [];
expect(
  'developer sees only renewberry tasks',
  tasks.status === 200 && items.length > 0 && items.every((t) => t.product === 'renewberry'),
  tasks.json,
);
const hidden = await call('GET', '/api/tasks/BL-17', undefined, dev);
expect('out-of-scope task is 404', hidden.status === 404);

const created = await call(
  'POST',
  '/api/tasks',
  {
    projectId: 'p1',
    title: 'Smoke test task',
    type: 'task',
    priority: 'low',
    assignee: 'm4',
    due: '2026-11-30',
    estimate: 1,
  },
  dev,
);
expect('task created', created.status === 201, created.json);

const smuggle = await call('PATCH', `/api/tasks/${created.json.key}`, { role: 'Owner' }, dev);
expect('unknown fields rejected', smuggle.status === 422);

const newKey = created.json.key as string;
const activity = await call('GET', '/api/tasks/_activity', undefined, dev);
expect(
  'task activity arrives in one call',
  activity.status === 200 &&
    Array.isArray(activity.json.events) &&
    Array.isArray(activity.json.subtasks),
  activity.json,
);

const comment = await call('POST', `/api/tasks/${newKey}/comments`, { text: 'Smoke comment' }, dev);
expect(
  'comment recorded',
  comment.status === 201 && comment.json.taskKey === newKey,
  comment.json,
);
const subtask = await call('POST', `/api/tasks/${newKey}/subtasks`, { title: 'Smoke subtask' }, dev);
expect('subtask added', subtask.status === 201, subtask.json);
const completed = await call(
  'PATCH',
  `/api/tasks/${newKey}/subtasks/${subtask.json.id}`,
  { done: true },
  dev,
);
expect('subtask completed', completed.status === 200 && completed.json.done === true, completed.json);
const time = await call('POST', `/api/tasks/${newKey}/time`, { minutes: 15, note: 'smoke' }, dev);
expect('time logged', time.status === 201 && time.json.minutes === 15, time.json);
const reread = await call('GET', `/api/tasks/${newKey}`, undefined, dev);
expect('comment count is derived on read', reread.json.comments === 1, reread.json);

const products = await call('GET', '/api/products', undefined, dev);
expect(
  'products list is scoped to the caller',
  products.status === 200 &&
    Array.isArray(products.json) &&
    (products.json as { id: string }[]).every((p) => p.id === 'renewberry'),
  products.json,
);

const q = await call(
  'POST',
  '/api/_query',
  { from: 'tasks', where: { priority: { in: ['urgent', 'high'] } }, select: ['key', 'priority'] },
  dev,
);
expect('query runner works', q.status === 200 && typeof q.json.total === 'number', q.json);
const qBad = await call('POST', '/api/_query', { from: 'members', select: ['passwordHash'] }, dev);
expect('secret fields not queryable', qBad.status === 422);

const bad = await call('POST', '/api/auth/sign-in', {
  email: 'kofi@techorg.io',
  password: 'wrong',
});
const unknown = await call('POST', '/api/auth/sign-in', {
  email: 'nobody@techorg.io',
  password: 'wrong',
});
expect(
  'same error for wrong password and unknown user',
  bad.status === 401 &&
    unknown.status === 401 &&
    (bad.json.error as { code: string }).code === (unknown.json.error as { code: string }).code,
);

// ── STORAGE (wave 4): object storage, presigned uploads, backups, audit archive ──
{
  const { runSigV4Vectors } = await import('../storage/sigv4.test.ts');
  const vectors = runSigV4Vectors();
  expect(
    `storage: SigV4 signer matches all ${vectors.length} AWS test vectors`,
    vectors.length >= 8 && vectors.every((x) => x.ok),
    vectors.filter((x) => !x.ok),
  );

  const admin = (await call('POST', '/api/auth/demo', { role: 'admin' })).json.token as string;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(56, 7),
  ]);
  type Upload = { fileId: string; uploadUrl: string; headers: Record<string, string> };
  const putTo = (u: Upload, bytes: Buffer) =>
    fetch(u.uploadUrl, { method: 'PUT', headers: u.headers, body: bytes });
  const ask = (token: string, purpose: string, contentType: string, size: number, refId: string) =>
    call('POST', '/api/files/uploads', { purpose, contentType, size, name: 'f.bin', refId }, token);

  const req = await ask(dev, 'doc-attachment', 'image/png', png.length, 'doc-payments-spec');
  const up = req.json as unknown as Upload;
  expect(
    'storage: presigned upload issued for an in-scope doc',
    req.status === 201 &&
      typeof up.uploadUrl === 'string' &&
      up.headers['Content-Type'] === 'image/png',
    req.json,
  );
  const early = await call('POST', `/api/files/${up.fileId}/complete`, {}, dev);
  expect('storage: complete before upload is 409', early.status === 409, early.json);
  const put = await putTo(up, png);
  expect('storage: direct PUT to presigned URL accepted', put.ok, put.status);
  const done = await call('POST', `/api/files/${up.fileId}/complete`, {}, dev);
  expect(
    'storage: complete verifies size + magic bytes and marks ready',
    done.status === 200 && done.json.status === 'ready',
    done.json,
  );
  const dl = await call('GET', `/api/files/${up.fileId}`, undefined, dev);
  const got = dl.status === 200 ? await fetch(dl.json.url as string) : undefined;
  const gotBytes = got ? Buffer.from(await got.arrayBuffer()) : Buffer.alloc(0);
  expect(
    'storage: presigned GET returns the exact bytes, inline for images',
    dl.status === 200 &&
      dl.json.disposition === 'inline' &&
      gotBytes.equals(png) &&
      got?.headers.get('content-type') === 'image/png',
    dl.json,
  );

  const pdf = Buffer.from('%PDF-1.7\n% smoke\n');
  const pdfReq = await ask(dev, 'doc-attachment', 'application/pdf', pdf.length, 'doc-payments-spec');
  await putTo(pdfReq.json as unknown as Upload, pdf);
  await call('POST', `/api/files/${pdfReq.json.fileId}/complete`, {}, dev);
  const pdfDl = await call('GET', `/api/files/${pdfReq.json.fileId}`, undefined, dev);
  const pdfGet = await fetch(pdfDl.json.url as string);
  await pdfGet.arrayBuffer();
  expect(
    'storage: non-images download as attachment',
    pdfDl.json.disposition === 'attachment' &&
      (pdfGet.headers.get('content-disposition') ?? '').startsWith('attachment;'),
    pdfDl.json,
  );

  for (const contentType of ['text/html', 'image/svg+xml']) {
    const r = await ask(dev, 'doc-attachment', contentType, 10, 'doc-payments-spec');
    expect(`storage: ${contentType} upload refused (415)`, r.status === 415, r.json);
  }
  const big = await ask(dev, 'avatar', 'image/png', 3 * 1024 * 1024, 'm4');
  expect('storage: oversize avatar refused (413)', big.status === 413, big.json);

  const html = Buffer.from('<html><script>alert(1)</script></html>');
  const liar = await ask(dev, 'doc-attachment', 'image/png', html.length, 'doc-payments-spec');
  const liarPut = await putTo(liar.json as unknown as Upload, html);
  expect('storage: disguised upload reaches storage', liarPut.ok, liarPut.status);
  const liarDone = await call('POST', `/api/files/${liar.json.fileId}/complete`, {}, dev);
  expect(
    'storage: magic-byte mismatch rejected',
    liarDone.status === 422 && (liarDone.json.error as { code: string }).code === 'type_mismatch',
    liarDone.json,
  );
  const short = await ask(dev, 'doc-attachment', 'image/png', 100, 'doc-payments-spec');
  const shortPut = await putTo(short.json as unknown as Upload, png);
  await shortPut.arrayBuffer();
  expect('storage: PUT of a size other than the signed one is refused', !shortPut.ok, shortPut.status);
  const cancel = await call('DELETE', `/api/files/${short.json.fileId}`, undefined, dev);
  expect('storage: pending upload can be cancelled', cancel.status === 204, cancel.json);

  const blogDoc = await call(
    'POST',
    '/api/docs',
    { projectId: 'p4', title: 'Storage smoke', kind: 'guide', visibility: 'project', body: 'x' },
    admin,
  );
  const blogDocId = blogDoc.json.id as string;
  const outReq = await ask(dev, 'doc-attachment', 'image/png', png.length, blogDocId);
  expect('storage: upload against an out-of-scope doc is 404', outReq.status === 404, outReq.json);
  const adminUp = await ask(admin, 'doc-attachment', 'image/png', png.length, blogDocId);
  await putTo(adminUp.json as unknown as Upload, png);
  await call('POST', `/api/files/${adminUp.json.fileId}/complete`, {}, admin);
  const outGet = await call('GET', `/api/files/${adminUp.json.fileId}`, undefined, dev);
  const outDel = await call('DELETE', `/api/files/${adminUp.json.fileId}`, undefined, dev);
  expect(
    'storage: out-of-scope file is 404 for read and delete',
    outGet.status === 404 && outDel.status === 404,
    [outGet.status, outDel.status],
  );
  const listed = await call('GET', '/api/files?refId=doc-payments-spec', undefined, dev);
  expect(
    'storage: attachments listed by resource',
    listed.status === 200 &&
      (listed.json.items as { id: string }[]).some((f) => f.id === up.fileId),
    listed.json,
  );

  const backup = await call('POST', '/api/backups', undefined, admin);
  const backupId = backup.json.id as string;
  expect(
    'storage: encrypted backup written to the backups bucket',
    backup.status === 201 &&
      /^bk-/.test(backupId) &&
      backup.json.encryption === 'aes-256-gcm' &&
      (backup.json.collections as Record<string, number>).files >= 2,
    backup.json,
  );
  const devRestore = await call('POST', `/api/backups/${backupId}/restore`, {}, dev);
  expect('storage: restore requires Administration:admin', devRestore.status === 403, devRestore.json);
  const dry = await call('POST', `/api/backups/${backupId}/restore`, {}, admin);
  const plan = (dry.json.plan ?? []) as { name: string; inBackup: number; unchanged: number }[];
  const filesPlan = plan.find((p) => p.name === 'files');
  expect(
    'storage: restore dry-run verifies, decrypts and diffs without writing',
    dry.status === 200 &&
      dry.json.dryRun === true &&
      dry.json.verified === true &&
      !!filesPlan &&
      filesPlan.inBackup >= 2 &&
      filesPlan.unchanged === filesPlan.inBackup,
    dry.json,
  );
  await call('DELETE', `/api/files/${pdfReq.json.fileId}`, undefined, dev);
  const noConfirm = await call('POST', `/api/backups/${backupId}/restore`, { dryRun: false }, admin);
  expect('storage: real restore needs explicit confirmation', noConfirm.status === 422, noConfirm.json);
  const real = await call(
    'POST',
    `/api/backups/${backupId}/restore`,
    { dryRun: false, confirm: backupId, collections: ['files'] },
    admin,
  );
  const back = await call('GET', '/api/files?refId=doc-payments-spec', undefined, dev);
  expect(
    'storage: real restore brings a deleted row back (after a safety backup)',
    real.status === 200 &&
      typeof real.json.safetyBackupId === 'string' &&
      (back.json.items as { id: string }[]).some((f) => f.id === pdfReq.json.fileId),
    real.json,
  );
  const drill = await call('POST', '/api/backups/drill', undefined, admin);
  expect('storage: restore drill passes on the encrypted backup', drill.json.ok === true, drill.json);

  const { flushAuditArchive, auditArchiveStatus } = await import('../storage/auditArchive.ts');
  await flushAuditArchive();
  const arch = auditArchiveStatus();
  expect(
    'storage: audit batch archived to the audit bucket with its chain head',
    arch.enabled &&
      arch.batches >= 1 &&
      arch.pending === 0 &&
      /^audit\/\d{4}\/\d{2}\/\d{2}\//.test(arch.lastKey),
    arch,
  );
}

const audit = await call('GET', '/api/audit/verify', undefined, dev);
expect('audit chain intact', audit.json.ok === true, audit.json);

console.log(`\n${passed} checks passed`);
server.close();
process.exit(0);
