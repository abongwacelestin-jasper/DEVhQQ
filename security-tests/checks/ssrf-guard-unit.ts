/**
 * SSRF — the shared outbound guard used by monitors and outbound webhooks
 * (`Backend/monitors/ssrf.ts`), tested at the unit level with an injected
 * DNS resolver so DNS rebinding is deterministic (no real network).
 *
 * Verifies:
 *  - IP-literal obfuscation (decimal / hex / octal) normalises and is blocked;
 *  - credentials-in-URL and non-http(s) schemes rejected;
 *  - internal hostnames (localhost, *.internal, metadata) rejected;
 *  - address classifier flags private / loopback / link-local / CGNAT /
 *    cloud-metadata (169.254.169.254) / IPv4-mapped IPv6;
 *  - DNS rebinding: a hostname that resolves to a private address is blocked
 *    even though the name itself is public (vetUrl resolves and checks every
 *    answer; any private address fails closed);
 *  - a public address is allowed (control still functions).
 *
 * Fails if any blocked case is allowed, or a public destination is rejected.
 */

import type { Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';
import {
  BlockedTargetError,
  blockedAddress,
  checkUrlShape,
  setOutboundDeps,
  vetUrl,
  type ResolvedAddress,
} from '../../Backend/monitors/ssrf.ts';

const shapeBlocked = (raw: string): boolean => {
  try {
    checkUrlShape(raw);
    return false;
  } catch (e) {
    return e instanceof BlockedTargetError;
  }
};

export const check: Check = {
  name: 'SSRF outbound guard (rebinding / IP tricks / classifier)',
  area: 'SSRF',
  run: async () => {
    const problems: string[] = [];

    // IP-literal obfuscation + scheme/credential rejection (shape only).
    const blockShape = [
      'http://2130706433/', // 127.0.0.1 as decimal
      'http://0x7f.0.0.1/', // hex octet
      'http://127.0.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
      'http://[::ffff:169.254.169.254]/',
      'http://user:pass@example.com/',
      'file:///etc/passwd',
      'gopher://127.0.0.1:6379/_',
      'http://localhost/',
      'http://foo.internal/',
    ];
    for (const u of blockShape) if (!shapeBlocked(u)) problems.push(`shape allowed ${u}`);

    // A normal public https URL must pass the shape check.
    try {
      checkUrlShape('https://example.com/health');
    } catch {
      problems.push('public https URL rejected by shape check');
    }

    // Address classifier.
    const mustBlock = ['10.0.0.1', '192.168.1.1', '172.16.0.1', '127.0.0.1', '169.254.169.254', '100.64.0.1', '::1'];
    for (const ip of mustBlock) if (!blockedAddress(ip)) problems.push(`classifier allowed ${ip}`);
    if (blockedAddress('93.184.216.34')) problems.push('classifier blocked a public address');

    // DNS rebinding: public-looking name that resolves to a private address.
    const rebind: ResolvedAddress[] = [{ address: '169.254.169.254', family: 4 }];
    const restore = setOutboundDeps({ resolver: async () => rebind });
    try {
      await vetUrl('https://totally-public.example/');
      problems.push('vetUrl allowed a name that resolves to cloud metadata (rebinding)');
    } catch (e) {
      if (!(e instanceof BlockedTargetError)) problems.push(`rebinding raised wrong error: ${(e as Error).message}`);
    } finally {
      restore();
    }

    // Mixed answer: one public + one private → still blocked (any private fails closed).
    const mixed: ResolvedAddress[] = [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ];
    const restore2 = setOutboundDeps({ resolver: async () => mixed });
    try {
      await vetUrl('https://mixed.example/');
      problems.push('vetUrl allowed a name with a private address in its answer set');
    } catch (e) {
      if (!(e instanceof BlockedTargetError)) problems.push(`mixed answer raised wrong error: ${(e as Error).message}`);
    } finally {
      restore2();
    }

    // Control: a name resolving only to a public address passes.
    const restore3 = setOutboundDeps({ resolver: async () => [{ address: '93.184.216.34', family: 4 }] });
    try {
      await vetUrl('https://ok.example/');
    } catch (e) {
      problems.push(`public destination rejected: ${(e as Error).message}`);
    } finally {
      restore3();
    }

    return {
      status: problems.length ? 'fail' : 'pass',
      id: 'INFO-SSRF-GUARD',
      detail: problems.length
        ? problems.join('; ')
        : 'IP tricks + internal hosts blocked; classifier correct; DNS rebinding (incl. mixed answers) fails closed; public allowed',
    };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
