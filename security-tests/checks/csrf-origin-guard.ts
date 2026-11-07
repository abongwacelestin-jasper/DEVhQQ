/**
 * Browser — CSRF / origin-guard on state-changing routes.
 *
 * Verifies the controls hold:
 *  - a cross-origin unsafe request with a valid token and a disallowed Origin
 *    is rejected (403 bad_origin);
 *  - the "null" origin is rejected;
 *  - a non-JSON (form) body is rejected (415), blocking classic <form> CSRF;
 *  - a same-origin request with an allow-listed Origin still succeeds;
 *  - the session cookie carries SameSite=Strict + HttpOnly + Secure + __Host-.
 *
 * Fails if any cross-origin / form write is accepted or cookie flags are weak.
 */

import { req, signInDemo, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

export const check: Check = {
  name: 'CSRF / origin guard + cookie flags',
  area: 'Browser',
  run: async (base) => {
    const token = await signInDemo(base, 'admin');
    const problems: string[] = [];
    const incident = { product: 'renewberry', title: 'csrf origin probe', severity: 'SEV3' };

    const evil = await req(base, 'POST', '/api/incidents', {
      token,
      origin: 'https://evil.example',
      body: incident,
    });
    if (evil.status !== 403) problems.push(`cross-origin write accepted (${evil.status})`);

    const nullOrigin = await req(base, 'POST', '/api/incidents', {
      token,
      origin: 'null',
      body: incident,
    });
    if (nullOrigin.status !== 403) problems.push(`null origin write accepted (${nullOrigin.status})`);

    const form = await req(base, 'POST', '/api/incidents', {
      token,
      origin: 'http://localhost:5173',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      rawBody: 'product=renewberry&title=x&severity=SEV3',
    });
    if (form.status !== 415) problems.push(`non-JSON body accepted (${form.status})`);

    const good = await req(base, 'POST', '/api/incidents', {
      token,
      origin: 'http://localhost:5173',
      body: incident,
    });
    if (good.status !== 201) problems.push(`same-origin write blocked (${good.status})`);

    // Cookie flags on the login response.
    const login = await req(base, 'POST', '/api/auth/demo', {
      body: { role: 'tester' },
      origin: 'http://localhost:5173',
    });
    const cookie = login.setCookie.find((c) => c.includes('__Host-devhq_session')) ?? '';
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) {
      if (!cookie.includes(flag)) problems.push(`cookie missing ${flag}`);
    }

    return {
      status: problems.length ? 'fail' : 'pass',
      id: 'INFO-CSRF',
      detail: problems.length
        ? problems.join('; ')
        : 'cross-origin + null-origin + form writes blocked; cookie __Host-/HttpOnly/Secure/SameSite=Strict',
    };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
