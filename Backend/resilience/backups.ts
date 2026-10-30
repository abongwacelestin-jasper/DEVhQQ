/**
 * Immutable backups and restore drills.
 *
 * Assume breach: if ransomware or a destructive bug hits primary storage, the
 * recovery points must survive. Snapshots here are:
 *  - written with the `wx` flag (create-only — never overwrite),
 *  - made read-only (0o444) immediately after writing,
 *  - checksummed (SHA-256) in a manifest so silent corruption is detected,
 *  - retained under a lock window during which pruning refuses to delete them.
 *
 * In production, point BACKUP_DIR at object storage with Object Lock /
 * WORM retention in a separate account — local file modes alone don't stop
 * a root-level attacker.
 */

import { createHash } from 'node:crypto';
import { chmod, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/env.ts';
import { snapshot } from '../store/db.ts';
import { audit } from '../audit/auditLog.ts';

interface Manifest {
  file: string;
  sha256: string;
  createdAt: string;
  bytes: number;
}

const MANIFEST = 'manifest.jsonl';

export async function createBackup(): Promise<Manifest> {
  await mkdir(config.backups.dir, { recursive: true });
  const createdAt = new Date().toISOString();
  const file = `snapshot-${createdAt.replace(/[:.]/g, '-')}.json`;
  const data = Buffer.from(JSON.stringify({ version: 1, createdAt, data: snapshot() }));
  const sha256 = createHash('sha256').update(data).digest('hex');
  const path = join(config.backups.dir, file);
  await writeFile(path, data, { flag: 'wx' });
  await chmod(path, 0o444);
  const entry: Manifest = { file, sha256, createdAt, bytes: data.length };
  await writeFile(join(config.backups.dir, MANIFEST), JSON.stringify(entry) + '\n', { flag: 'a' });
  audit.append({
    actor: 'system',
    action: 'backup.created',
    target: `${file} · ${data.length} bytes`,
    sensitive: false,
  });
  return entry;
}

async function manifest(): Promise<Manifest[]> {
  try {
    const raw = await readFile(join(config.backups.dir, MANIFEST), 'utf8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Manifest);
  } catch {
    return [];
  }
}

export async function verifyBackup(m: Manifest): Promise<boolean> {
  const data = await readFile(join(config.backups.dir, m.file));
  return createHash('sha256').update(data).digest('hex') === m.sha256;
}

/**
 * Restore drill: loads the newest snapshot, verifies its checksum and parses
 * it — without touching live data. The duration is our measured MTTR floor.
 */
export async function restoreDrill(): Promise<{
  ok: boolean;
  file?: string;
  ms: number;
  records?: number;
}> {
  const started = Date.now();
  const latest = (await manifest()).at(-1);
  if (!latest) return { ok: false, ms: 0 };
  const ok = await verifyBackup(latest);
  let records = 0;
  if (ok) {
    const parsed = JSON.parse(await readFile(join(config.backups.dir, latest.file), 'utf8')) as {
      data: Record<string, unknown[]>;
    };
    records = Object.values(parsed.data).reduce((n, l) => n + l.length, 0);
  }
  const result = { ok, file: latest.file, ms: Date.now() - started, records };
  audit.append({
    actor: 'system',
    action: ok ? 'backup.drill_passed' : 'backup.drill_failed',
    target: `${latest.file} · ${result.ms}ms`,
    sensitive: !ok,
  });
  return result;
}

/** Deletes snapshots older than the retention window. Never touches files still under lock. */
export async function pruneBackups(): Promise<number> {
  const cutoff = Date.now() - config.backups.retentionDays * 86_400_000;
  const entries = await manifest();
  const files = new Set(await readdir(config.backups.dir).catch(() => [] as string[]));
  let removed = 0;
  for (const m of entries) {
    if (new Date(m.createdAt).getTime() < cutoff && files.has(m.file)) {
      await chmod(join(config.backups.dir, m.file), 0o644);
      await unlink(join(config.backups.dir, m.file));
      removed++;
    }
  }
  if (removed)
    audit.append({
      actor: 'system',
      action: 'backup.pruned',
      target: `${removed} snapshot(s)`,
      sensitive: false,
    });
  return removed;
}

export async function backupStatus() {
  const entries = await manifest();
  const latest = entries.at(-1);
  return {
    count: entries.length,
    latest: latest ? { ...latest, verified: await verifyBackup(latest).catch(() => false) } : null,
    retentionDays: config.backups.retentionDays,
  };
}
