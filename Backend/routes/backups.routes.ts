/**
 * Backup history and restore (STORAGE).
 *
 * `GET /api/backups`, `POST /api/backups` and `POST /api/backups/drill` stay
 * in security.routes.ts (SEC); they call the same resilience/backups.ts
 * functions. Restore lives here because STORAGE owns the restore path —
 * the coordinator may move it next to the other backup routes later.
 *
 * Restore is Administration:admin + step-up, and dry-run unless the body says
 * `{ "dryRun": false, "confirm": "<backup id>" }`. A real restore first takes
 * a safety backup of the current state.
 */

import type { Router } from '../lib/http.ts';
import { parse, v } from '../lib/validate.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { requireArea, requireStepUp } from '../auth/rbac.ts';
import { HttpError } from '../types.ts';
import { BackupError, isBackupId, listBackups, restoreBackup } from '../resilience/backups.ts';
import { auditArchiveStatus } from '../storage/auditArchive.ts';
import { storageInfo } from '../storage/index.ts';

const restoreBody = v.object({
  dryRun: v.optional(v.boolean()),
  confirm: v.optional(v.string({ max: 64 })),
  collections: v.optional(v.array(v.string({ min: 1, max: 64 }), { max: 200 })),
});

export function registerBackupRoutes(r: Router) {
  r.add(
    'GET',
    '/api/backups/snapshots',
    { summary: 'Backup manifests, newest first (limit ≤ 100)', tag: 'backups' },
    authenticate,
    requireArea('Infrastructure', 'manage'),
    async (ctx) => {
      const limit = Math.max(1, Math.min(100, Number(ctx.query.get('limit') ?? 20) || 20));
      return { items: (await listBackups(limit)).reverse() };
    },
  );

  r.add(
    'GET',
    '/api/storage/status',
    { summary: 'Object storage driver, buckets and audit archive state', tag: 'backups' },
    authenticate,
    requireArea('Infrastructure', 'view'),
    () => ({ ...storageInfo(), auditArchive: auditArchiveStatus() }),
  );

  r.add(
    'POST',
    '/api/backups/:id/restore',
    {
      summary: 'Restore a backup — dry-run by default (admin + step-up)',
      tag: 'backups',
      responses: [401, 403, 404, 422],
    },
    authenticate,
    requireArea('Administration', 'admin'),
    requireStepUp(),
    async (ctx) => {
      const id = ctx.params.id;
      const body = parse(restoreBody, ctx.body ?? {});
      const dryRun = body.dryRun !== false;
      if (!isBackupId(id)) throw new HttpError(404, 'not_found', 'Backup not found');
      if (!dryRun && body.confirm !== id)
        throw new HttpError(
          422,
          'confirmation_required',
          'Set "confirm" to the backup id to restore for real',
        );
      try {
        const result = await restoreBackup(id, {
          dryRun,
          collections: body.collections,
          actor: ctx.principal!.memberId,
          requestId: ctx.requestId,
        });
        if (!result) throw new HttpError(404, 'not_found', 'Backup not found');
        return result;
      } catch (e) {
        if (e instanceof BackupError) throw new HttpError(422, e.code, e.message);
        throw e;
      }
    },
  );
}
