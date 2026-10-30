/**
 * Translation between the server's authorization model and the web app's
 * navigation model.
 *
 * The server authorizes against seven areas and five levels. The UI navigates
 * by page area. This module is the only place that knows both vocabularies,
 * so a permission is never "checked" in a page with a hand-written rule.
 */

import type { Action, Area } from '../data/roles';
import type { ApiArea, ApiLevel, Capabilities } from './types';

const RANK: Record<ApiLevel, number> = { none: 0, view: 1, contribute: 2, manage: 3, admin: 4 };

/**
 * Which server area governs each page. `null` means the page is available to
 * any signed-in member (personal surfaces: your own sessions, settings, chat).
 */
export const AREA_TO_SERVER: Record<Area, ApiArea | null> = {
  overview: null,
  'my-work': null,
  inbox: null,
  messages: null,
  sessions: null,
  settings: null,
  projects: 'Project',
  tasks: 'Project',
  assignments: 'Project',
  activity: 'Project',
  docs: 'Project',
  'test-queue': 'Project',
  products: 'Product',
  code: 'Repository',
  repositories: 'Repository',
  'pull-requests': 'Repository',
  'code-security': 'Repository',
  'dev-tools': 'Repository',
  deployments: 'Deployment',
  incidents: 'Infrastructure',
  monitors: 'Infrastructure',
  team: 'Organization',
  security: 'Administration',
  audit: 'Administration',
  integrations: 'Administration',
  workspaces: 'Organization',
};

/** The minimum level each UI action needs. Actions with no server area stay local. */
export const ACTION_REQUIREMENT: Record<Action, { area: ApiArea; level: ApiLevel } | null> = {
  'task:create': { area: 'Project', level: 'contribute' },
  'task:assign': { area: 'Project', level: 'manage' },
  'time:log': { area: 'Project', level: 'contribute' },
  'bug:report': { area: 'Project', level: 'contribute' },
  'incident:declare': { area: 'Infrastructure', level: 'contribute' },
  'member:invite': { area: 'Organization', level: 'admin' },
  'deploy:approve': { area: 'Deployment', level: 'manage' },
  'workspace:create': { area: 'Organization', level: 'view' },
  'workspace:delete': { area: 'Organization', level: 'admin' },
  'channel:create': null,
  'channel:moderate': null,
  'doc:create': { area: 'Project', level: 'contribute' },
  'doc:publish': { area: 'Project', level: 'manage' },
  'code:commit': { area: 'Repository', level: 'contribute' },
  'security:dismiss': { area: 'Administration', level: 'manage' },
  'session:revoke': null,
  'github:configure': { area: 'Repository', level: 'manage' },
};

export function levelFor(caps: Capabilities | null, area: ApiArea): ApiLevel {
  if (!caps) return 'none';
  return caps.matrix[area] ?? 'none';
}

/**
 * Visible when the server allows it *and* the role's curated navigation list
 * includes it. The server decides what is permitted; the curated list decides
 * what this demo role is presented with. Denial always wins.
 */
export function canVisit(caps: Capabilities | null, area: Area, curated: readonly Area[]): boolean {
  if (!curated.includes(area)) return false;
  const serverArea = AREA_TO_SERVER[area];
  if (!serverArea) return true;
  if (!caps) return true; // before capabilities load, trust the curated list rather than flashing "no access"
  return RANK[levelFor(caps, serverArea)] >= RANK.view;
}

/** Individual actions additionally honour the curated role action list. */
export function canPerform(
  caps: Capabilities | null,
  action: Action,
  curated: readonly Action[],
): boolean {
  if (!curated.includes(action)) return false;
  const need = ACTION_REQUIREMENT[action];
  if (!need) return true;
  if (!caps) return true;
  return RANK[levelFor(caps, need.area)] >= RANK[need.level];
}
