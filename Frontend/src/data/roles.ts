import type { ProductId } from '../types/portfolio';

export type RoleKey = 'admin' | 'pm' | 'developer' | 'designer' | 'tester' | 'operations';

export type Area =
  | 'overview'
  | 'my-work'
  | 'inbox'
  | 'projects'
  | 'tasks'
  | 'assignments'
  | 'activity'
  | 'products'
  | 'messages'
  | 'docs'
  | 'code'
  | 'repositories'
  | 'pull-requests'
  | 'code-security'
  | 'dev-tools'
  | 'deployments'
  | 'incidents'
  | 'monitors'
  | 'test-queue'
  | 'team'
  | 'security'
  | 'integrations'
  | 'audit'
  | 'workspaces'
  | 'sessions'
  | 'settings';

export type Action =
  | 'task:create'
  | 'task:assign'
  | 'time:log'
  | 'bug:report'
  | 'incident:declare'
  | 'member:invite'
  | 'deploy:approve'
  | 'workspace:create'
  | 'workspace:delete'
  | 'channel:create'
  | 'channel:moderate'
  | 'doc:create'
  | 'doc:publish'
  | 'code:commit'
  | 'security:dismiss'
  | 'session:revoke'
  | 'github:configure';

export interface DemoRole {
  key: RoleKey;
  label: string;
  memberId: string;
  home: string;
  homeLabel: string;
  summary: string;
  areas: Area[];
  actions: Action[];
  /** Bottom-bar tabs in priority order. Phones show the first 3, tablets up to 6 (plus New and More = 8). */
  bottomTabs: string[];
  needsOnboarding: boolean;
}

const allAreas: Area[] = [
  'overview',
  'my-work',
  'inbox',
  'projects',
  'tasks',
  'assignments',
  'activity',
  'products',
  'messages',
  'docs',
  'code',
  'repositories',
  'pull-requests',
  'code-security',
  'dev-tools',
  'deployments',
  'incidents',
  'monitors',
  'test-queue',
  'team',
  'security',
  'integrations',
  'audit',
  'workspaces',
  'sessions',
  'settings',
];

/** Every role can talk, read docs, see their own sessions and manage their own settings. */
const common: Area[] = ['inbox', 'messages', 'docs', 'sessions', 'settings'];

export const demoRoles: DemoRole[] = [
  {
    key: 'admin',
    label: 'Admin',
    memberId: 'm1',
    home: '/',
    homeLabel: 'Overview',
    summary: 'Full workspace control — every module, security, integrations and audit.',
    areas: allAreas,
    actions: [
      'task:create',
      'task:assign',
      'time:log',
      'bug:report',
      'incident:declare',
      'member:invite',
      'deploy:approve',
      'workspace:create',
      'workspace:delete',
      'channel:create',
      'channel:moderate',
      'doc:create',
      'doc:publish',
      'code:commit',
      'security:dismiss',
      'session:revoke',
      'github:configure',
    ],

    bottomTabs: ['/', '/my-work', '/messages', '/projects', '/incidents', '/docs'],
    needsOnboarding: false,
  },
  {
    key: 'pm',
    label: 'Project manager',
    memberId: 'm2',
    home: '/',
    homeLabel: 'Portfolio delivery',
    summary: 'Plans, assigns and documents work across products. Deployments are read-only.',
    areas: [
      'overview',
      'my-work',
      'projects',
      'tasks',
      'assignments',
      'activity',
      'products',
      'deployments',
      'team',
      ...common,
    ],
    actions: [
      'task:create',
      'task:assign',
      'time:log',
      'bug:report',
      'channel:create',
      'doc:create',
      'doc:publish',
    ],
    bottomTabs: ['/', '/assignments', '/messages', '/projects', '/docs', '/activity'],
    needsOnboarding: true,
  },
  {
    key: 'developer',
    label: 'Developer',
    memberId: 'm4',
    home: '/my-work',
    homeLabel: 'My work',
    summary: 'Tasks, in-browser code, repositories, reviews, security checks and IDE links.',
    areas: [
      'my-work',
      'projects',
      'tasks',
      'activity',
      'code',
      'repositories',
      'pull-requests',
      'code-security',
      'dev-tools',
      'deployments',
      ...common,
    ],
    actions: [
      'task:create',
      'time:log',
      'bug:report',
      'doc:create',
      'code:commit',
      'channel:create',
    ],
    bottomTabs: [
      '/my-work',
      '/code',
      '/messages',
      '/pull-requests',
      '/repositories',
      '/code-security',
    ],
    needsOnboarding: true,
  },
  {
    key: 'designer',
    label: 'Designer',
    memberId: 'm9',
    home: '/my-work',
    homeLabel: 'My work',
    summary: 'Design tasks, project docs and handoffs.',
    areas: ['my-work', 'projects', 'tasks', 'activity', ...common],
    actions: ['task:create', 'time:log', 'doc:create'],
    bottomTabs: ['/my-work', '/projects', '/messages', '/docs', '/activity'],
    needsOnboarding: true,
  },
  {
    key: 'tester',
    label: 'Tester',
    memberId: 'm10',
    home: '/test-queue',
    homeLabel: 'Test queue',
    summary: 'Work waiting for testing, bugs, PR checks and staging.',
    areas: [
      'test-queue',
      'my-work',
      'projects',
      'tasks',
      'pull-requests',
      'deployments',
      ...common,
    ],
    actions: ['bug:report', 'time:log', 'doc:create'],
    bottomTabs: ['/test-queue', '/my-work', '/messages', '/pull-requests', '/docs'],
    needsOnboarding: true,
  },
  {
    key: 'operations',
    label: 'Operations',
    memberId: 'm11',
    home: '/incidents',
    homeLabel: 'Operations',
    summary: 'Incidents, monitors, deploy approvals and production access.',
    areas: ['incidents', 'monitors', 'deployments', 'my-work', 'tasks', 'security', ...common],
    actions: [
      'incident:declare',
      'deploy:approve',
      'time:log',
      'channel:create',
      'doc:create',
      'doc:publish',
    ],
    bottomTabs: ['/incidents', '/monitors', '/messages', '/deployments', '/docs'],
    needsOnboarding: true,
  },
];

export function roleByKey(key: RoleKey) {
  return demoRoles.find((r) => r.key === key) ?? demoRoles[0];
}

/** Maps the server's role name (Member.role) to the demo role that presents it. */
export function roleKeyFor(roleName: string): RoleKey {
  const map: Record<string, RoleKey> = {
    Owner: 'admin',
    'Project manager': 'pm',
    Developer: 'developer',
    Designer: 'designer',
    Tester: 'tester',
    Operations: 'operations',
  };
  return map[roleName] ?? 'developer';
}

/** Maps a URL path to the area that guards it. */
export function areaForPath(pathname: string): Area {
  const seg = pathname.split('/')[1] ?? '';
  if (seg === '') return 'overview';
  return (allAreas as string[]).includes(seg) ? (seg as Area) : 'overview';
}

export type { ProductId };
