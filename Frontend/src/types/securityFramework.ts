export type PillarId =
  'identity' | 'waap' | 'zero-trust' | 'supply-chain' | 'crypto' | 'resilience';
export type ControlStatus = 'enforced' | 'partial' | 'planned';

export interface SecurityControl {
  id: string;
  title: string;
  detail: string;
  status: ControlStatus;
  /** Where the control is implemented — a frontend surface or a backend module. */
  evidence: string;
  to?: string;
  action?: 'register-passkey';
}

export interface SecurityPillar {
  id: PillarId;
  name: string;
  summary: string;
  controls: SecurityControl[];
}

export interface StoredPasskey {
  id: string;
  label: string;
  createdAt: string;
  publicKey?: string;
  algorithm?: number;
}
