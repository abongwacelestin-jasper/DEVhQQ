/**
 * Workspace assistant — grounded answers over records the caller can read.
 *
 * The backend is the only thing that decides what the assistant may see:
 * it gathers docs, tasks, incidents and (with Deployment:view) deployments
 * using the same read rules as their own routes, caps the context, strips
 * prompt-delimiter tricks (sanitizeForPrompt), and only then sends it to the
 * ML service, which never fetches data itself. Answers cite source ids; a
 * source the service returns that was not sent is dropped here too.
 *
 * Rate-limited per member (not per session, so new sessions don't reset it).
 * Audited per question with its length and outcome — never its content.
 */

import type { Middleware, Router } from '../lib/http.ts';
import { parse, sanitizeForPrompt, v } from '../lib/validate.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { can, canSeeProduct, requireArea } from '../auth/rbac.ts';
import { audit } from '../audit/auditLog.ts';
import { db } from '../store/db.ts';
import { HttpError, type Principal, type ProjectDoc } from '../types.ts';
import { ASSISTANT_TIMEOUT_MS, mlCall, mlConfig, MlError } from '../integrations/ml/client.ts';
import { parseAssistant } from '../integrations/ml/responses.ts';

const products = ['renewberry', 'blog', 'mirror'] as const;
const askBody = v.object({
  question: v.string({ min: 1, max: 2000 }),
  scope: v.optional(
    v.object({
      product: v.optional(v.enumOf(products)),
      projectId: v.optional(v.string({ max: 40 })),
    }),
  ),
});

export const CONTEXT_LIMITS = { items: 120, itemChars: 4_000, totalChars: 150_000 };

// ── Per-member token bucket ────────────────────────────────────
const RATE = { capacity: 6, refillPerSec: 6 / 60 };
const buckets = new Map<string, { tokens: number; updated: number }>();

const perMemberLimit: Middleware = (ctx, next) => {
  const id = ctx.principal?.memberId;
  if (!id) throw new HttpError(401, 'unauthenticated', 'Sign in required');
  const now = Date.now();
  const b = buckets.get(id) ?? { tokens: RATE.capacity, updated: now };
  b.tokens = Math.min(RATE.capacity, b.tokens + ((now - b.updated) / 1000) * RATE.refillPerSec);
  b.updated = now;
  buckets.set(id, b);
  if (b.tokens < 1) {
    ctx.res.setHeader('Retry-After', String(Math.ceil((1 - b.tokens) / RATE.refillPerSec)));
    throw new HttpError(429, 'rate_limited', 'Too many assistant questions — try again shortly');
  }
  b.tokens -= 1;
  return next();
};

// ── Readability (mirrors routes/docs.routes.ts `readable`) ─────
/** Same rule as GET /api/docs: product scope, and restricted docs only for editors and Owners. */
function docReadable(p: Principal, d: ProjectDoc) {
  return (
    canSeeProduct(p, d.product) &&
    (d.visibility !== 'restricted' || d.editors.includes(p.memberId) || p.role === 'Owner')
  );
}

interface ContextItem {
  id: string;
  kind: 'doc' | 'task' | 'incident' | 'deployment';
  title: string;
  text: string;
  url: string;
  at: string;
}

const memberName = (id: string | undefined) =>
  id ? (db.members.get(id)?.name ?? id) : 'unassigned';

/** Everything this caller may read, newest first, before capping. */
export function gatherContext(
  p: Principal,
  scope: { product?: string; projectId?: string } = {},
): ContextItem[] {
  const inScope = (product: string, projectId?: string) =>
    (!scope.product || product === scope.product) &&
    (!scope.projectId || !projectId || projectId === scope.projectId);
  const items: ContextItem[] = [];

  for (const d of db.docs.values())
    if (docReadable(p, d) && inScope(d.product, d.projectId))
      items.push({
        id: `doc:${d.id}`,
        kind: 'doc',
        title: d.title,
        text: d.body,
        url: `/docs/${d.id}`,
        at: d.updatedAt,
      });

  for (const t of db.tasks.values()) {
    if (!canSeeProduct(p, t.product) || !inScope(t.product, t.projectId)) continue;
    const comments = [...db.taskComments.values()]
      .filter((c) => c.taskKey === t.key)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 3)
      .map((c) => `- ${memberName(c.author)}: ${c.text}`);
    items.push({
      id: `task:${t.key}`,
      kind: 'task',
      title: `${t.key} ${t.title}`,
      text: [
        `Status: ${t.status}. Priority: ${t.priority}. Type: ${t.type}.`,
        `Assignee: ${memberName(t.assignee)}. Reviewer: ${memberName(t.reviewer)}.`,
        `Due: ${t.due}. Estimate: ${t.estimate} h.${t.blockedBy ? ` Blocked by ${t.blockedBy}.` : ''}${t.pr ? ` PR #${t.pr}.` : ''}`,
        t.description ?? '',
        comments.length ? `Recent comments:\n${comments.join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      url: `/tasks/${t.key}`,
      at: t.updatedAt,
    });
  }

  for (const i of db.incidents.values()) {
    if (!canSeeProduct(p, i.product) || !inScope(i.product)) continue;
    items.push({
      id: `incident:${i.id}`,
      kind: 'incident',
      title: `${i.id} ${i.title}`,
      text: [
        `Severity: ${i.severity}. Status: ${i.status}. Service: ${i.service}. Owner: ${memberName(i.owner)}.`,
        `Started: ${i.startedAt}${i.resolvedAt ? `. Resolved: ${i.resolvedAt}` : ''}.`,
        `Impact: ${i.impact}`,
        ...i.timeline.slice(-5).map((e) => `- ${e.at} ${memberName(e.by)}: ${e.note}`),
      ].join('\n'),
      url: `/incidents/${i.id}`,
      at: i.resolvedAt ?? i.startedAt,
    });
  }

  if (can(p, 'Deployment', 'view'))
    for (const d of db.deployments.values()) {
      if (!canSeeProduct(p, d.product) || !inScope(d.product)) continue;
      items.push({
        id: `deployment:${d.id}`,
        kind: 'deployment',
        title: `${d.product} ${d.version} → ${d.env}`,
        text: `Status: ${d.status}. Commit ${d.sha}. Provider: ${d.provider}. Requested by ${memberName(d.requestedBy)}${d.approvedBy ? `, approved by ${memberName(d.approvedBy)}` : ''} at ${d.createdAt}.`,
        url: `/deployments/${d.id}`,
        at: d.createdAt,
      });
    }

  return items.sort((a, b) => b.at.localeCompare(a.at));
}

/** Caps item count, per-item length and total size; strips prompt-delimiter tricks. */
export function capContext(items: ContextItem[]) {
  const out: { id: string; kind: ContextItem['kind']; title: string; text: string; url: string }[] =
    [];
  let total = 0;
  for (const it of items) {
    if (out.length >= CONTEXT_LIMITS.items) break;
    const text = sanitizeForPrompt(it.text, CONTEXT_LIMITS.itemChars);
    if (total + text.length > CONTEXT_LIMITS.totalChars) break;
    total += text.length;
    out.push({
      id: it.id,
      kind: it.kind,
      title: sanitizeForPrompt(it.title, 300),
      text,
      url: it.url,
    });
  }
  return out;
}

export function registerAssistantRoutes(r: Router) {
  r.add(
    'POST',
    '/api/assistant/ask',
    {
      summary: 'Ask the workspace assistant (grounded in records you can read)',
      tag: 'assistant',
      responses: [401, 403, 422, 429, 503],
    },
    authenticate,
    requireArea('Project', 'view'),
    perMemberLimit,
    async (ctx) => {
      const p = ctx.principal!;
      const body = parse(askBody, ctx.body);
      const report = (outcome: string, sources = 0) =>
        audit.append({
          actor: p.memberId,
          action: 'assistant.asked',
          // Length and outcome only — the question itself is never logged.
          target: `chars=${body.question.length} sources=${sources} outcome=${outcome}`,
          requestId: ctx.requestId,
        });

      if (!mlConfig()) {
        report('unconfigured');
        throw new HttpError(
          503,
          'integration_unconfigured',
          'The assistant is not configured on this server',
        );
      }
      const context = capContext(gatherContext(p, body.scope ?? {}));
      const allowed = new Set(context.map((c) => c.id));
      try {
        const res = parseAssistant(
          await mlCall(
            'POST',
            '/v1/assistant/answer',
            { question: sanitizeForPrompt(body.question, 2000), context },
            ASSISTANT_TIMEOUT_MS,
          ),
        );
        const sources = res.sources.filter((s) => allowed.has(s.id));
        report('answered', sources.length);
        return {
          answer: res.answer,
          sources,
          model: res.model,
          grounded: res.grounded && sources.length > 0,
          truncated: res.truncated,
          source: 'model' as const,
        };
      } catch (err) {
        const reason = err instanceof MlError ? (err.code ?? err.kind) : 'error';
        report(`unavailable:${reason}`);
        if (err instanceof MlError && err.status === 503 && err.code === 'integration_unconfigured')
          throw new HttpError(
            503,
            'integration_unconfigured',
            'The assistant has no model key configured',
          );
        throw new HttpError(
          503,
          'assistant_unavailable',
          'The assistant is unavailable right now — try again later',
        );
      }
    },
  );
}
