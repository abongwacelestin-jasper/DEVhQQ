/**
 * Personal access tokens (PATs) for CLIs, scripts and CI.
 *
 *   GET    /api/tokens       your tokens (never the secret)
 *   POST   /api/tokens       create — interactive session + step-up; secret shown once
 *   DELETE /api/tokens/:id   revoke yours (Administration:admin may revoke anyone's)
 *
 * Managing tokens needs an interactive session: a token can never mint,
 * list or revoke tokens. See security/pats.ts for format, storage and scope
 * semantics.
 */

import type { Router } from '../lib/http.ts';
import { parse, v } from '../lib/validate.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { can, requireSession, requireStepUp } from '../auth/rbac.ts';
import {
  PAT_MAX_ACTIVE_PER_MEMBER,
  PAT_MAX_DAYS,
  PAT_PREFIX,
  PAT_SCOPES,
  activeTokenCount,
  assertScopesWithinRole,
  issueToken,
  personalAccessTokens,
  publicToken,
  revokeToken,
} from '../security/pats.ts';
import { audit } from '../audit/auditLog.ts';
import { db } from '../store/db.ts';
import { HttpError } from '../types.ts';

const createBody = v.object({
  name: v.string({ min: 1, max: 60 }),
  scopes: v.array(v.enumOf(PAT_SCOPES), { max: PAT_SCOPES.length }),
  expiresInDays: v.int({ min: 1, max: PAT_MAX_DAYS }),
});

export function registerTokenRoutes(r: Router) {
  r.add(
    'GET',
    '/api/tokens',
    { summary: 'Your personal access tokens (secrets are never returned)', tag: 'tokens' },
    authenticate,
    requireSession,
    (ctx) => {
      const me = ctx.principal!.memberId;
      return {
        items: [...personalAccessTokens.values()]
          .filter((t) => t.memberId === me)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(publicToken),
        scopes: PAT_SCOPES,
        maxDays: PAT_MAX_DAYS,
      };
    },
  );

  r.add(
    'POST',
    '/api/tokens',
    {
      summary: 'Create a scoped personal access token (step-up; shown once)',
      tag: 'tokens',
      responses: [401, 403, 409, 422, 429],
    },
    authenticate,
    requireSession,
    requireStepUp(),
    (ctx) => {
      const body = parse(createBody, ctx.body);
      if (!body.scopes.length)
        throw new HttpError(422, 'validation_failed', 'scopes must name at least one scope');
      const p = ctx.principal!;
      const member = db.members.get(p.memberId)!;
      assertScopesWithinRole(body.scopes, member.role);
      if (activeTokenCount(member.id) >= PAT_MAX_ACTIVE_PER_MEMBER)
        throw new HttpError(
          409,
          'token_limit',
          `At most ${PAT_MAX_ACTIVE_PER_MEMBER} active tokens — revoke one first`,
        );
      const { record, token } = issueToken({
        memberId: member.id,
        name: body.name,
        scopes: body.scopes,
        expiresInDays: body.expiresInDays,
      });
      audit.append({
        actor: member.id,
        action: 'token.created',
        target: `${PAT_PREFIX}${record.id} (${record.name}) · ${record.scopes.join(' ')} · expires ${record.expiresAt}`,
        sensitive: true,
        requestId: ctx.requestId,
      });
      ctx.status = 201;
      return { ...publicToken(record), token };
    },
  );

  r.add(
    'DELETE',
    '/api/tokens/:id',
    { summary: 'Revoke a personal access token', tag: 'tokens', responses: [401, 403, 404] },
    authenticate,
    requireSession,
    (ctx) => {
      const p = ctx.principal!;
      const t = personalAccessTokens.get(ctx.params.id);
      const mayRevoke = !!t && (t.memberId === p.memberId || can(p, 'Administration', 'admin'));
      // Other members' tokens are 404, not 403, so ids can't be probed.
      if (!t || !mayRevoke) throw new HttpError(404, 'not_found', 'Token not found');
      revokeToken(
        t,
        p.memberId,
        t.memberId === p.memberId ? 'revoked_by_owner' : 'revoked_by_admin',
        ctx.requestId,
      );
    },
  );
}
