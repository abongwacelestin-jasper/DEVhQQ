/**
 * CYBER-003 — Session bearer token returned in the response body.
 *
 * With X-DevHQ-Client: console the auth routes echo the raw session token in
 * JSON. The SPA (per the brief) stores it in sessionStorage. A token in the
 * JS-reachable body/sessionStorage is exfiltratable by any XSS, defeating the
 * HttpOnly cookie. Confirms the known issue (owning lane: F-SEC).
 *
 * Exits fail while the token appears in the body.
 */

import { req, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

export const check: Check = {
  name: 'Bearer token echoed in response body',
  area: 'Authentication',
  run: async (base) => {
    const r = await req(base, 'POST', '/api/auth/demo', {
      body: { role: 'developer' },
      origin: 'http://localhost:5173',
      headers: { 'x-devhq-client': 'console' },
    });
    const token = r.json?.token;
    const hasCookie = r.setCookie.some((c) => c.includes('__Host-devhq_session'));
    if (token) {
      return {
        status: 'fail',
        id: 'CYBER-003',
        detail: `token present in body (tokenType=${r.json?.tokenType}); HttpOnly cookie also set=${hasCookie} — body token is JS-readable`,
      };
    }
    return { status: 'pass', id: 'CYBER-003', detail: 'no token in body; cookie-only delivery' };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
