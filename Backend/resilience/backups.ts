/**
 * Encrypted, immutable backups in object storage — with a real restore path.
 *
 * Assume breach: if ransomware or a destructive bug hits primary storage, the
 * recovery points must survive and must be usable. Each backup is:
 *  - a snapshot of every registered collection (resilience/sources.ts),
 *  - gzip-compressed, then AES-256-GCM encrypted (resilience/encryption.ts)
 *    with the backup id as associated data,
 *  - checksummed twice: SHA-256 of the stored ciphertext (detects storage
 *    corruption before decrypting) and of the plaintext (proves the restore
 *    produced exactly what was snapshotted),
 *  - written to the backups bucket, which has Object Lock (COMPLIANCE in
 *    production, GOVERNANCE in dev) and a default retention, so neither the
 *    app credential nor an attacker holding it can delete or overwrite it.
 *    Expiry after retention is done by the bucket lifecycle, not the app.
 *
 * Layout in the bucket:
 *   snapshots/YYYY/MM/DD/<id>.json.gz.enc   the encrypted snapshot
 *   manifests/<id>.json                     metadata + checksums (also locked)
 *
 * Restore is dry-run by default: it downloads, verifies, decrypts and diffs
 * against live data without writing. A real restore first takes a safety
 * backup of the current state, then writes rows back through the collections.
 */

import { createHash, randomBytes } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { config } from '../config/env.ts';
import { audit } from '../audit/auditLog.ts';
import { buckets, objectStore, StorageError, wormMode } from '../storage/index.ts';
import { decryptBlob, DecryptError, encryptBlob, encryptionKeyId } from './encryption.ts';
import {
  applyRestore,
  planRestore,
  takeSnapshot,
  type SnapshotBody,
  type TablePlan,
} from './sources.ts';

export interface Manifest {
  id: string;
  /** Object key of the encrypted snapshot (kept as `file` for older callers). */
  file: string;
  bucket: string;
  store: 's3' | 'local';
  createdAt: string;
  /** Size of the stored (encrypted) object. */
  bytes: number;
  /** SHA-256 of the stored object. */
  sha256: string;
  /** SHA-256 of the decrypted, decompressed snapshot JSON. */
  plainSha256: string;
  keyId: string;
  encryption: 'aes-256-gcm';
  records: number;
  collections: Record<string, number>;
  uncovered: string[];
  lock?: { mode: string; retainUntil: string };
  versionId?: string;
}

const ID_RE = /^bk-\d{8}T\d{6}Z-[0-9a-f]{6}$/;

export function isBackupId(id: string): boolean {
  return ID_RE.test(id);
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const manifestKey = (id: string) => `manifests/${id}.json`;

export async function createBackup(reason = 'scheduled'): Promise<Manifest> {
  const store = objectStore();
  const now = new Date();
  const createdAt = now.toISOString();
  const stamp = createdAt.replace(/[-:]|\.\d{3}/g, '');
  const id = `bk-${stamp}-${randomBytes(3).toString('hex')}`;
  const snap = takeSnapshot(id, createdAt);
  const plain = Buffer.from(JSON.stringify(snap));
  const blob = encryptBlob(gzipSync(plain), id);
  const key = `snapshots/${createdAt.slice(0, 4)}/${createdAt.slice(5, 7)}/${createdAt.slice(8, 10)}/${id}.json.gz.enc`;

  const collections: Record<string, number> = {};
  for (const [n, rows] of Object.entries(snap.collections)) collections[n] = rows.length;
  for (const [n, rows] of Object.entries(snap.legacy)) collections[n] = rows.length;
  const records = Object.values(collections).reduce((a, b) => a + b, 0);

  const put = await store.putObject(buckets.backups, key, blob, {
    contentType: 'application/octet-stream',
    metadata: { 'backup-id': id, sha256: sha256(blob), 'key-id': encryptionKeyId() },
  });
  const head = await store.headObject(buckets.backups, key);
  const manifest: Manifest = {
    id,
    file: key,
    bucket: buckets.backups,
    store: store.kind,
    createdAt,
    bytes: blob.length,
    sha256: sha256(blob),
    plainSha256: sha256(plain),
    keyId: encryptionKeyId(),
    encryption: 'aes-256-gcm',
    records,
    collections,
    uncovered: snap.uncovered,
    lock: head?.lock,
    versionId: put.versionId,
  };
  await store.putObject(
    buckets.backups,
    manifestKey(id),
    Buffer.from(JSON.stringify(manifest, null, 2)),
    { contentType: 'application/json' },
  );
  audit.append({
    actor: 'system',
    action: 'backup.created',
    target: `${id} · ${records} records · ${blob.length} bytes · ${reason}${manifest.lock ? ` · ${manifest.lock.mode}` : ''}`,
    sensitive: false,
  });
  return manifest;
}

/** Manifest object keys, oldest first (ids sort chronologically). */
async function manifestKeys(): Promise<string[]> {
  const store = objectStore();
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await store.listObjects(buckets.backups, {
      prefix: 'manifests/',
      continuationToken: token,
    });
    keys.push(...page.items.map((i) => i.key));
    token = page.nextToken;
  } while (token);
  return keys.sort();
}

/** The newest `limit` manifests, oldest first. */
export async function listBackups(limit = 100): Promise<Manifest[]> {
  const store = objectStore();
  const out: Manifest[] = [];
  for (const k of (await manifestKeys()).slice(-limit)) {
    const obj = await store.getObject(buckets.backups, k);
    if (obj) out.push(JSON.parse(obj.body.toString('utf8')) as Manifest);
  }
  return out;
}

export async function getManifest(id: string): Promise<Manifest | null> {
  if (!isBackupId(id)) return null;
  const obj = await objectStore().getObject(buckets.backups, manifestKey(id));
  return obj ? (JSON.parse(obj.body.toString('utf8')) as Manifest) : null;
}

export async function verifyBackup(m: Manifest): Promise<boolean> {
  const obj = await objectStore().getObject(m.bucket, m.file);
  return !!obj && sha256(obj.body) === m.sha256;
}

/** Downloads, verifies both checksums and decrypts. Throws a coded error on failure. */
async function load(m: Manifest): Promise<SnapshotBody> {
  const obj = await objectStore().getObject(m.bucket, m.file);
  if (!obj) throw new BackupError('backup_missing', `Snapshot object ${m.file} not found`);
  if (sha256(obj.body) !== m.sha256)
    throw new BackupError(
      'checksum_mismatch',
      'Stored object does not match its manifest checksum',
    );
  let plain: Buffer;
  try {
    plain = gunzipSync(decryptBlob(obj.body, m.id));
  } catch (e) {
    throw new BackupError(
      e instanceof DecryptError ? `decrypt_${e.code}` : 'decompress_failed',
      (e as Error).message,
    );
  }
  if (sha256(plain) !== m.plainSha256)
    throw new BackupError('checksum_mismatch', 'Decrypted snapshot does not match its checksum');
  const body = JSON.parse(plain.toString('utf8')) as SnapshotBody;
  if (body.version !== 2 || body.id !== m.id)
    throw new BackupError('format_unsupported', 'Snapshot version or id mismatch');
  return body;
}

export class BackupError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface RestoreResult {
  id: string;
  dryRun: boolean;
  verified: true;
  createdAt: string;
  plan: TablePlan[];
  /** Rows written per collection (real restore only). */
  applied?: Record<string, number>;
  /** Safety backup taken before a real restore. */
  safetyBackupId?: string;
  ms: number;
}

/**
 * Restores a backup. Dry-run (the default) verifies, decrypts and reports
 * what would change without writing anything.
 */
export async function restoreBackup(
  id: string,
  opts: { dryRun: boolean; collections?: string[]; actor: string; requestId?: string },
): Promise<RestoreResult | null> {
  const started = Date.now();
  const m = await getManifest(id);
  if (!m) return null;
  const snap = await load(m);
  const plan = planRestore(snap).filter(
    (p) => !opts.collections || opts.collections.includes(p.name),
  );
  const result: RestoreResult = {
    id,
    dryRun: opts.dryRun,
    verified: true,
    createdAt: m.createdAt,
    plan,
    ms: 0,
  };
  if (!opts.dryRun) {
    const safety = await createBackup(`pre-restore of ${id}`);
    result.safetyBackupId = safety.id;
    result.applied = applyRestore(snap, opts.collections);
  }
  result.ms = Date.now() - started;
  const writes = Object.values(result.applied ?? {}).reduce((a, b) => a + b, 0);
  audit.append({
    actor: opts.actor,
    action: opts.dryRun ? 'backup.restore_dry_run' : 'backup.restored',
    target: opts.dryRun
      ? `${id} · ${plan.length} tables checked`
      : `${id} · ${writes} rows written · safety ${result.safetyBackupId}`,
    sensitive: !opts.dryRun,
    requestId: opts.requestId,
  });
  return result;
}

/**
 * Restore drill: loads the newest snapshot, verifies its checksums, decrypts
 * and parses it — without touching live data. The duration is our measured
 * MTTR floor.
 */
export async function restoreDrill(): Promise<{
  ok: boolean;
  id?: string;
  file?: string;
  ms: number;
  records?: number;
  error?: string;
}> {
  const started = Date.now();
  const latest = (await listBackups(1)).at(-1);
  if (!latest) return { ok: false, ms: 0 };
  let ok = true;
  let records = 0;
  let error: string | undefined;
  try {
    const snap = await load(latest);
    records =
      Object.values(snap.collections).reduce((n, l) => n + l.length, 0) +
      Object.values(snap.legacy).reduce((n, l) => n + l.length, 0);
  } catch (e) {
    ok = false;
    error = e instanceof BackupError ? e.code : 'unreadable';
  }
  const result = { ok, id: latest.id, file: latest.file, ms: Date.now() - started, records, error };
  audit.append({
    actor: 'system',
    action: ok ? 'backup.drill_passed' : 'backup.drill_failed',
    target: `${latest.id} · ${result.ms}ms${error ? ` · ${error}` : ''}`,
    sensitive: !ok,
  });
  return result;
}

/**
 * Expires snapshots past retention. On S3 the bucket lifecycle does this (the
 * backend credential has no delete permission on the backups bucket), so this
 * only acts on the local driver. Objects still under lock are never removed.
 */
export async function pruneBackups(): Promise<number> {
  const store = objectStore();
  if (store.kind !== 'local') return 0;
  const cutoff = Date.now() - config.backups.retentionDays * 86_400_000;
  let removed = 0;
  for (const m of await listBackups(10_000)) {
    if (new Date(m.createdAt).getTime() >= cutoff) continue;
    try {
      await store.deleteObject(m.bucket, m.file);
      await store.deleteObject(m.bucket, manifestKey(m.id));
      removed++;
    } catch (e) {
      if (!(e instanceof StorageError && e.code === 'AccessDenied')) throw e;
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
  const count = await manifestKeys()
    .then((k) => k.length)
    .catch(() => 0);
  const latest = (await listBackups(1).catch(() => [] as Manifest[])).at(-1);
  return {
    count,
    latest: latest ? { ...latest, verified: await verifyBackup(latest).catch(() => false) } : null,
    retentionDays: config.backups.retentionDays,
    store: objectStore().kind,
    bucket: buckets.backups,
    lockMode: wormMode,
  };
}
