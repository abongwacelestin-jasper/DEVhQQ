/**
 * DoS resilience (bounded, local) — request body size cap.
 *
 * Verifies the server rejects an over-limit JSON body with 413 before parsing
 * (MAX_BODY_BYTES default 256 KiB). Sends ~512 KiB to a public body-reading
 * route. Fails if the oversize body is accepted/parsed instead of 413.
 */

import { req, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

export const check: Check = {
  name: 'Body-size cap (413)',
  area: 'DoS',
  run: async (base) => {
    const huge = JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(512 * 1024) });
    const r = await req(base, 'POST', '/api/auth/sign-in', {
      origin: 'http://localhost:5173',
      rawBody: huge,
    });
    if (r.status === 413) return { status: 'pass', id: 'INFO-DOS', detail: 'oversize body rejected with 413' };
    return { status: 'fail', id: 'INFO-DOS', detail: `oversize body not capped (${r.status})` };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
