/**
 * `npm run test:pg`: the repository contract (test/unit/repositories.test.ts)
 * against a real PostgreSQL. Needs DEVHQ_TEST_PG_URL pointing at a server
 * where the user may CREATE DATABASE (a throwaway container); the test
 * creates and drops its own database there.
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.env.DEVHQ_TEST_PG_URL) {
  console.error(
    'test:pg needs DEVHQ_TEST_PG_URL (e.g. postgres://postgres:…@127.0.0.1:55491/postgres)',
  );
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const r = spawnSync(
  process.execPath,
  [
    '--experimental-strip-types',
    '--import',
    join(here, 'setup.ts'),
    '--test',
    join(here, 'unit', 'repositories.test.ts'),
  ],
  { stdio: 'inherit', env: process.env },
);
process.exit(r.status ?? 1);
