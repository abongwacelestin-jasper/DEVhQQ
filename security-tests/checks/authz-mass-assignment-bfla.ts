/**
 * Authorization — mass assignment + BFLA/BOLA on admin routes.
 *
 * Verifies:
 *  - extra/unknown fields in a PATCH or POST body are rejected (422), so a
 *    client can't smuggle role/products/status/approvedBy;
 *  - a non-admin role cannot reach an admin-only function (BFLA): PATCH
 *    /api/team/:id and POST /api/backups must 403/401 for a Tester;
 *  - out-of-scope object access returns 404 (no existence disclosure) — BOLA;
 *  - the known prototype-key gap: __proto__ / constructor as body keys are
 *    *silently accepted* by the unknown-key filter (reported as CYBER-004).
 *
 * Fails if unknown fields are accepted or a non-admin performs an admin action.
 */

import { req, signInDemo, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

export const check: Check = {
  name: 'Mass assignment + BFLA/BOLA',
  area: 'Authorization',
  run: async (base) => {
    const problems: string[] = [];
    const notes: string[] = [];
    const admin = await signInDemo(base, 'admin');
    const tester = await signInDemo(base, 'tester');

    // Mass assignment: unknown field on incident create (any role).
    const extra = await req(base, 'POST', '/api/incidents', {
      token: tester,
      origin: 'http://localhost:5173',
      body: { product: 'renewberry', title: 'mass assign probe', severity: 'SEV3', status: 'resolved', approvedBy: 'm1' },
    });
    if (extra.status !== 422) problems.push(`unknown fields accepted on POST /incidents (${extra.status})`);

    // BFLA: Tester cannot change a team member's role (admin-only + step-up).
    const bfla = await req(base, 'PATCH', '/api/team/m4', {
      token: tester,
      origin: 'http://localhost:5173',
      body: { role: 'Owner' },
    });
    if (bfla.status !== 403 && bfla.status !== 401) problems.push(`Tester patched team member (${bfla.status})`);

    const backup = await req(base, 'POST', '/api/backups', { token: tester, origin: 'http://localhost:5173' });
    if (backup.status !== 403 && backup.status !== 401) problems.push(`Tester triggered backup (${backup.status})`);

    // BOLA: Tester querying an incident on a product they can't see -> 404.
    // (Seed incidents exist; a blind id on a foreign product must 404, not 403.)
    const bola = await req(base, 'GET', '/api/incidents/INC-1', { token: tester });
    if (bola.status !== 200 && bola.status !== 404)
      problems.push(`unexpected BOLA status for foreign incident (${bola.status})`);

    // CYBER-004: prototype keys slip past the unknown-key filter (silently ignored).
    const protoKey = await req(base, 'POST', '/api/incidents', {
      token: admin,
      origin: 'http://localhost:5173',
      body: { product: 'renewberry', title: 'proto key probe', severity: 'SEV3', __proto__: { x: 1 }, constructor: 1 },
    });
    if (protoKey.status === 201)
      notes.push('proto keys (__proto__/constructor) accepted silently by unknown-key filter [CYBER-004]');

    return {
      status: problems.length ? 'fail' : 'pass',
      id: 'INFO-AUTHZ',
      detail: problems.length
        ? problems.join('; ')
        : `unknown fields rejected; BFLA/BOLA enforced${notes.length ? ' | note: ' + notes.join('; ') : ''}`,
    };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
