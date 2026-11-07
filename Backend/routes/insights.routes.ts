/**
 * ML insights — task ETA / overdue risk, deployment risk, sign-in anomaly.
 *
 * Authorization happens here, before any data is sent to the ML service:
 * the same product scoping and RBAC as the underlying resource, and
 * out-of-scope ids are 404 (never 403). Only derived features leave the
 * backend (integrations/ml/features.ts).
 *
 * Every answer says where it came from: `source: 'model'` (a verified,
 * promoted model — `model.trainedOn` says whether it learned from real
 * history or the synthetic cold-start set) or `source: 'heuristic'` (the
 * service is unconfigured, down, slow, or has no model), with `fallbackReason`.
 */

import type { Ctx, Middleware, Router } from '../lib/http.ts';
import { parse, v } from '../lib/validate.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { can, canSeeProduct, requireArea, requireStepUp } from '../auth/rbac.ts';
import { audit } from '../audit/auditLog.ts';
import { db } from '../store/db.ts';
import { HttpError } from '../types.ts';
import {
  circuitState,
  mlCall,
  mlConfig,
  MlError,
  PREDICT_TIMEOUT_MS,
  TRAIN_TIMEOUT_MS,
} from '../integrations/ml/client.ts';
import { verifySignature } from '../integrations/ml/signing.ts';
import {
  buildExport,
  deployFeatures,
  signinFeatures,
  taskFeatures,
} from '../integrations/ml/features.ts';
import { deployHeuristic, signinHeuristic, taskHeuristic } from '../integrations/ml/heuristics.ts';
import {
  parseDeployRisk,
  parseEta,
  parseOverdue,
  parseSignin,
  parseTrain,
} from '../integrations/ml/responses.ts';

const MODELS = ['task-eta', 'overdue', 'deploy-risk', 'signin-anomaly'] as const;
const trainBody = v.object({ source: v.enumOf(['backend', 'synthetic'] as const) });

function fallbackReason(err: unknown): string {
  if (err instanceof MlError) return err.code ?? err.kind;
  return 'error';
}

const DAY = 86_400_000;
const addDays = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

/**
 * Export guard: a request signed with ML_SERVICE_TOKEN (the training job), or
 * a fully authenticated Administration:admin member. Nothing else.
 */
const serviceOrAdmin: Middleware = async (ctx, next) => {
  const sig = ctx.req.headers['x-devhq-signature'];
  if (typeof sig === 'string') {
    const cfg = mlConfig();
    if (!cfg) throw new HttpError(401, 'unauthenticated', 'Service token not configured');
    const err = verifySignature(
      cfg.token,
      {
        signature: sig,
        timestamp: String(ctx.req.headers['x-devhq-timestamp'] ?? ''),
        nonce: String(ctx.req.headers['x-devhq-nonce'] ?? ''),
      },
      ctx.req.method ?? 'GET',
      ctx.req.url ?? '',
      '',
    );
    if (err) throw new HttpError(401, err, 'Invalid service signature');
    return next();
  }
  return authenticate(ctx, () => requireArea('Administration', 'admin')(ctx, next));
};

const actorOf = (ctx: Ctx) => ctx.principal?.memberId ?? 'ml-service';

export function registerInsightsRoutes(r: Router) {
  r.add(
    'GET',
    '/api/insights/tasks/:key',
    {
      summary: 'Task ETA interval and overdue risk (model or heuristic)',
      tag: 'insights',
      responses: [401, 403, 404],
    },
    authenticate,
    requireArea('Project', 'view'),
    async (ctx) => {
      const t = db.tasks.get(ctx.params.key.toUpperCase());
      if (!t || !canSeeProduct(ctx.principal!, t.product))
        throw new HttpError(404, 'not_found', 'Not found');
      const f = taskFeatures(t);
      if (t.status !== 'done') {
        try {
          const [eta, overdue] = await Promise.all([
            mlCall('POST', '/v1/predict/task-eta', f, PREDICT_TIMEOUT_MS).then(parseEta),
            mlCall('POST', '/v1/predict/overdue', f, PREDICT_TIMEOUT_MS).then(parseOverdue),
          ]);
          return {
            key: t.key,
            source: 'model' as const,
            eta: { ...eta.eta, date: addDays(eta.eta.p50) },
            overdue: { probability: overdue.probability, drivers: overdue.drivers },
            models: [eta.model, overdue.model],
          };
        } catch (err) {
          const h = taskHeuristic(f);
          return {
            key: t.key,
            source: 'heuristic' as const,
            fallbackReason: fallbackReason(err),
            eta: { ...h.eta, date: addDays(h.eta.p50) },
            overdue: h.overdue,
          };
        }
      }
      const h = taskHeuristic(f);
      return {
        key: t.key,
        source: 'heuristic' as const,
        fallbackReason: 'task_done',
        eta: h.eta,
        overdue: h.overdue,
      };
    },
  );

  r.add(
    'GET',
    '/api/insights/deployments/:id',
    {
      summary: 'Deployment failure risk (model or heuristic)',
      tag: 'insights',
      responses: [401, 403, 404],
    },
    authenticate,
    requireArea('Deployment', 'view'),
    async (ctx) => {
      const d = db.deployments.get(ctx.params.id);
      if (!d || !canSeeProduct(ctx.principal!, d.product))
        throw new HttpError(404, 'not_found', 'Not found');
      const f = deployFeatures(d);
      try {
        const risk = parseDeployRisk(
          await mlCall('POST', '/v1/predict/deploy-risk', f, PREDICT_TIMEOUT_MS),
        );
        return { id: d.id, source: 'model' as const, ...risk };
      } catch (err) {
        return {
          id: d.id,
          source: 'heuristic' as const,
          fallbackReason: fallbackReason(err),
          ...deployHeuristic(f),
        };
      }
    },
  );

  r.add(
    'GET',
    '/api/insights/signins/:id',
    {
      summary: 'Sign-in anomaly score and reasons (own sign-ins, or all with Administration:view)',
      tag: 'insights',
      responses: [401, 404],
    },
    authenticate,
    async (ctx) => {
      const p = ctx.principal!;
      const s = db.signIns.find((x) => x.id === ctx.params.id);
      if (!s || (s.memberId !== p.memberId && !can(p, 'Administration', 'view')))
        throw new HttpError(404, 'not_found', 'Not found');
      const rule = signinHeuristic(s);
      try {
        const scored = parseSignin(
          await mlCall('POST', '/v1/score/signin-anomaly', signinFeatures(s), PREDICT_TIMEOUT_MS),
        );
        // The rule-based score is what actually gated the sign-in; show both.
        return { id: s.id, source: 'model' as const, ...scored, rule };
      } catch (err) {
        return {
          id: s.id,
          source: 'heuristic' as const,
          fallbackReason: fallbackReason(err),
          ...rule,
          rule,
        };
      }
    },
  );

  r.add(
    'GET',
    '/api/insights/status',
    { summary: 'ML service status: configured, circuit, served models', tag: 'insights' },
    authenticate,
    requireArea('Administration', 'view'),
    async () => {
      if (!mlConfig()) return { configured: false, circuit: circuitState() };
      try {
        return {
          configured: true,
          circuit: circuitState(),
          service: await mlCall('GET', '/v1/models', undefined, PREDICT_TIMEOUT_MS),
        };
      } catch (err) {
        return { configured: true, circuit: circuitState(), error: fallbackReason(err) };
      }
    },
  );

  r.add(
    'GET',
    '/api/insights/_export',
    {
      summary: 'Feature export for model training (service signature or Administration:admin)',
      tag: 'insights',
      auth: 'session',
      responses: [401, 403],
    },
    serviceOrAdmin,
    (ctx) => {
      const out = buildExport();
      audit.append({
        actor: actorOf(ctx),
        action: 'ml.export',
        target: `tasks=${out.tasks.length} deployments=${out.deployments.length} signins=${out.signins.length}`,
        sensitive: true,
        requestId: ctx.requestId,
      });
      return out;
    },
  );

  r.add(
    'POST',
    '/api/insights/train/:model',
    {
      summary: 'Train a model on the live export or synthetic data (Administration:admin, step-up)',
      tag: 'insights',
      responses: [401, 403, 404, 422, 503],
    },
    authenticate,
    requireArea('Administration', 'admin'),
    requireStepUp(),
    async (ctx) => {
      const model = ctx.params.model;
      if (!(MODELS as readonly string[]).includes(model))
        throw new HttpError(404, 'not_found', 'Unknown model');
      const body = parse(trainBody, ctx.body);
      if (!mlConfig())
        throw new HttpError(503, 'integration_unconfigured', 'ML service is not configured');
      const actor = ctx.principal!.memberId;
      audit.append({
        actor,
        action: 'ml.train.requested',
        target: `${model} · source=${body.source}`,
        sensitive: true,
        requestId: ctx.requestId,
      });
      const payload =
        body.source === 'backend'
          ? { source: 'inline', dataset: buildExport() }
          : { source: 'synthetic' };
      try {
        const result = parseTrain(
          await mlCall('POST', `/v1/train/${model}`, payload, TRAIN_TIMEOUT_MS),
        );
        audit.append({
          actor,
          action: result.promoted ? 'ml.train.promoted' : 'ml.train.rejected',
          target: `${model} ${result.version} · ${result.trainedOn}${result.reasons.length ? ` · ${result.reasons.join('; ')}` : ''}`,
          sensitive: true,
          requestId: ctx.requestId,
        });
        return result;
      } catch (err) {
        audit.append({
          actor,
          action: 'ml.train.failed',
          target: `${model} · ${fallbackReason(err)}`,
          sensitive: true,
          requestId: ctx.requestId,
        });
        if (err instanceof MlError && err.kind === 'rejected' && err.status === 409)
          throw new HttpError(409, 'training_in_progress', 'Another training run is in progress');
        throw new HttpError(503, 'ml_unavailable', 'The ML service could not complete training');
      }
    },
  );
}
