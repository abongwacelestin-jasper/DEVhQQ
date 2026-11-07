/**
 * CI runs (workflow runs, check suites and check runs ingested from GitHub).
 *
 *   GET /api/ci/runs?repo=&branch=&sha=&status=   Repository:view
 *   GET /api/ci/runs/:runId                       Repository:view
 */

import type { Router } from '../lib/http.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { canSeeProduct, requireArea } from '../auth/rbac.ts';
import { HttpError } from '../types.ts';
import { ciRuns, paginate, visibleRepo } from '../domain/engineering/store.ts';
import { included, prepareGithubRead, runView } from '../domain/engineering/views.ts';
import { githubSource } from '../integrations/github/config.ts';

export function registerCiRoutes(r: Router) {
  r.add(
    'GET',
    '/api/ci/runs',
    {
      summary: 'CI runs (?repo=&branch=&sha=&status=queued|in_progress|completed)',
      tag: 'ci',
      responses: [401, 403, 404, 503],
    },
    authenticate,
    requireArea('Repository', 'view'),
    (ctx) => {
      prepareGithubRead();
      const q = ctx.query;
      const repo = q.get('repo')
        ? visibleRepo(ctx.principal!, q.get('repo')!, included)
        : undefined;
      const rows = [...ciRuns.values()]
        .filter(
          (x) =>
            included(x) &&
            canSeeProduct(ctx.principal!, x.product) &&
            (!repo || x.repoId === repo.id) &&
            (!q.get('branch') || x.branch === q.get('branch')) &&
            (!q.get('sha') || x.sha.startsWith(q.get('sha')!)) &&
            (!q.get('status') || x.status === q.get('status')),
        )
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .map(runView);
      return { ...paginate(rows, q), source: githubSource() };
    },
  );

  r.add(
    'GET',
    '/api/ci/runs/:runId',
    { summary: 'One CI run', tag: 'ci', responses: [401, 403, 404, 503] },
    authenticate,
    requireArea('Repository', 'view'),
    (ctx) => {
      prepareGithubRead();
      const run = ciRuns.get(ctx.params.runId);
      if (!run || !included(run) || !canSeeProduct(ctx.principal!, run.product))
        throw new HttpError(404, 'not_found', 'Not found');
      return runView(run);
    },
  );
}
