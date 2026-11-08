/**
 * Cloudflare Turnstile configuration (read once at boot, like the rest of config/).
 *
 *   TURNSTILE_MODE          off (default) | on
 *   TURNSTILE_SITE_KEY      public widget key, served to the SPA by GET /api/auth/config
 *   TURNSTILE_SECRET_KEY    siteverify secret (or TURNSTILE_SECRET_KEY_FILE, a file holding it)
 *   TURNSTILE_FAIL_OPEN     1 = let requests through while Cloudflare is unreachable
 *                           (incident switch; every pass is audited). Default: fail closed.
 *   TURNSTILE_EXEMPT_CLI    0 (default) = no exemption; 1 = explicit CLI clients skip the check
 *                           (production also needs TURNSTILE_EXEMPT_CLI_ACK=bots-can-claim-cli)
 *
 * Fail closed: an unknown mode refuses to boot everywhere; production with
 * `on` refuses to boot without both keys, and refuses Cloudflare's published
 * test keys (they accept a fixed dummy token from anyone). Outside production
 * a missing key with `on` is still an error, because a guard that cannot
 * verify anything would reject every browser sign-in.
 *
 * `loadTurnstileConfig` takes the variables as a plain record so tests can
 * check the fail-closed paths without touching the process environment;
 * `turnstileEnvFromProcess` lists every variable it reads (the docs generator
 * scans for `process.env.NAME`).
 */

import { secretValue, type MailEnv } from './mail.ts';

export type TurnstileMode = 'off' | 'on';

export interface TurnstileConfig {
  mode: TurnstileMode;
  siteKey?: string;
  secretKey?: string;
  /** Let requests through when siteverify is unreachable (audited). */
  failOpen: boolean;
  /** Explicit CLI clients (X-DevHQ-Client: cli, no browser headers) skip the check. */
  exemptCli: boolean;
  /** Hostname a token must have been issued on: APP_ORIGIN's host. */
  expectedHostname: string;
  /** True when the secret is one of Cloudflare's published test secrets (never in production). */
  testKeys: boolean;
  /** Non-fatal notes, logged once at boot. */
  warnings: string[];
}

/**
 * Cloudflare's published test keys
 * (https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
 * Test secrets accept the fixed token `XXXX.DUMMY.TOKEN.XXXX` and report the
 * hostname `example.com` with no action, so the hostname, action and replay
 * checks cannot apply to them.
 */
export const TURNSTILE_TEST_SITE_KEYS = new Set([
  '1x00000000000000000000AA', // visible, always passes
  '2x00000000000000000000AB', // visible, always blocks
  '1x00000000000000000000BB', // invisible, always passes
  '2x00000000000000000000BB', // invisible, always blocks
  '3x00000000000000000000FF', // visible, forces an interactive challenge
]);
export const TURNSTILE_TEST_SECRET_KEYS = new Set([
  '1x0000000000000000000000000000000AA', // always passes
  '2x0000000000000000000000000000000AA', // always fails
  '3x0000000000000000000000000000000AA', // yields "token already spent"
]);

/** Every variable this module reads, as literal `process.env.NAME` reads. */
export function turnstileEnvFromProcess(): MailEnv {
  return {
    TURNSTILE_MODE: process.env.TURNSTILE_MODE,
    TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY,
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
    TURNSTILE_SECRET_KEY_FILE: process.env.TURNSTILE_SECRET_KEY_FILE,
    TURNSTILE_FAIL_OPEN: process.env.TURNSTILE_FAIL_OPEN,
    TURNSTILE_EXEMPT_CLI: process.env.TURNSTILE_EXEMPT_CLI,
    TURNSTILE_EXEMPT_CLI_ACK: process.env.TURNSTILE_EXEMPT_CLI_ACK,
  };
}

function flag(name: string, raw: string | undefined, def: boolean): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '') return def;
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  throw new Error(`${name} must be 0 or 1 (got "${raw}")`);
}

const KEY_SHAPE = /^[A-Za-z0-9_-]{10,200}$/;

export function loadTurnstileConfig(
  env: MailEnv,
  opts: { isProd: boolean; appOrigin: string },
): TurnstileConfig {
  const warnings: string[] = [];
  const modeRaw = (env.TURNSTILE_MODE ?? '').trim().toLowerCase() || 'off';
  if (modeRaw !== 'off' && modeRaw !== 'on')
    throw new Error(`TURNSTILE_MODE must be off or on (got "${env.TURNSTILE_MODE}")`);
  const mode: TurnstileMode = modeRaw;

  const siteKey = env.TURNSTILE_SITE_KEY?.trim() || undefined;
  const secretKey = secretValue(env, 'TURNSTILE_SECRET_KEY');
  if (siteKey && !KEY_SHAPE.test(siteKey))
    throw new Error('TURNSTILE_SITE_KEY does not look like a Turnstile site key');
  if (secretKey && !KEY_SHAPE.test(secretKey))
    throw new Error('TURNSTILE_SECRET_KEY does not look like a Turnstile secret key');

  const failOpen = flag('TURNSTILE_FAIL_OPEN', env.TURNSTILE_FAIL_OPEN, false);
  // Off by default: any HTTP client can claim to be the CLI, so the exemption is an
  // explicit, acknowledged choice (W5-03).
  const exemptCli = flag('TURNSTILE_EXEMPT_CLI', env.TURNSTILE_EXEMPT_CLI, false);
  const testKeys =
    (!!secretKey && TURNSTILE_TEST_SECRET_KEYS.has(secretKey)) ||
    (!!siteKey && TURNSTILE_TEST_SITE_KEYS.has(siteKey));

  if (mode === 'on') {
    const missing = [
      ...(siteKey ? [] : ['TURNSTILE_SITE_KEY']),
      ...(secretKey ? [] : ['TURNSTILE_SECRET_KEY (or TURNSTILE_SECRET_KEY_FILE)']),
    ];
    if (missing.length)
      throw new Error(`TURNSTILE_MODE=on requires ${missing.join(' and ')} — refusing to boot`);
    if (opts.isProd && exemptCli && env.TURNSTILE_EXEMPT_CLI_ACK !== 'bots-can-claim-cli')
      throw new Error(
        'TURNSTILE_EXEMPT_CLI=1 in production lets any client that claims to be the CLI skip ' +
          'Turnstile; set TURNSTILE_EXEMPT_CLI_ACK=bots-can-claim-cli to accept that, or use PATs',
      );
    if (opts.isProd && testKeys)
      throw new Error(
        'TURNSTILE_MODE=on with a Cloudflare test key in production — use the real widget keys',
      );
    if (failOpen)
      warnings.push(
        'TURNSTILE_FAIL_OPEN=1: sign-in is not bot-protected while Cloudflare is unreachable (each pass is audited)',
      );
    if (testKeys)
      warnings.push(
        'Turnstile is using Cloudflare test keys: hostname, action and replay checks are skipped',
      );
  } else if (failOpen) {
    warnings.push('TURNSTILE_FAIL_OPEN has no effect while TURNSTILE_MODE=off');
  }

  return {
    mode,
    siteKey,
    secretKey,
    failOpen,
    exemptCli,
    expectedHostname: new URL(opts.appOrigin).hostname,
    testKeys,
    warnings,
  };
}
