import type { ProductId } from './portfolio';

export type RoleName =
  'Owner' | 'Project manager' | 'Developer' | 'Designer' | 'Tester' | 'Operations';
export type PermissionLevel = 'admin' | 'manage' | 'contribute' | 'view' | 'none';
export type PermissionArea =
  | 'Organization'
  | 'Product'
  | 'Project'
  | 'Repository'
  | 'Deployment'
  | 'Infrastructure'
  | 'Administration';

export interface Member {
  id: string;
  name: string;
  initials: string;
  email: string;
  role: RoleName;
  products: ProductId[];
  productionAccess: boolean;
  mfa: boolean;
  status: 'active' | 'invited' | 'deactivated';
  lastActive: string;
  openTasks: number;
  capacity: number;
  color: string;
}

export interface AuditEvent {
  id: string;
  when: string;
  actor: string;
  action: string;
  target: string;
  area: PermissionArea;
  sensitive?: boolean;
}

export interface Integration {
  id: string;
  name: string;
  category:
    'Source control' | 'Deployment' | 'Monitoring' | 'Identity' | 'Storage' | 'Notifications';
  status: 'connected' | 'degraded' | 'not-connected' | 'planned';
  detail: string;
  lastSync: string;
  authority: string;
  syncs: string[];
}
