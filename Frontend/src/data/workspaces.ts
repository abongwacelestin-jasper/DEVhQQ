/**
 * Workspace presentation data only: the module catalogue and creation templates.
 * Workspaces themselves come from `GET /api/workspaces` (WorkspaceContext).
 */
import type { ModuleKey, WorkspaceTemplate } from '../types/workspace';

export const moduleCatalog: {
  key: ModuleKey;
  label: string;
  description: string;
  core?: boolean;
}[] = [
  {
    key: 'projects',
    label: 'Projects & tasks',
    description: 'Boards, assignments, milestones and time tracking',
    core: true,
  },
  {
    key: 'engineering',
    label: 'Code & reviews',
    description: 'Repositories, pull requests and CI linked to tasks',
  },
  {
    key: 'delivery',
    label: 'Deployments',
    description: 'Environments, approvals and release history',
  },
  {
    key: 'operations',
    label: 'Operations',
    description: 'Monitors, incidents and on-call ownership',
  },
  {
    key: 'automation',
    label: 'Automation',
    description: 'Rules that move tasks on code and deploy events',
  },
  {
    key: 'assistant',
    label: 'Ask TavetaHQ',
    description: 'Permission-aware answers with cited sources',
  },
];

export const workspaceTemplates: WorkspaceTemplate[] = [
  {
    id: 'product',
    name: 'Product company',
    description: 'Several in-house products, one shared team.',
    modules: ['projects', 'engineering', 'delivery', 'operations', 'assistant'],
  },
  {
    id: 'agency',
    name: 'Agency / client work',
    description: 'One workspace per client, delivery-focused.',
    modules: ['projects', 'engineering', 'delivery'],
  },
  {
    id: 'regulated',
    name: 'Regulated',
    description: 'Every module, strict approvals and audit export.',
    modules: ['projects', 'engineering', 'delivery', 'operations', 'automation', 'assistant'],
  },
  {
    id: 'startup',
    name: 'Early startup',
    description: 'Just tasks and code to start — add more later.',
    modules: ['projects', 'engineering'],
  },
];
