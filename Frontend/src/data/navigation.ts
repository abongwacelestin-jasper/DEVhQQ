import type React from 'react';
import {
  ActivityIcon,
  BookOpenIcon,
  Building2Icon,
  Code2Icon,
  FlaskConicalIcon,
  FolderKanbanIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  HistoryIcon,
  InboxIcon,
  LayoutGridIcon,
  ListChecksIcon,
  MessagesSquareIcon,
  MonitorSmartphoneIcon,
  PlugIcon,
  RocketIcon,
  ScrollTextIcon,
  SettingsIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  TerminalSquareIcon,
  TriangleAlertIcon,
  UserCheckIcon,
  UsersIcon,
  type LucideProps,
} from 'lucide-react';
import type { Area } from './roles';
import type { ModuleKey } from '../types/workspace';

export interface NavEntry {
  to: string;
  label: string;
  short: string;
  area: Area;
  icon: React.ComponentType<LucideProps>;
  module?: ModuleKey;
  end?: boolean;
  /** Badge count supplied by useNavEntries (e.g. open tasks, incidents). */
  count?: number;
  /** Renders the badge in the alert colour instead of the neutral one. */
  alert?: boolean;
}

export interface NavSection {
  title: string;
  items: NavEntry[];
}

export const navSections: NavSection[] = [
  {
    title: 'Work',
    items: [
      {
        to: '/',
        label: 'Overview',
        short: 'Home',
        area: 'overview',
        icon: LayoutGridIcon,
        end: true,
      },
      {
        to: '/test-queue',
        label: 'Test queue',
        short: 'Testing',
        area: 'test-queue',
        icon: FlaskConicalIcon,
      },
      { to: '/my-work', label: 'My work', short: 'My work', area: 'my-work', icon: ListChecksIcon },
      { to: '/inbox', label: 'Assigned to me', short: 'Inbox', area: 'inbox', icon: InboxIcon },
      {
        to: '/projects',
        label: 'Projects',
        short: 'Projects',
        area: 'projects',
        icon: FolderKanbanIcon,
      },
      {
        to: '/assignments',
        label: 'Assignments',
        short: 'Assign',
        area: 'assignments',
        icon: UserCheckIcon,
      },
      {
        to: '/activity',
        label: 'Work activity',
        short: 'Activity',
        area: 'activity',
        icon: HistoryIcon,
      },
    ],
  },
  {
    title: 'Collaborate',
    items: [
      {
        to: '/messages',
        label: 'Messages',
        short: 'Chat',
        area: 'messages',
        icon: MessagesSquareIcon,
      },
      { to: '/docs', label: 'Docs', short: 'Docs', area: 'docs', icon: BookOpenIcon },
    ],
  },
  {
    title: 'Engineering',
    items: [
      {
        to: '/code',
        label: 'Code workspace',
        short: 'Code',
        area: 'code',
        icon: TerminalSquareIcon,
        module: 'engineering',
      },
      {
        to: '/repositories',
        label: 'Repositories',
        short: 'Repos',
        area: 'repositories',
        icon: GitBranchIcon,
        module: 'engineering',
      },
      {
        to: '/pull-requests',
        label: 'Pull requests',
        short: 'Reviews',
        area: 'pull-requests',
        icon: GitPullRequestIcon,
        module: 'engineering',
      },
      {
        to: '/code-security',
        label: 'Code security',
        short: 'Security',
        area: 'code-security',
        icon: ShieldAlertIcon,
        module: 'engineering',
      },
      {
        to: '/dev-tools',
        label: 'IDE & dev tools',
        short: 'IDE',
        area: 'dev-tools',
        icon: Code2Icon,
        module: 'engineering',
      },
      {
        to: '/deployments',
        label: 'Deployments',
        short: 'Deploys',
        area: 'deployments',
        icon: RocketIcon,
        module: 'delivery',
      },
    ],
  },
  {
    title: 'Operations',
    items: [
      {
        to: '/incidents',
        label: 'Incidents',
        short: 'Incidents',
        area: 'incidents',
        icon: TriangleAlertIcon,
        module: 'operations',
      },
      {
        to: '/monitors',
        label: 'Monitors',
        short: 'Monitors',
        area: 'monitors',
        icon: ActivityIcon,
        module: 'operations',
      },
    ],
  },
  {
    title: 'Admin',
    items: [
      {
        to: '/workspaces',
        label: 'Workspaces',
        short: 'Spaces',
        area: 'workspaces',
        icon: Building2Icon,
      },
      { to: '/team', label: 'Team & roles', short: 'Team', area: 'team', icon: UsersIcon },
      {
        to: '/security',
        label: 'Security',
        short: 'Security',
        area: 'security',
        icon: ShieldCheckIcon,
      },
      {
        to: '/integrations',
        label: 'Integrations',
        short: 'Integrations',
        area: 'integrations',
        icon: PlugIcon,
      },
      { to: '/audit', label: 'Audit log', short: 'Audit', area: 'audit', icon: ScrollTextIcon },
    ],
  },
];

/**
 * Personal pages in the account menu. Every role can reach them (`common`
 * areas in data/roles.ts), so they are not in the sidebar sections.
 */
export const accountEntries: NavEntry[] = [
  { to: '/settings', label: 'Settings', short: 'Settings', area: 'settings', icon: SettingsIcon },
  {
    to: '/sessions',
    label: 'Sessions & devices',
    short: 'Sessions',
    area: 'sessions',
    icon: MonitorSmartphoneIcon,
  },
];

export const allNavEntries = navSections.flatMap((s) => s.items);

export function navEntryFor(path: string) {
  return allNavEntries.find((e) => e.to === path);
}
