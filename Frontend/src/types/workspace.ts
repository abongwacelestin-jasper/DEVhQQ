export type ModuleKey =
  'projects' | 'engineering' | 'delivery' | 'operations' | 'automation' | 'assistant';

export interface WorkspaceTemplate {
  id: string;
  name: string;
  description: string;
  modules: ModuleKey[];
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  color: string;
  members: number;
  products: number;
  template: string;
  modules: ModuleKey[];
  role: string;
  mfaRequired: boolean;
  /** Set when an owner schedules deletion; the workspace is removed after the 7-day grace period. */
  pendingDeletionAt?: string;
  ownerId?: string;
}
