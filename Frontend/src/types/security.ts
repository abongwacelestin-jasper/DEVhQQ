import type { ProductId } from './portfolio';

export interface SecurityPolicy {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  locked?: boolean;
}

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdBy: string;
  created: string;
  lastUsed: string;
  expires: string;
  status: 'active' | 'expiring' | 'revoked';
}

export interface Session {
  id: string;
  member: string;
  device: string;
  location: string;
  ip: string;
  lastSeen: string;
  current?: boolean;
}

export interface SignInEvent {
  id: string;
  member: string;
  when: string;
  method: string;
  location: string;
  result: 'success' | 'blocked' | 'mfa-failed';
}

export interface AccessGrant {
  id: string;
  member: string;
  scope: string;
  reason: string;
  expires: string;
  approvedBy: string;
}

export interface SecurityCheck {
  id: string;
  label: string;
  detail: string;
  status: 'pass' | 'warn' | 'fail';
  to?: string;
}

export interface IntegrationScope {
  key: string;
  label: string;
  description: string;
  granted: boolean;
  required?: boolean;
  write?: boolean;
}

export interface IntegrationSetting {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
}

export interface WebhookDelivery {
  id: string;
  event: string;
  status: number;
  when: string;
  duration: string;
}

export interface IntegrationConfig {
  id: string;
  account: string;
  installedBy: string;
  installed: string;
  scopes: IntegrationScope[];
  settings: IntegrationSetting[];
  mappings: { external: string; product: ProductId }[];
  webhook?: {
    url: string;
    secretHint: string;
    lastRotated: string;
    events: { key: string; enabled: boolean }[];
  };
  deliveries: WebhookDelivery[];
  credential?: { label: string; hint: string; rotated: string };
}
