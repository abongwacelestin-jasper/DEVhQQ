/**
 * Injection/parsing — the JSON query runner (POST /api/_query).
 *
 * Verifies the engine's guards hold:
 *  - prototype-pollution field names (__proto__, constructor, prototype) in
 *    `where`/`select` are rejected by the field allow-list (422), not evaluated;
 *  - secret-ish / non-allow-listed fields cannot be selected;
 *  - unknown operators are rejected;
 *  - oversize `limit` is clamped/rejected by validation (max 500).
 *
 * Also confirms Object.prototype was not polluted (a canary property never
 * appears on a fresh object). Fails if any guard is missing.
 */

import { req, signInDemo, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

export const check: Check = {
  name: 'Query runner: proto-pollution / operator / limit guards',
  area: 'Injection/Parsing',
  run: async (base) => {
    const token = await signInDemo(base, 'admin');
    const q = (body: unknown) =>
      req(base, 'POST', '/api/_query', { token, origin: 'http://localhost:5173', body });
    // Raw JSON so prototype-key names survive as genuine JSON keys (an object
    // literal { __proto__: ... } would set the prototype, not an own property).
    const qRaw = (raw: string) =>
      req(base, 'POST', '/api/_query', { token, origin: 'http://localhost:5173', rawBody: raw });
    const problems: string[] = [];

    // __proto__ / constructor / prototype as where field names — must be
    // rejected by the field allow-list (422), never evaluated or polluting.
    const proto = await qRaw('{"from":"tasks","where":{"__proto__":{"eq":"x"}}}');
    if (proto.status !== 422) problems.push(`__proto__ where not rejected (${proto.status})`);
    const protoPoll = await qRaw('{"from":"tasks","where":{"constructor":{"eq":"x"}},"select":["prototype"]}');
    if (protoPoll.status !== 422) problems.push(`constructor/prototype keys not rejected (${protoPoll.status})`);
    if (({} as any).polluted !== undefined || ({} as any).eq !== undefined)
      problems.push('Object.prototype polluted via query');

    // constructor select — must be rejected.
    const ctor = await q({ from: 'members', select: ['constructor'] });
    if (ctor.status !== 422) problems.push(`constructor select not rejected (${ctor.status})`);

    // Secret field selection — passwordHash is never allow-listed.
    const secret = await q({ from: 'members', select: ['passwordHash'] });
    if (secret.status !== 422) problems.push(`secret field selectable (${secret.status})`);

    // Unknown operator.
    const op = await q({ from: 'tasks', where: { status: { regex: '.*' } } });
    if (op.status !== 422) problems.push(`unknown operator accepted (${op.status})`);

    // Oversize limit.
    const lim = await q({ from: 'tasks', limit: 10_000_000 });
    if (lim.status !== 422) problems.push(`oversize limit not rejected (${lim.status})`);

    // A legitimate query still works.
    const ok = await q({ from: 'tasks', select: ['key', 'status'], limit: 5 });
    if (ok.status !== 200) problems.push(`legit query broke (${ok.status})`);

    return {
      status: problems.length ? 'fail' : 'pass',
      id: 'INFO-QUERY',
      detail: problems.length
        ? problems.join('; ')
        : 'proto-pollution, secret-field, operator and limit guards all enforced',
    };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
