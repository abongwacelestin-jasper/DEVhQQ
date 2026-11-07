/**
 * Lets any check file run on its own: boots a fresh server, runs the check,
 * prints the result and exits non-zero when a vulnerability is present
 * (fail = 1, skip = 2, pass = 0). The shared runner imports the Check instead.
 */

import { spawnServer, type Check } from './harness.ts';

export function isMain(metaUrl: string): boolean {
  return process.argv[1] === metaUrl.replace('file://', '');
}

export async function runStandalone(check: Check): Promise<void> {
  let server;
  try {
    server = await spawnServer({ env: check.env });
    const f = await check.run(server.base, server);
    const tag = f.status.toUpperCase();
    console.log(`[${tag}] ${check.name} — ${f.detail}`);
    process.exit(f.status === 'fail' ? 1 : f.status === 'skip' ? 2 : 0);
  } catch (e) {
    console.log(`[ERROR] ${check.name} — ${(e as Error).message}`);
    process.exit(3);
  } finally {
    server?.stop();
  }
}
