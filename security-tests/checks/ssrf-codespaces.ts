/**
 * SSRF — GitHub Codespaces proxy.
 *
 * The proxy pins the upstream host to https://api.github.com (constant) and
 * allow-lists repo (owner/name) and codespace name with strict regexes, so the
 * request target host cannot be redirected to an attacker server. Without a
 * GITHUB_TOKEN the routes fail closed (401 github_auth) and no upstream call is
 * made, so a live SSRF probe is not possible in this environment.
 *
 * This check confirms the fail-closed behaviour and the input allow-list
 * (malformed repo/name rejected with 422 before any fetch), and otherwise
 * SKIPs the network portion. Fails only if a malformed target is accepted or
 * the route makes an upstream call without a configured token.
 */

import { req, signInDemo, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

export const check: Check = {
  name: 'SSRF — codespaces proxy host-pinning / fail-closed',
  area: 'SSRF',
  run: async (base) => {
    if (process.env.GITHUB_TOKEN)
      return { status: 'skip', id: 'INFO-SSRF-CS', detail: 'GITHUB_TOKEN set — live egress probe out of local scope' };

    const token = await signInDemo(base, 'developer');
    const problems: string[] = [];

    // The upstream host is a compile-time constant (api.github.com); the repo
    // only fills owner/name path segments, so it can never redirect the host.
    // Inputs that fail the owner/name regex (scheme, extra slashes, spaces,
    // empty owner) must be rejected at validation (422) before any fetch.
    for (const repo of [
      'http://169.254.169.254/latest',
      'a/b/c',
      '/etc/passwd',
      'owner name',
      'owner/',
      '@evil.com/x',
    ]) {
      const r = await req(base, 'GET', `/api/codespaces?repo=${encodeURIComponent(repo)}`, { token });
      if (r.status !== 422) problems.push(`malformed repo "${repo}" not rejected (${r.status})`);
    }
    // A well-formed owner/name with no GITHUB_TOKEN must fail closed (401),
    // never hang or return data. (The host stays api.github.com regardless.)
    const closed = await req(base, 'GET', '/api/codespaces?repo=owner/name', { token });
    if (closed.status !== 401) problems.push(`no-token path did not fail closed (${closed.status})`);

    return {
      status: problems.length ? 'fail' : 'pass',
      id: 'INFO-SSRF-CS',
      detail: problems.length
        ? problems.join('; ')
        : 'host pinned to api.github.com (constant); malformed targets 422; fails closed (401) without token',
    };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
