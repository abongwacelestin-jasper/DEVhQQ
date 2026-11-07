/**
 * Repositories and code findings.
 *
 * Every repo maps to exactly one product; reads are filtered to the caller's
 * products and out-of-scope repos are 404 (existence is never revealed).
 * With GitHub unconfigured: labelled demo data outside production, 503
 * `integration_unconfigured` in production.
 *
 *   GET  /api/repos                       Repository:view
 *   GET  /api/repos/:repoId               Repository:view (id or URL-encoded owner/name)
 *   POST /api/repos                       Repository:manage — link a repo to a product
 *   GET  /api/security/code-findings      Repository:view (?repo=&kind=&severity=&status=)
 *   POST /api/security/code-findings      Repository:manage — CI ingest
 */

import type { Router } from '../lib/http.ts';
import { parse, v } from '../lib/validate.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { assertProduct, canSeeProduct, requireArea } from '../auth/rbac.ts';
import { audit } from '../audit/auditLog.ts';
import { publish } from '../lib/events.ts';
import { HttpError } from '../types.ts';
import {
  PRODUCTS,
  findRepo,
  findings,
  paginate,
  repos,
  visibleRepo,
  weekStart,
} from '../domain/engineering/store.ts';
import type { Repo } from '../domain/engineering/types.ts';
import { included, prepareGithubRead, repoDetail, repoView } from '../domain/engineering/views.ts';
import { upsertFinding } from '../domain/engineering/findings.ts';
import { githubLive, githubMode, githubSource } from '../integrations/github/config.ts';
import { githubRequest } from '../integrations/github/client.ts';
import { ghInstallations } from '../domain/engineering/store.ts';

const fullName = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

const linkBody = v.object({
  fullName: v.string({ pattern: fullName }),
  product: v.enumOf(PRODUCTS),
  defaultBranch: v.optional(v.string({ min: 1, max: 100, pattern: /^[A-Za-z0-9._/-]+$/ })),
  language: v.optional(v.string({ min: 1, max: 40 })),
});

const kinds = ['dependency', 'secret', 'code', 'license'] as const;
const severities = ['critical', 'high', 'medium', 'low'] as const;
const findingItem = v.object({
  kind: v.enumOf(kinds),
  severity: v.enumOf(severities),
  title: v.string({ min: 3, max: 200 }),
  location: v.string({ min: 1, max: 300 }),
  detail: v.optional(v.string({ max: 2000 })),
  fix: v.optional(v.string({ max: 500 })),
  cve: v.optional(v.string({ pattern: /^(CVE|GHSA)-[\w-]{4,40}$/ })),
  ruleId: v.optional(v.string({ min: 1, max: 120 })),
  owner: v.optional(v.string({ max: 20 })),
  status: v.optional(v.enumOf(['open', 'fixed', 'dismissed'] as const)),
  dismissReason: v.optional(v.string({ max: 300 })),
});
const ingestBody = v.object({
  repo: v.string({ min: 1, max: 201 }),
  tool: v.optional(v.string({ min: 1, max: 60 })),
  findings: v.array(findingItem, { max: 500 }),
});

interface GhRepoInfo {
  id: number;
  full_name: string;
  default_branch: string;
  language: string | null;
  private: boolean;
  html_url: string;
}

export function registerRepoRoutes(r: Router) {
  r.add(
    'GET',
    '/api/repos',
    {
      summary: 'Repositories in my products (?product=)',
      tag: 'repos',
      responses: [401, 403, 503],
    },
    authenticate,
    requireArea('Repository', 'view'),
    (ctx) => {
      prepareGithubRead();
      const product = ctx.query.get('product');
      const rows = [...repos.values()]
        .filter(
          (x) =>
            included(x) &&
            canSeeProduct(ctx.principal!, x.product) &&
            (!product || x.product === product),
        )
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(repoView);
      return { ...paginate(rows, ctx.query), source: githubSource() };
    },
  );

  r.add(
    'GET',
    '/api/repos/:repoId',
    {
      summary: 'One repository: commits, CI runs, branch protection',
      tag: 'repos',
      responses: [401, 403, 404, 503],
    },
    authenticate,
    requireArea('Repository', 'view'),
    (ctx) => {
      prepareGithubRead();
      return repoDetail(visibleRepo(ctx.principal!, ctx.params.repoId, included));
    },
  );

  r.add(
    'POST',
    '/api/repos',
    {
      summary: 'Link a repository to a product',
      tag: 'repos',
      responses: [401, 403, 404, 409, 422, 429, 502, 503],
    },
    authenticate,
    requireArea('Repository', 'manage'),
    async (ctx) => {
      const body = parse(linkBody, ctx.body);
      assertProduct(ctx.principal!, body.product);
      prepareGithubRead();
      const existing = findRepo(body.fullName, included);
      if (existing && included(existing))
        throw new HttpError(
          409,
          'already_linked',
          `${existing.name} is linked to ${existing.product}`,
        );
      const now = new Date().toISOString();
      let info: GhRepoInfo | undefined;
      const mode = githubMode();
      if (mode === 'app' || mode === 'token') {
        const inst = [...ghInstallations.values()].find(
          (i) =>
            !i.removedAt &&
            i.repositories.some((n) => n.toLowerCase() === body.fullName.toLowerCase()),
        );
        info = await githubRequest<GhRepoInfo>('GET', `/repos/${body.fullName}`, {
          auth: { kind: 'auto', installationId: inst?.id },
        });
      }
      const repo: Repo = {
        id: info
          ? `gh-${info.id}`
          : `repo-${body.fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        name: info?.full_name ?? body.fullName,
        product: body.product,
        defaultBranch: info?.default_branch ?? body.defaultBranch ?? 'main',
        language: info?.language ?? body.language ?? 'Unknown',
        private: info?.private ?? true,
        url: info?.html_url,
        githubId: info?.id,
        recentCommits: [],
        weeklyCommits: Array<number>(8).fill(0),
        weeklyAnchor: weekStart(),
        latestTag: '',
        linkedBy: ctx.principal!.memberId,
        linkedAt: now,
        updatedAt: now,
        source: info ? 'github' : githubLive() ? 'manual' : 'demo',
      };
      repos.set(repo.id, repo);
      audit.append({
        actor: ctx.principal!.memberId,
        action: 'repo.linked',
        target: `${repo.name} → ${repo.product}`,
        requestId: ctx.requestId,
      });
      publish('repo', { id: repo.id, name: repo.name, product: repo.product });
      ctx.status = 201;
      return repoDetail(repo);
    },
  );

  // ── Code findings ───────────────────────────────────────────────────────
  r.add(
    'GET',
    '/api/security/code-findings',
    {
      summary: 'Secret-scan, dependency and code findings (?repo=&kind=&severity=&status=)',
      tag: 'code-findings',
      responses: [401, 403, 404, 503],
    },
    authenticate,
    requireArea('Repository', 'view'),
    (ctx) => {
      prepareGithubRead();
      const q = ctx.query;
      const repoParam = q.get('repo');
      const repo = repoParam ? visibleRepo(ctx.principal!, repoParam, included) : undefined;
      const rows = [...findings.values()]
        .filter(
          (f) =>
            included(f) &&
            canSeeProduct(ctx.principal!, f.product) &&
            (!repo || f.repoId === repo.id) &&
            (!q.get('kind') || f.kind === q.get('kind')) &&
            (!q.get('severity') || f.severity === q.get('severity')) &&
            (!q.get('status') || f.status === q.get('status')),
        )
        .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt))
        .map(({ fingerprint: _fp, ...f }) => f);
      return { ...paginate(rows, q, 200), source: githubSource() };
    },
  );

  r.add(
    'POST',
    '/api/security/code-findings',
    {
      summary: 'Ingest findings from CI (deduplicated, secrets masked)',
      tag: 'code-findings',
      responses: [401, 403, 404, 422, 503],
    },
    authenticate,
    requireArea('Repository', 'manage'),
    (ctx) => {
      const body = parse(ingestBody, ctx.body);
      prepareGithubRead();
      const repo = visibleRepo(ctx.principal!, body.repo, included);
      let created = 0;
      let updated = 0;
      const ids: string[] = [];
      for (const f of body.findings) {
        const res = upsertFinding(repo, f, 'ci');
        ids.push(res.row.id);
        if (res.created) created++;
        else updated++;
      }
      audit.append({
        actor: ctx.principal!.memberId,
        action: 'code_findings.ingested',
        target: `${repo.name} · ${body.tool ?? 'ci'} · +${created} ~${updated}`,
        sensitive: body.findings.some((f) => f.kind === 'secret'),
        requestId: ctx.requestId,
      });
      publish('code_finding', { repo: repo.name, created, updated });
      ctx.status = 201;
      return { repo: repo.name, created, updated, ids };
    },
  );
}
