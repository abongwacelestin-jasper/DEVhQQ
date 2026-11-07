/**
 * CYBER-008 — Fail-open environment detection (NODE_ENV).
 *
 * `config/env.ts` treats only the exact string `production` as production
 * (`NODE_ENV` is type-cast, never validated). Any other value — `Production`,
 * `prod`, `staging` — boots with development fallbacks: demo accounts and the
 * public demo password/MFA code are enabled (including the seeded Owner), the
 * production secret checks (SESSION_SECRET length, required
 * DATA_ENCRYPTION_KEY, refusal of DEMO_* variables) are skipped, and the dev
 * SESSION_SECRET / HKDF-derived encryption key from source are used.
 *
 * PoC: boot with production-like but non-exact values and read
 * /api/auth/demo-accounts. Exits fail while any of them enables demo or boots
 * on dev fallbacks. Fixed when unknown NODE_ENV values refuse to boot (or demo
 * requires an explicit opt-in flag).
 */

import { spawnServer, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

const VALUES = ['Production', 'prod', 'staging'];

export const check: Check = {
  name: 'NODE_ENV fail-open (demo + dev secrets outside exact "production")',
  area: 'Configuration',
  run: async () => {
    const exposed: string[] = [];
    for (const value of VALUES) {
      let s;
      try {
        // No secrets supplied: a safe build must refuse to boot or keep demo off.
        s = await spawnServer({ env: { NODE_ENV: value, SESSION_SECRET: '' } });
      } catch {
        continue; // refused to boot → fail-closed for this value
      }
      try {
        const r = await (await fetch(`${s.base}/api/auth/demo-accounts`)).json();
        if (r?.enabled) {
          const owner = (r.accounts ?? []).find((a: any) => a.role === 'Owner');
          exposed.push(`${value}: demo on, Owner ${owner?.email ?? '?'} with public code`);
        }
      } finally {
        s.stop();
      }
    }
    return exposed.length
      ? { status: 'fail', id: 'CYBER-008', detail: exposed.join(' | ') }
      : { status: 'pass', id: 'CYBER-008', detail: `non-exact NODE_ENV values (${VALUES.join(', ')}) fail closed` };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
