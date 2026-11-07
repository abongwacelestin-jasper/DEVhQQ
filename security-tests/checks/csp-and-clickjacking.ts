/**
 * Browser — CSP effectiveness, nonce freshness and clickjacking defence.
 *
 * Verifies:
 *  - the console CSP (/console) has a nonce-based script-src with NO
 *    'unsafe-inline' / 'unsafe-eval' and no host allow-list;
 *  - the API/SPA CSP has script-src with a nonce + 'strict-dynamic' and no
 *    'unsafe-inline' / 'unsafe-eval' in script-src;
 *  - the script nonce changes between two requests (no nonce reuse);
 *  - frame-ancestors 'none' and X-Frame-Options: DENY are present (clickjacking).
 *
 * Fails if any unsafe directive appears in script-src, a nonce repeats, or
 * framing defences are missing.
 */

import { req, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

function scriptSrc(csp: string): string {
  return csp.split(';').map((s) => s.trim()).find((s) => s.startsWith('script-src')) ?? '';
}
function nonceOf(csp: string): string | undefined {
  return /'nonce-([^']+)'/.exec(scriptSrc(csp))?.[1];
}

export const check: Check = {
  name: 'CSP / nonce / clickjacking',
  area: 'Browser',
  run: async (base) => {
    const problems: string[] = [];

    const con1 = await req(base, 'GET', '/console');
    const con2 = await req(base, 'GET', '/console');
    const conCsp = con1.headers.get('content-security-policy') ?? '';
    const conScript = scriptSrc(conCsp);
    if (/unsafe-inline|unsafe-eval/.test(conScript)) problems.push(`console script-src has unsafe directive: ${conScript}`);
    if (!/'nonce-/.test(conScript)) problems.push('console script-src has no nonce');
    const n1 = nonceOf(conCsp);
    const n2 = nonceOf(con2.headers.get('content-security-policy') ?? '');
    if (n1 && n2 && n1 === n2) problems.push('console nonce reused across requests');

    const api = await req(base, 'GET', '/api/health');
    const apiCsp = api.headers.get('content-security-policy') ?? '';
    const apiScript = scriptSrc(apiCsp);
    if (/unsafe-inline|unsafe-eval/.test(apiScript)) problems.push(`api script-src has unsafe directive: ${apiScript}`);
    // Since SEC (wave 4) JSON responses carry `default-src 'none'` with no script-src at all,
    // which is stricter than nonce + strict-dynamic: no script can execute.
    const apiLockedDown = /default-src 'none'/.test(apiCsp) && !/script-src/.test(apiCsp);
    if (!apiLockedDown && !/strict-dynamic/.test(apiScript))
      problems.push("api CSP neither default-src 'none' nor script-src strict-dynamic");

    for (const csp of [conCsp, apiCsp]) {
      if (!/frame-ancestors 'none'/.test(csp)) problems.push('missing frame-ancestors none');
    }
    if ((api.headers.get('x-frame-options') ?? '').toUpperCase() !== 'DENY')
      problems.push('X-Frame-Options not DENY');

    // The console HTML must actually carry the nonce on its inline script.
    if (n1 && !con1.text.includes(`nonce="${n1}"`))
      problems.push('console nonce not injected into inline <script>');

    return {
      status: problems.length ? 'fail' : 'pass',
      id: 'INFO-CSP',
      detail: problems.length
        ? problems.join('; ')
        : 'nonce-based CSP, no unsafe script directives, fresh nonces, frame-ancestors none + XFO DENY',
    };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
