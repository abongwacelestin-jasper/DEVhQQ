/**
 * Authorization — backup restore (STORAGE). Restore overwrites live data, so
 * it must require Administration:admin + a fresh step-up, and a PAT can never
 * perform it. Non-destructive: only dry-runs and refusals are exercised; a real
 * restore (confirm = id) is never sent.
 *
 * Verifies:
 *  - a non-admin role (Operations: Administration:view) → 403;
 *  - a PAT (even with an admin-level scope) → 403 (step-up unavailable);
 *  - an admin without "confirm" cannot trigger a real restore (dry-run/422);
 *  - the snapshots list is gated to Infrastructure:manage.
 *
 * Fails if a non-admin or a PAT can restore, or a real restore runs without
 * the id confirmation.
 */

import { CLI, req, signInDemo, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

export const check: Check = {
  name: 'Backup restore authorization',
  area: 'Authorization',
  run: async (base) => {
    const problems: string[] = [];
    const admin = await signInDemo(base, 'admin');
    const ops = await signInDemo(base, 'operations');

    // Force a snapshot now (Infrastructure:manage + step-up; a fresh demo session
    // is already verified), then read a real backup id.
    await req(base, 'POST', '/api/backups', { token: admin, headers: CLI, body: {} });
    const list = await req(base, 'GET', '/api/backups/snapshots?limit=5', { token: admin, headers: CLI });
    const id = list.json?.items?.[0]?.id;
    if (!id) return { status: 'fail', id: 'INFO-RESTORE', detail: `no backup id available (${list.status} ${list.text})` };

    // Non-admin role cannot even see snapshots (Infrastructure:manage) — Operations has manage,
    // so instead assert Operations cannot RESTORE (needs Administration:admin).
    const opsRestore = await req(base, 'POST', `/api/backups/${id}/restore`, {
      token: ops,
      headers: CLI,
      body: { dryRun: true },
    });
    if (opsRestore.status !== 403)
      problems.push(`Operations (no Administration:admin) restored (${opsRestore.status})`);

    // A PAT can never restore (step-up unavailable), even if its scope named admin.
    // Mint the strongest PAT the admin can (Administration:admin is within Owner's role).
    const adminV = admin; // fresh demo session is already verified → passes step-up to mint
    const mk = await req(base, 'POST', '/api/tokens', {
      token: adminV,
      headers: CLI,
      body: { name: 'restore-probe', scopes: ['administration:admin', 'infrastructure:manage'], expiresInDays: 1 },
    });
    if (mk.json?.token) {
      const patRestore = await req(base, 'POST', `/api/backups/${id}/restore`, {
        token: mk.json.token,
        body: { dryRun: true },
      });
      if (patRestore.status !== 403)
        problems.push(`PAT performed a restore (${patRestore.status})`);
    } else {
      problems.push(`could not mint admin PAT to probe (${mk.status} ${mk.text})`);
    }

    // Admin: a real restore requires confirm === id. Without it, no overwrite (422 or dry-run only).
    const noConfirm = await req(base, 'POST', `/api/backups/${id}/restore`, {
      token: admin,
      headers: CLI,
      body: { dryRun: false },
    });
    if (noConfirm.status !== 422)
      problems.push(`real restore proceeded without id confirmation (${noConfirm.status})`);

    // Snapshots list is gated (a PAT without infra scope cannot read it).
    const patNoScope = await req(base, 'POST', '/api/tokens', {
      token: admin,
      headers: CLI,
      body: { name: 'noinfra', scopes: ['product:view'], expiresInDays: 1 },
    });
    if (patNoScope.json?.token) {
      const snap = await req(base, 'GET', '/api/backups/snapshots', { token: patNoScope.json.token });
      if (snap.status !== 403) problems.push(`PAT without infra scope listed snapshots (${snap.status})`);
    }

    return {
      status: problems.length ? 'fail' : 'pass',
      id: 'INFO-RESTORE',
      detail: problems.length
        ? problems.join('; ')
        : 'restore needs Administration:admin + step-up; PATs refused; real restore needs id confirmation; snapshots scope-gated',
    };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
