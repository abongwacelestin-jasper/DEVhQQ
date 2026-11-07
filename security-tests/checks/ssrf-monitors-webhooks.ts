/**
 * SSRF — monitors scheduler & outbound webhooks (WAVE4 §6, B-DOMAIN).
 *
 * These routes (POST /api/monitors with a user-supplied URL to health-check,
 * and /api/integrations/:id/webhooks for outbound delivery) are not yet merged
 * into this branch. When they land, the scheduler/sender MUST:
 *   - allow-list schemes (http/https only),
 *   - block private, loopback, link-local and cloud-metadata ranges
 *     (127.0.0.0/8, 10/8, 172.16/12, 192.168/16, 169.254.169.254, ::1,
 *      IPv4-mapped IPv6 ::ffff:169.254.169.254),
 *   - re-resolve and re-check after redirects (no DNS rebinding / redirect
 *     to a private host),
 *   - cap time and response size.
 *
 * This file carries ready payloads and SKIPs until the routes exist, so the
 * second pass on the merged branch exercises them automatically.
 */

import { req, signInDemo, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

export const SSRF_TARGETS = [
  'http://169.254.169.254/latest/meta-data/',
  'http://127.0.0.1:8080/api/_config',
  'http://localhost/admin',
  'http://[::1]/',
  'http://[::ffff:169.254.169.254]/',
  'http://10.0.0.1/',
  'http://192.168.0.1/',
  'http://metadata.google.internal/',
  'file:///etc/passwd',
  'gopher://127.0.0.1:6379/_',
];

export const check: Check = {
  name: 'SSRF — monitors/webhooks (WAVE4 §6, ready)',
  area: 'SSRF',
  run: async (base) => {
    const token = await signInDemo(base, 'operations');
    // Detect whether the monitors route is present yet.
    const probe = await req(base, 'POST', '/api/monitors', {
      token,
      origin: 'http://localhost:5173',
      body: { url: SSRF_TARGETS[0] },
    });
    if (probe.status === 404 || probe.json?.error?.code === 'not_found') {
      return { status: 'skip', id: 'INFO-SSRF-MON', detail: 'monitors/webhooks not merged yet — payloads staged for phase 2' };
    }
    // Route exists (merged branch): a private/metadata target must be refused.
    const problems: string[] = [];
    for (const url of SSRF_TARGETS) {
      const r = await req(base, 'POST', '/api/monitors', { token, origin: 'http://localhost:5173', body: { url } });
      if (r.status >= 200 && r.status < 300) problems.push(`accepted SSRF target ${url} (${r.status})`);
    }
    return {
      status: problems.length ? 'fail' : 'pass',
      id: 'INFO-SSRF-MON',
      detail: problems.length ? problems.join('; ') : 'all private/metadata/scheme SSRF targets refused',
    };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
