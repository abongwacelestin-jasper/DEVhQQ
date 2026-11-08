/**
 * Security operations routes: audit trail, integrity verification, backups,
 * rate-limit state and a posture summary. Mutating actions need step-up.
 */

import type { Router } from '../lib/http.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { requireArea, requireStepUp } from '../auth/rbac.ts';
import { listGrants } from '../auth/jit.ts';
import { sessionCount } from '../auth/sessions.ts';
import { audit } from '../audit/auditLog.ts';
import { limiterStats } from '../security/rateLimit.ts';
import { backupStatus, createBackup, restoreDrill } from '../resilience/backups.ts';
import { config } from '../config/env.ts';
import { db } from '../store/db.ts';
import { repos } from '../data/index.ts';

export function registerSecurityRoutes(r: Router) {
  r.add(
    'GET',
    '/api/audit',
    { summary: 'Audit trail, newest first (limit, sensitive=1, actor, action)', tag: 'security' },
    authenticate,
    requireArea('Administration', 'view'),
    (ctx) => {
      const q = ctx.query;
      const actor = q.get('actor');
      const action = q.get('action');
      return audit
        .list({
          limit: Math.min(500, Number(q.get('limit') ?? 200)),
          sensitiveOnly: q.get('sensitive') === '1',
        })
        .filter((e) => (!actor || e.actor === actor) && (!action || e.action.startsWith(action)));
    },
  );

  r.add(
    'GET',
    '/api/audit/verify',
    { summary: 'Recompute and verify the audit hash chain across boots', tag: 'security' },
    authenticate,
    requireArea('Administration', 'view'),
    () => audit.verifyAll(),
  );

  r.add(
    'GET',
    '/api/security/posture',
    { summary: 'Live security posture across the six pillars', tag: 'security' },
    authenticate,
    requireArea('Administration', 'view'),
    async () => {
      const members = await repos.members.list({ status: 'active' });
      const passkeys = members.filter((m) => m.passkeys.length > 0).length;
      const grants = listGrants();
      return {
        identity: {
          activeMembers: members.length,
          withPasskey: passkeys,
          liveSessions: await sessionCount(),
          lockedAccounts: members.filter((m) => (m.lockedUntil ?? 0) > Date.now()).length,
        },
        waap: {
          rateLimits: config.rateLimits,
          maxBodyKb: config.maxBodyBytes / 1024,
          routesInventoried: r.inventory().length,
        },
        zeroTrust: {
          activeElevations: grants.filter((g) => g.status === 'active').length,
          pendingElevations: grants.filter((g) => g.status === 'pending').length,
        },
        crypto: { ...config.crypto, hsts: config.isProd, tls: 'TLS 1.3 at edge' },
        resilience: { audit: audit.verify(), backups: await backupStatus() },
      };
    },
  );

  r.add(
    'GET',
    '/api/security/rate-limits',
    { summary: 'Most-drained rate-limit buckets', tag: 'security' },
    authenticate,
    requireArea('Administration', 'view'),
    () => limiterStats(),
  );

  r.add(
    'GET',
    '/api/backups',
    { summary: 'Backup status and latest checksum', tag: 'backups' },
    authenticate,
    requireArea('Administration', 'view'),
    () => backupStatus(),
  );

  r.add(
    'POST',
    '/api/backups',
    {
      summary: 'Create an immutable snapshot now (step-up)',
      tag: 'backups',
      responses: [401, 403],
    },
    authenticate,
    requireArea('Infrastructure', 'manage'),
    requireStepUp(),
    (ctx) => {
      ctx.status = 201;
      return createBackup();
    },
  );

  r.add(
    'POST',
    '/api/backups/drill',
    {
      summary: 'Run a restore drill — no live data touched (step-up)',
      tag: 'backups',
      responses: [401, 403],
    },
    authenticate,
    requireArea('Infrastructure', 'manage'),
    requireStepUp(),
    () => restoreDrill(),
  );
}
