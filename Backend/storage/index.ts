/**
 * Storage entry point: picks the driver from config and exposes bucket names.
 *
 *   S3_ENDPOINT set    → S3 driver (MinIO / AWS S3 / R2)
 *   S3_ENDPOINT unset  → local disk driver (STORAGE_LOCAL_DIR)
 *
 * In production without S3, `uploadsAvailable()` is false and the files API
 * answers 503 integration_unconfigured; backups still land on local disk
 * (the pre-Wave-4 behaviour) and report `store: "local"` so it is visible.
 */

import { config } from '../config/env.ts';
import { createLocalStore } from './localDriver.ts';
import { createS3Store } from './s3Driver.ts';
import type { LockMode, ObjectStore } from './types.ts';

export * from './types.ts';

export const buckets = config.storage.buckets;

/** WORM mode for backups/audit: compliance in production, governance elsewhere. */
export const lockMode: LockMode = config.isProd ? 'COMPLIANCE' : 'GOVERNANCE';

/**
 * How the backups/audit buckets are actually made immutable, as reported by
 * the status endpoints. S3 and MinIO use Object Lock (`lockMode`). Cloudflare
 * R2 has no Object Lock API: it uses bucket lock rules, which block delete and
 * overwrite for every API token but can be removed by a Cloudflare account
 * admin, so they are reported as what they are rather than as COMPLIANCE
 * (docs/deploy/RAILWAY.md#worm-on-r2). Set with STORAGE_LOCK_MODE.
 */
export type WormMode = LockMode | 'R2_BUCKET_LOCK';

export function parseWormMode(raw: string | undefined, fallback: LockMode): WormMode {
  const v = (raw ?? '').trim().toUpperCase();
  if (!v) return fallback;
  if (v === 'GOVERNANCE' || v === 'COMPLIANCE' || v === 'R2_BUCKET_LOCK') return v;
  throw new Error(
    `STORAGE_LOCK_MODE must be GOVERNANCE | COMPLIANCE | R2_BUCKET_LOCK (got "${raw}")`,
  );
}

export const wormMode: WormMode = parseWormMode(process.env.STORAGE_LOCK_MODE, lockMode);

let store: ObjectStore | undefined;

export function objectStore(): ObjectStore {
  store ??= config.storage.endpoint
    ? createS3Store(config.storage)
    : createLocalStore({
        root: config.storage.localDir,
        secret: config.sessionSecret,
        allowedOrigins: config.allowedOrigins,
        defaultRetention: {
          // Mirrors infra/minio/bootstrap.sh. Short in dev so local state can be reset.
          [buckets.backups]: {
            mode: lockMode,
            days: config.isProd ? config.backups.retentionDays : 1,
          },
          [buckets.audit]: { mode: lockMode, days: config.isProd ? 365 : 1 },
        },
      });
  return store;
}

/** Test seam: swap the driver (e.g. a fault-injecting store). */
export function setObjectStore(next: ObjectStore | undefined) {
  store = next;
}

/** User uploads need real object storage in production; the local driver is dev/test only. */
export function uploadsAvailable(): boolean {
  return !!config.storage.endpoint || !config.isProd;
}

export function storageInfo() {
  return {
    driver: config.storage.endpoint ? 's3' : 'local',
    buckets,
    lockMode: wormMode,
    uploads: uploadsAvailable(),
  };
}
