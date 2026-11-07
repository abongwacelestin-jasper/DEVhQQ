import type { DeploymentRow } from '../../hooks/useDeployments';
import type { Incident } from '../../types/operations';
import type { Health, ProductId } from '../../types/portfolio';
import type { ApiMonitor } from '../engineering/data/types';

/**
 * Product health derived from live records instead of the portfolio seed:
 * - degraded: an open SEV1/SEV2, or a monitor reporting down
 * - at-risk: any other open incident, a failed latest deploy, overdue work, or a degraded monitor
 * - healthy: none of the above
 * Each reason names the record it came from.
 */
export function deriveHealth(input: {
  product: ProductId;
  incidents: Incident[];
  deployments: DeploymentRow[];
  monitors: ApiMonitor[];
  overdueTasks: number;
}): { health: Health; reasons: string[] } {
  const { product, incidents, deployments, monitors, overdueTasks } = input;
  const reasons: string[] = [];
  let degraded = false;
  let atRisk = false;

  const open = incidents.filter((i) => i.product === product && i.status !== 'resolved');
  for (const i of open) {
    reasons.push(`${i.id} ${i.severity} open: ${i.title}`);
    if (i.severity !== 'SEV3') degraded = true;
    else atRisk = true;
  }

  for (const env of ['production', 'staging'] as const) {
    const latest = deployments
      .filter((d) => d.product === product && d.env === env)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (latest && (latest.status === 'failed' || latest.status === 'rolled-back')) {
      reasons.push(`Latest ${env} deploy ${latest.sha} ${latest.status}`);
      atRisk = true;
    }
  }

  for (const m of monitors.filter((x) => x.product === product)) {
    if (m.status === 'down') {
      reasons.push(`Monitor ${m.name} is down`);
      degraded = true;
    } else if (m.status === 'degraded') {
      reasons.push(`Monitor ${m.name} is degraded`);
      atRisk = true;
    }
  }

  if (overdueTasks > 0) {
    reasons.push(`${overdueTasks} overdue task${overdueTasks > 1 ? 's' : ''}`);
    atRisk = true;
  }

  if (!reasons.length) reasons.push('No open incidents, failed deploys or overdue tasks');
  return { health: degraded ? 'degraded' : atRisk ? 'at-risk' : 'healthy', reasons };
}

/** Mean server-reported uptime across a product's monitors, or null without data. */
export function productUptime(monitors: ApiMonitor[], product: ProductId): number | null {
  const values = monitors
    .filter((m) => m.product === product && typeof m.uptimePct === 'number')
    .map((m) => m.uptimePct as number);
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}
