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
    lockMode,
    uploads: uploadsAvailable(),
  };
}
