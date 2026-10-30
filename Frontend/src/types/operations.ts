import type { ProductId } from './portfolio';

export type DeployStatus = 'succeeded' | 'failed' | 'awaiting-approval' | 'running' | 'rolled-back';
export type EnvName = 'development' | 'staging' | 'production' | 'preview';
export type LaneStatus = 'healthy' | 'failed' | 'pending' | 'degraded';

export interface Deployment {
  id: string;
  product: ProductId;
  env: EnvName;
  sha: string;
  message: string;
  author: string;
  provider: string;
  status: DeployStatus;
  ago: string;
  duration: string;
  failedStep?: string;
}

export interface EnvironmentLane {
  product: ProductId;
  env: EnvName;
  sha: string;
  version: string;
  status: LaneStatus;
  ago: string;
  url: string;
  provider: string;
}

export interface IncidentEvent {
  time: string;
  title: string;
  detail: string;
  kind: 'alert' | 'system' | 'link' | 'note' | 'action';
}

export interface Incident {
  id: string;
  product: ProductId;
  title: string;
  severity: 'SEV1' | 'SEV2' | 'SEV3';
  status: 'investigating' | 'monitoring' | 'resolved';
  owner: string;
  started: string;
  duration: string;
  service: string;
  impact: string;
  correlatedDeploy?: string;
  events: IncidentEvent[];
  nextSteps: string[];
}

export type UptimeTick = 'up' | 'degraded' | 'down';

export interface Monitor {
  id: string;
  product: ProductId;
  name: string;
  target: string;
  kind: 'HTTP' | 'API' | 'Cron';
  status: UptimeTick;
  responseMs: number;
  uptime: number;
  ticks: UptimeTick[];
  latency: number[];
}

export interface Server {
  name: string;
  provider: string;
  region: string;
  products: ProductId[];
  cpu?: number;
  memory?: number;
  disk?: number;
}
