/**
 * Injection/parsing — path traversal on GET /fonts/:file and file serving.
 *
 * The font route allow-lists the filename with ^[a-z0-9-]+\.woff2$. Verifies
 * that classic and encoded traversal payloads cannot read arbitrary files and
 * all return 404 (never 200 with file contents).
 *
 * Fails if any payload returns 200 or leaks a non-font body.
 */

import { req, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

const PAYLOADS = [
  '/fonts/..%2f..%2fserver.ts',
  '/fonts/..%2f..%2fbackend.html',
  '/fonts/%2e%2e%2fserver.ts',
  '/fonts/....//....//server.ts',
  '/fonts/..%252f..%252fserver.ts',
  '/fonts/inter.woff2%00.ts',
  '/fonts/%2fetc%2fpasswd',
  '/fonts/..\\..\\server.ts',
];

export const check: Check = {
  name: 'Path traversal on /fonts/:file',
  area: 'Injection/Parsing',
  run: async (base) => {
    const leaks: string[] = [];
    for (const p of PAYLOADS) {
      const r = await req(base, 'GET', p);
      const looksLikeSource = /import |export |passwordHash|root:/.test(r.text);
      if (r.status === 200 && (looksLikeSource || !r.headers.get('content-type')?.includes('woff2'))) {
        leaks.push(`${p} -> ${r.status}`);
      }
    }
    return {
      status: leaks.length ? 'fail' : 'pass',
      id: 'INFO-TRAVERSAL',
      detail: leaks.length ? `file leak: ${leaks.join(', ')}` : 'all traversal payloads rejected (404)',
    };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
