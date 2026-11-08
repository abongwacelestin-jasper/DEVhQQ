/**
 * Pull requests.
 *
 *   GET  /api/pulls?repo=&state=&author=&product=   Repository:view
 *   GET  /api/pulls/:repoId/:number                  Repository:view
 *   POST /api/pulls/:repoId/:number/review           Repository:contribute
 *        {decision:'approve'|'request-changes'|'comment', body}
 *
 * Reviews are proxied to GitHub when the App (or a token) is configured; the
 * local row is only updated after GitHub accepts. Authors can never approve
 * (or request changes on) their own PR — enforced here even if GitHub would
 * accept it because the App posts as a bot.
 */

import type { Router } from '../lib/http.ts';
import { parse, v } from '../lib/validate.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { canSeeProduct, requireArea } from '../auth/rbac.ts';
import { audit } from '../audit/auditLog.ts';
import { publish } from '../lib/events.ts';
import { HttpError } from '../types.ts';
import {
  ghIdentities,
  memberForLogin,
  paginate,
  pulls,
  visibleRepo,
} from '../domain/engineering/store.ts';
import type { PullReview } from '../domain/engineering/types.ts';
import { included, prepareGithubRead, pullDetail, pullView } from '../domain/engineering/views.ts';
import { githubMode, githubSource } from '../integrations/github/config.ts';
import { githubRequest } from '../integrations/github/client.ts';
import { deriveReview } from '../integrations/github/webhook.ts';

const reviewBody = v.object({
  decision: v.enumOf(['approve', 'request-changes', 'comment'] as const),
  body: v.optional(v.string({ max: 65_000 })),
});

const ghEvent = {
  approve: 'APPROVE',
  'request-changes': 'REQUEST_CHANGES',
  comment: 'COMMENT',
} as const;
const localState: Record<keyof typeof ghEvent, PullReview['state']> = {
  approve: 'approved',
  'request-changes': 'changes_requested',
  comment: 'commented',
};

function loginsOf(memberId: string): string[] {
  return [...ghIdentities.values()].filter((i) => i.memberId === memberId).map((i) => i.login);
}

export function registerPullRoutes(r: Router) {
  r.add(
    'GET',
    '/api/pulls',
    {
      summary: 'Pull requests (?repo=&state=open|closed|merged&author=&product=)',
      tag: 'pulls',
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
      const author = q.get('author');
      const rows = [...pulls.values()]
        .filter(
          (p) =>
            included(p) &&
            canSeeProduct(ctx.principal!, p.product) &&
            (!repo || p.repoId === repo.id) &&
            (!q.get('state') || q.get('state') === 'all' || p.state === q.get('state')) &&
            (!q.get('product') || p.product === q.get('product')) &&
            (!author ||
              p.author === author ||
              p.authorLogin?.toLowerCase() === author.toLowerCase()),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(pullView);
      return { ...paginate(rows, q), source: githubSource() };
    },
  );

  r.add(
    'GET',
    '/api/pulls/:repoId/:number',
    {
      summary: 'One pull request with reviews, checks and linked task',
      tag: 'pulls',
      responses: [401, 403, 404, 503],
    },
    authenticate,
    requireArea('Repository', 'view'),
    async (ctx) => {
      prepareGithubRead();
      const repo = visibleRepo(ctx.principal!, ctx.params.repoId, included);
      const pr = pulls.get(`${repo.id}#${Number(ctx.params.number)}`);
      if (!pr || !included(pr)) throw new HttpError(404, 'not_found', 'Not found');
      return pullDetail(pr);
    },
  );

  r.add(
    'POST',
    '/api/pulls/:repoId/:number/review',
    {
      summary: 'Review a pull request (proxied to GitHub when configured; no self-approval)',
      tag: 'pulls',
      responses: [401, 403, 404, 409, 422, 429, 502, 503],
    },
    authenticate,
    requireArea('Repository', 'contribute'),
    async (ctx) => {
      const body = parse(reviewBody, ctx.body);
      prepareGithubRead();
      const p = ctx.principal!;
      const repo = visibleRepo(p, ctx.params.repoId, included);
      const pr = pulls.get(`${repo.id}#${Number(ctx.params.number)}`);
      if (!pr || !included(pr)) throw new HttpError(404, 'not_found', 'Not found');
      if (pr.state !== 'open') throw new HttpError(409, 'not_open', `Pull request is ${pr.state}`);
      const isAuthor =
        pr.author === p.memberId ||
        (!!pr.authorLogin && memberForLogin(pr.authorLogin) === p.memberId) ||
        (!!pr.authorLogin && loginsOf(p.memberId).includes(pr.authorLogin.toLowerCase()));
      if (isAuthor && body.decision !== 'comment')
        throw new HttpError(
          403,
          'self_approval',
          'You can’t approve or request changes on your own pull request',
        );
      if (
        (body.decision === 'request-changes' || body.decision === 'comment') &&
        !body.body?.trim()
      )
        throw new HttpError(422, 'validation_failed', 'body is required for this decision');

      const mode = githubMode();
      let proxied = false;
      if (pr.source === 'github' && (mode === 'app' || mode === 'token')) {
        await githubRequest('POST', `/repos/${repo.name}/pulls/${pr.number}/reviews`, {
          auth: { kind: 'auto', installationId: repo.installationId },
          body: {
            event: ghEvent[body.decision],
            body: body.body
              ? `${body.body}\n\n— via DevHQ on behalf of ${p.memberId}`
              : `Approved via DevHQ on behalf of ${p.memberId}`,
            commit_id: pr.headSha || undefined,
          },
        });
        proxied = true;
      }
      const at = new Date().toISOString();
      pr.reviews.push({ by: p.memberId, state: localState[body.decision], at, body: body.body });
      if (!pr.reviewers.includes(p.memberId)) pr.reviewers.push(p.memberId);
      pr.review = deriveReview(pr);
      pr.updatedAt = at;
      pulls.save(pr.id);
      audit.append({
        actor: p.memberId,
        action: `pr.${body.decision === 'approve' ? 'approved' : body.decision === 'request-changes' ? 'changes_requested' : 'commented'}`,
        target: `${repo.name}#${pr.number}${proxied ? ' (GitHub)' : pr.source === 'demo' ? ' (demo)' : ''}`,
        requestId: ctx.requestId,
      });
      publish('pull_request', { id: pr.id, review: pr.review, product: pr.product });
      return { ...(await pullDetail(pr)), proxied };
    },
  );
}
