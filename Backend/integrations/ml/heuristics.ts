/**
 * Rule-based fallbacks, used whenever the ML service is unconfigured, down,
 * slow, or has no verified model loaded. Responses built from these carry
 * `source: 'heuristic'` so the UI never presents a rule of thumb as a model.
 *
 * The ETA rule is identical to `heuristic_eta_days` in
 * Models/devhq_models/training/pipeline.py — the ETA model must beat it by
 * 10% on held-out data before it can be promoted.
 */

import { riskDecision } from '../../lib/geo.ts';
import type { SignInRecord } from '../../types.ts';
import type { DeployFeatures, TaskFeatures } from './features.ts';

const remainingShare: Record<TaskFeatures['status'], number> = {
  backlog: 1,
  'in-progress': 0.6,
  review: 0.2,
  done: 0,
};

export function heuristicEtaDays(f: TaskFeatures): number {
  return Math.max(0.5, (f.estimate / 6) * remainingShare[f.status] + (f.blocked ? 2 : 0));
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function taskHeuristic(f: TaskFeatures) {
  if (f.status === 'done')
    return {
      eta: { p10: 0, p50: 0, p90: 0 },
      overdue: { probability: 0, drivers: [] as string[] },
    };
  const p50 = heuristicEtaDays(f);
  const p90 = p50 * 1.8;
  const drivers: string[] = [];
  if (f.blocked) drivers.push('Blocked by another open task');
  if (f.daysToDue < 0) drivers.push(`Already ${Math.round(-f.daysToDue)} days past due`);
  else if (f.daysToDue < p50) drivers.push(`Due in ${Math.round(f.daysToDue)} days`);
  const probability =
    f.daysToDue < 0 ? 0.95 : f.daysToDue < p50 ? 0.7 : f.daysToDue < p90 ? 0.4 : 0.1;
  return {
    eta: { p10: r1(p50 * 0.6), p50: r1(p50), p90: r1(p90) },
    overdue: { probability, drivers },
  };
}

export function deployHeuristic(f: DeployFeatures) {
  const drivers: string[] = [];
  let score = 5;
  if (f.env === 'production') {
    score += 15;
    drivers.push('Production environment');
  }
  if (f.hourUtc < 7 || f.hourUtc >= 19) {
    score += 15;
    drivers.push(`Off-hours change (${String(f.hourUtc).padStart(2, '0')}:00 UTC)`);
  }
  if (f.weekday >= 5) {
    score += 10;
    drivers.push('Weekend change');
  }
  if (f.openIncidents > 0) {
    score += 10 * Math.min(f.openIncidents, 2);
    drivers.push(`${f.openIncidents} open incident(s) on this product`);
  }
  score += Math.round(30 * f.requesterFailureRate + 30 * f.productFailureRate30d);
  score = Math.min(95, score);
  const probability = score / 100;
  return {
    probability,
    score,
    level:
      probability >= 0.35
        ? ('high' as const)
        : probability >= 0.15
          ? ('medium' as const)
          : ('low' as const),
    drivers,
  };
}

/** The rule-based score recorded at sign-in time by lib/geo.ts assessRisk. */
export function signinHeuristic(s: SignInRecord) {
  return { score: s.risk.score, reasons: s.risk.reasons, decision: riskDecision(s.risk.score) };
}
