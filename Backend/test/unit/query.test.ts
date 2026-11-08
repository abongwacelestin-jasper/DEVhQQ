import '../setup.ts';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { runQuery, type Query } from '../../lib/query.ts';
import { HttpError, type Principal } from '../../types.ts';
import { rng } from '../helpers/random.ts';

type Row = { id: string; n: number; s: string; tags: string[]; opt?: string | null; b: boolean };

const FIELDS = ['id', 'n', 's', 'tags', 'opt', 'b'];
const rows: Row[] = [
  { id: 'r1', n: 1, s: 'Alpha', tags: ['a', 'b'], opt: 'x', b: true },
  { id: 'r2', n: 2, s: 'beta', tags: ['b'], opt: null, b: false },
  { id: 'r3', n: 3, s: 'Gamma', tags: [], b: true },
  { id: 'r4', n: 4, s: 'alphabet', tags: ['c'], opt: 'y', b: false },
  { id: 'r5', n: 5, s: 'delta', tags: ['a', 'c'], opt: 'x', b: true },
];

const ids = (q: Omit<Query, 'from'>, data: Row[] = rows) =>
  runQuery({ from: 't', ...q }, data, FIELDS).rows.map((r) => r.id);

function rejectsWith(fn: () => unknown, code: string) {
  assert.throws(fn, (e: unknown) => e instanceof HttpError && e.status === 422 && e.code === code);
}

describe('lib/query — operators', () => {
  it('bare scalar means eq', () => {
    assert.deepEqual(ids({ where: { s: 'beta' } }), ['r2']);
    assert.deepEqual(ids({ where: { b: true } }), ['r1', 'r3', 'r5']);
    assert.deepEqual(ids({ where: { opt: null } }), ['r2']);
  });

  it('eq / ne', () => {
    assert.deepEqual(ids({ where: { n: { eq: 3 } } }), ['r3']);
    assert.deepEqual(ids({ where: { n: { ne: 3 } } }), ['r1', 'r2', 'r4', 'r5']);
  });

  it('in / nin on scalar fields', () => {
    assert.deepEqual(ids({ where: { n: { in: [1, 4, 9] } } }), ['r1', 'r4']);
    assert.deepEqual(ids({ where: { n: { nin: [1, 4, 9] } } }), ['r2', 'r3', 'r5']);
  });

  it('in on an array field matches any overlap', () => {
    assert.deepEqual(ids({ where: { tags: { in: ['c'] } } }), ['r4', 'r5']);
    assert.deepEqual(ids({ where: { tags: { in: ['z'] } } }), []);
  });

  it('in / nin with a non-array argument match nothing', () => {
    assert.deepEqual(ids({ where: { n: { in: 1 } } }), []);
    assert.deepEqual(ids({ where: { n: { nin: 1 } } }), []);
  });

  it('gt / gte / lt / lte on numbers and strings', () => {
    assert.deepEqual(ids({ where: { n: { gt: 3 } } }), ['r4', 'r5']);
    assert.deepEqual(ids({ where: { n: { gte: 3 } } }), ['r3', 'r4', 'r5']);
    assert.deepEqual(ids({ where: { n: { lt: 2 } } }), ['r1']);
    assert.deepEqual(ids({ where: { n: { lte: 2 } } }), ['r1', 'r2']);
    assert.deepEqual(ids({ where: { n: { gt: 1, lt: 4 } } }), ['r2', 'r3'], 'operators AND');
    assert.deepEqual(ids({ where: { s: { gte: 'b', lt: 'e' } } }), ['r2', 'r5']);
  });

  it('contains is case-insensitive on strings and exact on arrays', () => {
    assert.deepEqual(ids({ where: { s: { contains: 'ALPH' } } }), ['r1', 'r4']);
    assert.deepEqual(ids({ where: { tags: { contains: 'a' } } }), ['r1', 'r5']);
    assert.deepEqual(ids({ where: { tags: { contains: 'A' } } }), []);
    assert.deepEqual(ids({ where: { n: { contains: 1 } } }), [], 'numbers never contain');
  });

  it('startsWith is case-insensitive and string-only', () => {
    assert.deepEqual(ids({ where: { s: { startsWith: 'al' } } }), ['r1', 'r4']);
    assert.deepEqual(ids({ where: { n: { startsWith: '1' } } }), []);
  });

  it('exists treats undefined and null as absent', () => {
    assert.deepEqual(ids({ where: { opt: { exists: true } } }), ['r1', 'r4', 'r5']);
    assert.deepEqual(ids({ where: { opt: { exists: false } } }), ['r2', 'r3']);
  });

  it('multiple fields combine with AND', () => {
    assert.deepEqual(ids({ where: { b: true, tags: { contains: 'a' }, n: { gt: 1 } } }), ['r5']);
  });

  it('unknown operators are refused with the operator list', () => {
    assert.throws(
      () =>
        runQuery(
          { from: 't', where: JSON.parse('{"n":{"regex":".*"}}') as Query['where'] },
          rows,
          FIELDS,
        ),
      (e: unknown) =>
        e instanceof HttpError &&
        e.code === 'operator_unknown' &&
        Array.isArray((e.details as { operators: string[] }).operators),
    );
  });
});

describe('lib/query — operator laws (property)', () => {
  const r = rng(7);
  const randomRows = (count: number): Row[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `p${i}`,
      n: r.int(-5, 5),
      s: r.pick(['a', 'b', 'c', 'ab', 'B']),
      tags: Array.from({ length: r.int(0, 3) }, () => r.pick(['x', 'y', 'z'])),
      opt: r.pick([undefined, null, 'v']),
      b: r.bool(),
    }));

  it('ne is the complement of eq; gte = gt ∪ eq; lte = lt ∪ eq', () => {
    for (let i = 0; i < 200; i++) {
      const data = randomRows(12);
      const k = r.int(-5, 5);
      const eq = new Set(ids({ where: { n: { eq: k } } }, data));
      const ne = ids({ where: { n: { ne: k } } }, data);
      assert.equal(eq.size + ne.length, data.length);
      assert.ok(ne.every((id) => !eq.has(id)));
      const gt = ids({ where: { n: { gt: k } } }, data);
      const lt = ids({ where: { n: { lt: k } } }, data);
      assert.deepEqual(new Set(ids({ where: { n: { gte: k } } }, data)), new Set([...gt, ...eq]));
      assert.deepEqual(new Set(ids({ where: { n: { lte: k } } }, data)), new Set([...lt, ...eq]));
    }
  });

  it('in equals the union of eq over its members; nin is its complement (scalars)', () => {
    for (let i = 0; i < 200; i++) {
      const data = randomRows(12);
      const set = Array.from({ length: r.int(0, 4) }, () => r.int(-5, 5));
      const union = new Set(set.flatMap((k) => ids({ where: { n: k } }, data)));
      const inIds = ids({ where: { n: { in: set } } }, data);
      assert.deepEqual(new Set(inIds), union);
      const nin = ids({ where: { n: { nin: set } } }, data);
      assert.equal(inIds.length + nin.length, data.length);
    }
  });

  // FINDING B-2 (lib/query.ts:69-70): `in` matches array-valued fields by
  // overlap, but `nin` compares the whole array with `includes`, so
  // `{ products: { nin: ['blog'] } }` returns every row — including members of
  // blog. `nin` must be the complement of `in` for array fields too.
  it(
    'nin is the complement of in for array-valued fields',
    () => {
      for (let i = 0; i < 50; i++) {
        const data = randomRows(12);
        const set = [r.pick(['x', 'y', 'z'])];
        const inIds = new Set(ids({ where: { tags: { in: set } } }, data));
        const nin = ids({ where: { tags: { nin: set } } }, data);
        assert.ok(
          nin.every((id) => !inIds.has(id)),
          `rows matched by both in and nin ${JSON.stringify(set)}`,
        );
        assert.equal(inIds.size + nin.length, data.length);
      }
    },
  );

  it('exists:true and exists:false partition the rows', () => {
    for (let i = 0; i < 100; i++) {
      const data = randomRows(10);
      const yes = ids({ where: { opt: { exists: true } } }, data);
      const no = ids({ where: { opt: { exists: false } } }, data);
      assert.equal(yes.length + no.length, data.length);
    }
  });
});

describe('lib/query — field allow-list', () => {
  it('refuses unlisted fields in where, select and orderBy', () => {
    rejectsWith(
      () => runQuery({ from: 't', where: { secret: 1 } }, rows, FIELDS),
      'field_not_allowed',
    );
    rejectsWith(
      () => runQuery({ from: 't', select: ['id', 'secret'] }, rows, FIELDS),
      'field_not_allowed',
    );
    rejectsWith(
      () => runQuery({ from: 't', orderBy: { field: 'secret' } }, rows, FIELDS),
      'field_not_allowed',
    );
  });

  it('never projects a field that is not allow-listed, even if rows carry it', () => {
    const leaky = rows.map((r) => ({ ...r, passwordHash: 'scrypt-v1$…' }));
    const out = runQuery({ from: 't' }, leaky, FIELDS);
    for (const row of out.rows) assert.deepEqual(Object.keys(row), FIELDS);
  });

  it('treats prototype names as fields, not operators', () => {
    for (const f of ['__proto__', 'constructor', 'toString'])
      rejectsWith(
        () =>
          runQuery({ from: 't', where: JSON.parse(`{"${f}":1}`) as Query['where'] }, rows, FIELDS),
        'field_not_allowed',
      );
  });
});

describe('lib/query — paging, ordering and projection', () => {
  it('orders asc by default and desc on request, without mutating the input', () => {
    const copy = [...rows];
    assert.deepEqual(ids({ orderBy: { field: 'n', dir: 'desc' } }), ['r5', 'r4', 'r3', 'r2', 'r1']);
    assert.deepEqual(ids({ orderBy: { field: 's' } }), ['r1', 'r3', 'r4', 'r2', 'r5']);
    assert.deepEqual(rows, copy);
  });

  it('clamps limit to [1, 500] and offset to ≥ 0; total counts pre-paging rows', () => {
    const many = Array.from({ length: 700 }, (_, i) => ({ ...rows[0], id: `m${i}`, n: i }));
    const def = runQuery({ from: 't' }, many, FIELDS);
    assert.equal(def.limit, 100);
    assert.equal(def.returned, 100);
    assert.equal(def.total, 700);
    assert.equal(runQuery({ from: 't', limit: 10_000 }, many, FIELDS).returned, 500);
    assert.equal(runQuery({ from: 't', limit: 0 }, many, FIELDS).limit, 1);
    assert.equal(runQuery({ from: 't', limit: -5 }, many, FIELDS).returned, 1);
    const neg = runQuery({ from: 't', offset: -10, limit: 2 }, many, FIELDS);
    assert.equal(neg.offset, 0);
    assert.deepEqual(
      neg.rows.map((r) => r.id),
      ['m0', 'm1'],
    );
    const page = runQuery({ from: 't', offset: 698, limit: 5 }, many, FIELDS);
    assert.deepEqual(
      page.rows.map((r) => r.id),
      ['m698', 'm699'],
    );
  });

  it('projects select fields in order and reports timing', () => {
    const out = runQuery({ from: 't', select: ['n', 'id'], limit: 1 }, rows, FIELDS);
    assert.deepEqual(out.rows, [{ n: 1, id: 'r1' }]);
    assert.equal(out.from, 't');
    assert.equal(typeof out.ms, 'number');
  });
});

describe('lib/query — console collections never expose secrets', () => {
  let collections: Record<
    string,
    {
      fields: string[];
      rows: (p: Principal) => Record<string, unknown>[] | Promise<Record<string, unknown>[]>;
    }
  >;
  const owner: Principal = {
    memberId: 'm1',
    role: 'Owner',
    products: ['renewberry', 'blog', 'mirror'],
    sessionId: 's',
    verifiedAt: Date.now(),
    elevations: [],
  };

  before(async () => {
    const db = await import('../../store/db.ts');
    await db.seed();
    collections = (await import('../../routes/system.routes.ts')).collections;
  });

  it('no allow-listed field names a secret', () => {
    const secret = /password|hash|secret|totp|token|privateKey|publicKey|invite/i;
    for (const [name, c] of Object.entries(collections))
      for (const f of c.fields) assert.ok(!secret.test(f), `${name}.${f} looks secret`);
  });

  it('member rows are the public projection (no hash, no TOTP secret, passkeys as a count)', async () => {
    const members = await collections.members.rows(owner);
    assert.ok(members.length > 0);
    for (const m of members) {
      assert.equal('passwordHash' in m, false);
      assert.equal('totpSecret' in m, false);
      assert.equal('inviteTokenHash' in m, false);
      assert.equal(typeof m.passkeys, 'number');
    }
  });

  it('selecting passwordHash from members is refused', async () => {
    const rows = await collections.members.rows(owner);
    rejectsWith(
      () =>
        runQuery(
          { from: 'members', select: ['passwordHash'] },
          rows,
          collections.members.fields,
        ),
      'field_not_allowed',
    );
  });
});
