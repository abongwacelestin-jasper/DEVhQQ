/**
 * Authentication — lockout bypass via email case/whitespace variants.
 *
 * Verifies the control holds: failed attempts against case- and
 * whitespace-variants of one email must all count toward the *same* account,
 * so the 5-failure lock still triggers. Fails if mixed variants never produce
 * a 423 (i.e. each variant had its own independent counter — a lockout bypass).
 */

import { demoAccounts, req, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

export const check: Check = {
  name: 'Lockout bypass via email variants',
  area: 'Authentication',
  run: async (base) => {
    const accts = await demoAccounts(base);
    const email = accts.accounts[2].email as string; // a developer account
    const variants = [
      email.toUpperCase(),
      ` ${email} `,
      email.replace(/^./, (c) => c.toUpperCase()),
      `\t${email}`,
      email,
      email,
    ];
    let locked = false;
    let statuses: number[] = [];
    for (const v of variants) {
      const r = await req(base, 'POST', '/api/auth/sign-in', {
        body: { email: v, password: 'definitely-wrong' },
        origin: 'http://localhost:5173',
      });
      statuses.push(r.status);
      if (r.status === 423 || r.json?.error?.code === 'locked') locked = true;
    }
    return {
      status: locked ? 'pass' : 'fail',
      id: 'INFO-LOCK',
      detail: locked
        ? `variants normalised to one account; lock (423) triggered [${statuses.join(',')}]`
        : `account never locked across variants [${statuses.join(',')}] — per-variant counters`,
    };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
