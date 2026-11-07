/**
 * Turnstile bot protection (TURNSTILE_MODE=on) cannot be skipped.
 *
 * Boots with the mode on and Cloudflare's always-pass test keys, then plays a
 * browser (Origin + Sec-Fetch-Site) that simply leaves the token out:
 *  - password sign-in, demo sign-in, the recovery request and accept-invite
 *    must each answer `400 turnstile_required` — before any credential,
 *    account or invite is looked at;
 *  - the CLI exemption must not be reachable from a browser: adding
 *    `X-DevHQ-Client: cli` to a request that carries `Origin` or
 *    `Sec-Fetch-Site` must still be refused.
 * Then: a production process with `TURNSTILE_MODE=on` and no keys must refuse
 * to boot (with a production process that boots fine as the control).
 *
 * No token is ever sent, so Cloudflare is never contacted (the suite stays
 * loopback-only).
 */

import { req, spawnServer, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

const ORIGIN = 'http://localhost:5173';
const BROWSER = { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' };

const PROD_ENV = {
  NODE_ENV: 'production',
  SESSION_SECRET: 'c'.repeat(64),
  DATA_ENCRYPTION_KEY: 'd'.repeat(64),
  APP_ORIGIN: 'https://app.devhq.example',
  WEBAUTHN_RP_ID: 'devhq.example',
  DEMO_DISABLED: '1',
  DEMO_PASSWORD: '',
  DEMO_TOTP_SECRET: '',
};

export const check: Check = {
  name: 'Turnstile required on public auth forms (mode on)',
  area: 'Bot protection',
  env: {
    TURNSTILE_MODE: 'on',
    TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  },
  run: async (base) => {
    const problems: string[] = [];
    const cfg = await req(base, 'GET', '/api/auth/config');
    if (cfg.json?.turnstile?.mode !== 'on')
      return { status: 'fail', detail: `server did not start in mode on: ${cfg.text}` };

    const forms: [string, unknown][] = [
      ['/api/auth/sign-in', { email: 'amara@techorg.io', password: 'devhq-demo' }],
      ['/api/auth/demo', { role: 'admin' }],
      ['/api/auth/recovery/request', { email: 'amara@techorg.io' }],
      ['/api/auth/accept-invite', { token: 'a'.repeat(43), password: 'Correct-Horse-42!' }],
    ];
    const variants: [string, Record<string, string>, string | undefined][] = [
      ['browser', BROWSER, ORIGIN],
      ['browser claiming cli', { ...BROWSER, 'x-devhq-client': 'cli' }, ORIGIN],
      ['cli + Origin', { 'x-devhq-client': 'cli' }, ORIGIN],
      ['cli + Sec-Fetch-Site', { 'x-devhq-client': 'cli', 'sec-fetch-site': 'same-origin' }, undefined],
    ];
    for (const [path, body] of forms)
      for (const [label, headers, origin] of variants) {
        const r = await req(base, 'POST', path, { body, headers, origin });
        if (r.status !== 400 || r.json?.error?.code !== 'turnstile_required')
          problems.push(`${path} (${label}) → ${r.status} ${r.json?.error?.code ?? ''}`);
      }

    // Fail closed at boot: production, mode on, no keys.
    let control;
    try {
      control = await spawnServer({ env: PROD_ENV });
    } catch (e) {
      return { status: 'skip', detail: `production control did not boot: ${(e as Error).message.split('\n')[0]}` };
    } finally {
      control?.stop();
    }
    try {
      const s = await spawnServer({ env: { ...PROD_ENV, TURNSTILE_MODE: 'on' } });
      s.stop();
      problems.push('production booted with TURNSTILE_MODE=on and no keys');
    } catch (e) {
      if (!/TURNSTILE_MODE=on requires/.test((e as Error).message))
        problems.push(`production refused to boot, but not for Turnstile: ${(e as Error).message.split('\n')[0]}`);
    }

    return problems.length
      ? { status: 'fail', detail: problems.join(' | ') }
      : {
          status: 'pass',
          detail: `4 forms × ${variants.length} browser variants → 400 turnstile_required; prod without keys refuses to boot`,
        };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
