/**
 * Process-level test environment. Loaded with `--import ./test/setup.ts` by
 * every test script, and imported first by the helpers so a single file can
 * also be run directly (`node --experimental-strip-types --test test/unit/x.test.ts`).
 *
 * Module-level config (config/env.ts, lib/logger.ts, audit/auditLog.ts) is
 * read once at import time, so these variables must be set before any app
 * module loads. Each test file runs in its own process (node --test default),
 * so every file gets a fresh temp dir, a fresh in-memory store and fresh
 * rate-limit buckets — nothing is shared between files or between runs.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!process.env.DEVHQ_TEST_DIR) {
  const dir = mkdtempSync(join(tmpdir(), 'devhq-test-'));
  process.env.DEVHQ_TEST_DIR = dir;
  process.env.NODE_ENV = 'test';
  // Errors only: request logs would drown the reporter output.
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'error';
  process.env.AUDIT_LOG_FILE = join(dir, 'audit.jsonl');
  process.env.BACKUP_DIR = join(dir, 'backups');
  // Integration helpers give each simulated client its own X-Forwarded-For
  // address, so rate-limit buckets and session IP binding are per client.
  process.env.TRUST_PROXY = '1';
  // Never pick up a developer's real secrets or a TOTP secret that would
  // change which MFA path the demo accounts take.
  delete process.env.DEMO_TOTP_SECRET;
  delete process.env.DEMO_DISABLED;
  delete process.env.SESSION_SECRET_PREVIOUS;
  delete process.env.DATABASE_URL;
}
