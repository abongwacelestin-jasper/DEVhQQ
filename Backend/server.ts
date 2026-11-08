/**
 * DevHQ API server — entry point.
 *
 * Run (Node 22.6+, no build step, no runtime dependencies):
 *   cd Backend && npm run dev
 * or directly:
 *   node --experimental-strip-types Backend/server.ts
 *
 * Then open http://localhost:8080/console for the backend console.
 * Demo sign-in (non-production): any demo email, password `devhq-demo`,
 * code `246810` — or the one-click role buttons on the console login.
 *
 * TLS 1.3 is terminated at the edge (load balancer / WAAP), which also handles
 * bot mitigation. This process enforces everything that must hold even if the
 * edge is bypassed: headers, origin checks, rate limits, authentication,
 * authorization, validation and auditing.
 *
 * Request pipeline (in order):
 *   securityHeaders → originGuard → apiLimiter → route guards
 *   (authLimiter / authenticate / requireArea / requireStepUp) → handler
 */

import { createServer } from 'node:http';
import { config } from './config/env.ts';
import { Router } from './lib/http.ts';
import { logger } from './lib/logger.ts';
import { originGuard, securityHeaders } from './security/headers.ts';
import { apiLimiter } from './security/rateLimit.ts';
import { DEMO, seed } from './store/db.ts';
import { closePersistence, initPersistence } from './db/boot.ts';
import { audit } from './audit/auditLog.ts';
import { createBackup, pruneBackups } from './resilience/backups.ts';
import { jobEnabled } from './lib/jobs.ts';
import { registerSystemRoutes } from './routes/system.routes.ts';
import { registerAuthRoutes, sealLegacyTotpSecrets } from './routes/auth.routes.ts';
import { registerProjectRoutes } from './routes/projects.routes.ts';
import { registerTaskRoutes } from './routes/tasks.routes.ts';
import { registerTeamRoutes } from './routes/team.routes.ts';
import { registerDocRoutes } from './routes/docs.routes.ts';
import { registerOperationsRoutes } from './routes/operations.routes.ts';
import { registerIncidentActionRoutes } from './routes/incident-actions.routes.ts';
import { registerLocationRoutes } from './routes/locations.routes.ts';
import { registerSecurityRoutes } from './routes/security.routes.ts';
import { registerCodespaceRoutes } from './routes/codespaces.routes.ts';
import { registerMessagingRoutes } from './routes/messaging.routes.ts';
import { registerWorkspaceRoutes } from './routes/workspaces.routes.ts';
import { registerNotificationRoutes } from './routes/notifications.routes.ts';
import { registerOnboardingRoutes } from './routes/onboarding.routes.ts';
import { registerRecoveryRoutes } from './routes/recovery.routes.ts';
import { registerOffboardingRoutes } from './routes/offboarding.routes.ts';
import { registerDocCollabRoutes } from './routes/doc-collab.routes.ts';
import { registerGithubRoutes } from './routes/github.routes.ts';
import { registerRepoRoutes } from './routes/repos.routes.ts';
import { registerPullRoutes } from './routes/pulls.routes.ts';
import { registerCiRoutes } from './routes/ci.routes.ts';
import { registerMonitorRoutes } from './routes/monitors.routes.ts';
import { registerIntegrationRoutes } from './routes/integrations.routes.ts';
import { registerWebhookRoutes } from './routes/webhooks.routes.ts';
import { registerFileRoutes } from './routes/files.routes.ts';
import { registerBackupRoutes } from './routes/backups.routes.ts';
import { registerTokenRoutes } from './routes/tokens.routes.ts';
import { registerInsightsRoutes } from './routes/insights.routes.ts';
import { registerAssistantRoutes } from './routes/assistant.routes.ts';

export async function buildApp() {
  // Postgres when DATABASE_URL is set (migrate → driver → hydrate → seed-if-empty), else in-memory.
  await initPersistence(seed);
  const router = new Router();
  router.use(securityHeaders);
  router.use(originGuard);
  router.use(apiLimiter);

  registerSystemRoutes(router);
  registerAuthRoutes(router);
  await sealLegacyTotpSecrets();
  registerProjectRoutes(router);
  registerTaskRoutes(router);
  registerTeamRoutes(router);
  registerDocRoutes(router);
  registerOperationsRoutes(router);
  registerIncidentActionRoutes(router);
  registerLocationRoutes(router);
  registerSecurityRoutes(router);
  registerCodespaceRoutes(router);
  registerMessagingRoutes(router);
  registerWorkspaceRoutes(router);
  registerNotificationRoutes(router);
  registerOnboardingRoutes(router);
  registerRecoveryRoutes(router);
  registerOffboardingRoutes(router);
  registerDocCollabRoutes(router);
  registerGithubRoutes(router);
  registerRepoRoutes(router);
  registerPullRoutes(router);
  registerCiRoutes(router);
  registerMonitorRoutes(router);
  registerIntegrationRoutes(router);
  registerWebhookRoutes(router);
  registerFileRoutes(router);
  registerBackupRoutes(router);
  registerTokenRoutes(router);
  registerInsightsRoutes(router);
  registerAssistantRoutes(router);
  return router;
}

async function main() {
  const router = await buildApp();
  const server = createServer((req, res) => void router.handle(req, res));

  // Slow-loris and resource-exhaustion protection.
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;

  server.listen(config.port, () => {
    logger.info('listening', {
      url: config.publicUrl,
      env: config.env,
      routes: router.inventory().length,
      console: `${config.publicUrl}/console`,
      demo: DEMO.enabled,
    });
    audit.append({
      actor: 'system',
      action: 'server.started',
      target: `${config.env} · port ${config.port}`,
    });
  });

  // Snapshot on boot (non-prod) and daily, then prune past retention.
  // JOBS_IN_PROCESS without `backup`: the cron service runs it (worker.ts --once).
  const backup = () =>
    void createBackup()
      .then(pruneBackups)
      .catch((e) => logger.error('backup failed', { err: String(e) }));
  if (jobEnabled('backup')) {
    if (!config.isProd) setTimeout(backup, 2000).unref();
    setInterval(backup, 24 * 60 * 60_000).unref();
  }

  const shutdown = (signal: string) => {
    logger.info('shutdown', { signal });
    audit.append({ actor: 'system', action: 'server.stopping', target: signal });
    // Stop accepting requests, then flush queued writes before exiting.
    server.close(() =>
      void closePersistence()
        .then(() => process.exit(0))
        .catch((err) => {
          logger.error('shutdown flush failed', { err: String(err) });
          process.exit(1);
        }),
    );
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (err) =>
    logger.error('unhandledRejection', { err: String(err) }),
  );
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('server.ts')) {
  main().catch((err) => {
    logger.error('fatal startup error', { err: String((err as Error)?.stack ?? err) });
    process.exit(1);
  });
}
