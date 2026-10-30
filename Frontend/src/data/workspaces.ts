import type { ModuleKey, Workspace, WorkspaceTemplate } from '../types/workspace';

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
    label: 'Ask DevHQ',
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

export const workspaces: Workspace[] = [
  {
    id: 'ws1',
    name: 'Tech Organization',
    slug: 'techorg',
    color: '#4F46E5',
    members: 12,
    products: 3,
    template: 'product',
    modules: ['projects', 'engineering', 'delivery', 'operations', 'assistant'],
    role: 'Owner',
    mfaRequired: true,
  },
  {
    id: 'ws2',
    name: 'Northwind Labs',
    slug: 'northwind',
    color: '#0E7490',
    members: 28,
    products: 7,
    template: 'agency',
    modules: ['projects', 'engineering', 'delivery'],
    role: 'Project manager',
    mfaRequired: true,
  },
  {
    id: 'ws3',
    name: 'Kestrel Health',
    slug: 'kestrel',
    color: '#B45309',
    members: 41,
    products: 4,
    template: 'regulated',
    modules: ['projects', 'engineering', 'delivery', 'operations', 'automation', 'assistant'],
    role: 'Developer',
    mfaRequired: true,
  },
];
