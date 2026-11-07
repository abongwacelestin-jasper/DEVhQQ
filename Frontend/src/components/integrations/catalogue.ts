import type React from 'react';
import {
  BellIcon,
  DatabaseIcon,
  GitBranchIcon,
  KeyRoundIcon,
  PlugIcon,
  RadarIcon,
  RocketIcon,
} from 'lucide-react';
import type { ApiIntegrationStatus } from '../engineering/data/types';
import type { Tone } from '../../types/portfolio';

/**
 * Presentation-only catalogue of integration kinds DevHQ knows how to label.
 *
 * It holds names, categories and copy — never connection state. Whether an
 * integration is connected comes only from `GET /api/integrations`; a kind
 * listed here without an API row is shown as "Not connected".
 */

export type IntegrationCategory =
  | 'Source control'
  | 'Deployment'
  | 'Monitoring'
  | 'Identity'
  | 'Storage'
  | 'Notifications'
  | 'Other';

export interface IntegrationKind {
  kind: string;
  name: string;
  category: IntegrationCategory;
  description: string;
  /** Which tool stays authoritative for the data it touches. */
  authority: string;
}

export const integrationKinds: IntegrationKind[] = [
  {
    kind: 'github',
    name: 'GitHub App',
    category: 'Source control',
    description: 'Repositories, pull requests, CI runs and code-scanning findings.',
    authority: 'GitHub stays authoritative for code, reviews and checks; DevHQ mirrors them.',
  },
  {
    kind: 'uptime',
    name: 'Uptime checks',
    category: 'Monitoring',
    description: 'Built-in HTTP monitors that open incidents after repeated failures.',
    authority: 'Built into DevHQ. Source of truth for availability history.',
  },
  {
    kind: 'slack',
    name: 'Slack',
    category: 'Notifications',
    description: 'Incident, deployment and monitor notifications to a channel webhook.',
    authority: 'DevHQ only posts; Slack keeps the conversation.',
  },
  {
    kind: 'pagerduty',
    name: 'PagerDuty',
    category: 'Monitoring',
    description: 'Trigger PagerDuty events for incidents and monitor outages.',
    authority: 'PagerDuty stays authoritative for schedules and escalation.',
  },
  {
    kind: 'webhook',
    name: 'Generic webhook',
    category: 'Other',
    description: 'HMAC-signed JSON to any HTTPS endpoint.',
    authority: 'Receivers verify X-DevHQ-Signature with the signing secret.',
  },
];

export const categoryIcon: Record<
  IntegrationCategory,
  React.ComponentType<{ className?: string }>
> = {
  'Source control': GitBranchIcon,
  Deployment: RocketIcon,
  Monitoring: RadarIcon,
  Identity: KeyRoundIcon,
  Storage: DatabaseIcon,
  Notifications: BellIcon,
  Other: PlugIcon,
};

export const statusMeta: Record<
  ApiIntegrationStatus | 'not-connected',
  { label: string; tone: Tone }
> = {
  connected: { label: 'Connected', tone: 'ok' },
  degraded: { label: 'Degraded', tone: 'warn' },
  error: { label: 'Error', tone: 'bad' },
  disconnected: { label: 'Disconnected', tone: 'neutral' },
  available: { label: 'Not connected', tone: 'neutral' },
  'not-connected': { label: 'Not connected', tone: 'neutral' },
};

export function kindMeta(kind: string, name?: string): IntegrationKind {
  return (
    integrationKinds.find((k) => k.kind === kind) ?? {
      kind,
      name: name ?? kind,
      category: 'Other',
      description: '',
      authority: '',
    }
  );
}

/** Event types an outbound webhook can subscribe to (the API's published event types). */
export const webhookEventTypes = [
  'deployment.approved',
  'deployment.failed',
  'incident.opened',
  'incident.resolved',
  'monitor.down',
  'monitor.up',
] as const;

/** Kinds DevHQ runs itself: shown, never connected or disconnected here. */
export const BUILT_IN_KINDS = new Set(['github', 'uptime']);

/** Client-side courtesy check; the server validates and blocks private targets (SSRF). */
export function validateHttpsUrl(raw: string, { allowHttp = false } = {}): string | null {
  const value = raw.trim();
  if (!value) return 'Enter a URL.';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'That isn’t a valid URL.';
  }
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:'))
    return allowHttp ? 'Use an http:// or https:// URL.' : 'Use an https:// URL.';
  if (url.username || url.password) return 'Don’t put credentials in the URL.';
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^0\./.test(host) ||
    host === '::1' ||
    /^f[cd][0-9a-f]{2}:/.test(host) ||
    /^fe80:/.test(host)
  )
    return 'Private and internal addresses can’t be targeted.';
  return null;
}
