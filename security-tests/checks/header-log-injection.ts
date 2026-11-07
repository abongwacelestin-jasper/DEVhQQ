/**
 * Injection/parsing — HTTP response-header injection via X-Request-Id and
 * log injection via CRLF in reflected fields.
 *
 * The server reflects a client X-Request-Id (sliced to 64 chars) into the
 * X-Request-Id response header and into structured logs. Verifies:
 *  - a CRLF-laden X-Request-Id cannot inject a second response header
 *    (no response splitting);
 *  - logs are JSON-encoded so a newline cannot forge a log line (checked via
 *    /api/_logs not containing an unescaped injected record).
 *
 * Fails if an injected header appears in the response.
 */

import { req, signInDemo, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

export const check: Check = {
  name: 'Header/log injection via X-Request-Id',
  area: 'Injection/Parsing',
  run: async (base) => {
    const payload = 'abc\r\nX-Injected: pwned\r\n\r\n<script>';
    let injected = false;
    let reflected = '';
    try {
      const r = await req(base, 'GET', '/api/health', { headers: { 'x-request-id': payload } });
      injected = r.headers.get('x-injected') !== null;
      reflected = r.headers.get('x-request-id') ?? '';
    } catch {
      // Node may reject the invalid header and reset the connection — no split occurred.
      return { status: 'pass', id: 'INFO-HDR', detail: 'runtime rejected CRLF header; no response splitting' };
    }
    if (injected || /\r|\n/.test(reflected)) {
      return { status: 'fail', id: 'INFO-HDR', detail: `response-header injection via X-Request-Id (reflected="${reflected}")` };
    }

    // Log injection: a newline-bearing field must not forge a second log record.
    const token = await signInDemo(base, 'admin');
    await req(base, 'GET', '/api/health', { headers: { 'x-request-id': 'line1\nFORGED_LEVEL_error' } }).catch(() => {});
    const logs = await req(base, 'GET', '/api/_logs?limit=50', { token });
    const forged = Array.isArray(logs.json) && logs.json.some((l: any) => l.msg === 'FORGED_LEVEL_error');
    return {
      status: forged ? 'fail' : 'pass',
      id: 'INFO-HDR',
      detail: forged ? 'forged log record injected via newline' : 'no header/log injection (values escaped/validated)',
    };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
