import { describe, expect, it } from 'vitest';
import { demoRoles, type Action, type Area } from '../data/roles';
import type { ApiArea, ApiLevel, Capabilities } from './types';
import {
  ACTION_REQUIREMENT,
  AREA_TO_SERVER,
  canPerform,
  canVisit,
  levelFor,
} from './capabilities';

const LEVELS: ApiLevel[] = ['none', 'view', 'contribute', 'manage', 'admin'];
const AREAS: ApiArea[] = [
  'Organization',
  'Product',
  'Project',
  'Repository',
  'Deployment',
  'Infrastructure',
  'Administration',
];
const ALL_PAGES = Object.keys(AREA_TO_SERVER) as Area[];
const ALL_ACTIONS = Object.keys(ACTION_REQUIREMENT) as Action[];

/** Capabilities with every server area at `level`, optionally overridden per area. */
function caps(level: ApiLevel, overrides: Partial<Record<ApiArea, ApiLevel>> = {}): Capabilities {
  const matrix = Object.fromEntries(AREAS.map((a) => [a, overrides[a] ?? level])) as Record<
    ApiArea,
    ApiLevel
  >;
  return { role: 'Developer', products: ['renewberry'], matrix, levels: LEVELS, verifiedAt: 0, elevations: [] };
}

/** The server's Developer row (Backend/auth/rbac.ts permissionMatrix). */
const developer = caps('none', {
  Organization: 'view',
  Product: 'contribute',
  Project: 'contribute',
  Repository: 'contribute',
  Deployment: 'view',
  Infrastructure: 'view',
});

describe('levelFor', () => {
  it('is "none" before capabilities load or for an area the server omitted', () => {
    expect(levelFor(null, 'Project')).toBe('none');
    const partial = caps('admin');
    delete (partial.matrix as Partial<Record<ApiArea, ApiLevel>>).Deployment;
    expect(levelFor(partial, 'Deployment')).toBe('none');
    expect(levelFor(developer, 'Project')).toBe('contribute');
  });
});

describe('canVisit', () => {
  it('is false for any page outside the curated list, even with admin rights', () => {
    for (const page of ALL_PAGES) expect(canVisit(caps('admin'), page, [])).toBe(false);
  });

  it('personal pages need no server area', () => {
    for (const page of ALL_PAGES.filter((p) => AREA_TO_SERVER[p] === null))
      expect(canVisit(caps('none'), page, ALL_PAGES)).toBe(true);
  });

  it('trusts the curated list until capabilities load', () => {
    for (const page of ALL_PAGES) expect(canVisit(null, page, ALL_PAGES)).toBe(true);
  });

  it('requires at least view on the governing area — table over every page × level', () => {
    for (const page of ALL_PAGES) {
      const area = AREA_TO_SERVER[page];
      if (!area) continue;
      for (const level of LEVELS) {
        expect(canVisit(caps('admin', { [area]: level }), page, ALL_PAGES)).toBe(level !== 'none');
      }
    }
  });

  it('server denial wins for the Developer row', () => {
    expect(canVisit(developer, 'security', ALL_PAGES)).toBe(false); // Administration: none
    expect(canVisit(developer, 'audit', ALL_PAGES)).toBe(false);
    expect(canVisit(developer, 'deployments', ALL_PAGES)).toBe(true); // view
    expect(canVisit(developer, 'tasks', ALL_PAGES)).toBe(true);
  });
});

describe('canPerform', () => {
  it('is false for actions outside the curated list', () => {
    for (const a of ALL_ACTIONS) expect(canPerform(caps('admin'), a, [])).toBe(false);
  });

  it('local-only actions are allowed whenever curated', () => {
    for (const a of ALL_ACTIONS.filter((x) => ACTION_REQUIREMENT[x] === null))
      expect(canPerform(caps('none'), a, ALL_ACTIONS)).toBe(true);
  });

  it('trusts the curated list until capabilities load', () => {
    for (const a of ALL_ACTIONS) expect(canPerform(null, a, ALL_ACTIONS)).toBe(true);
  });

  it('needs the exact level or higher — table over every action × level', () => {
    for (const a of ALL_ACTIONS) {
      const need = ACTION_REQUIREMENT[a];
      if (!need) continue;
      LEVELS.forEach((level, i) => {
        const allowed = canPerform(caps('none', { [need.area]: level }), a, ALL_ACTIONS);
        expect(allowed).toBe(i >= LEVELS.indexOf(need.level));
      });
    }
  });

  it('a Developer may create tasks but not approve deploys or invite members', () => {
    expect(canPerform(developer, 'task:create', ALL_ACTIONS)).toBe(true);
    expect(canPerform(developer, 'deploy:approve', ALL_ACTIONS)).toBe(false);
    expect(canPerform(developer, 'member:invite', ALL_ACTIONS)).toBe(false);
  });

  it("every demo role's curated actions name real actions", () => {
    for (const role of demoRoles)
      for (const a of role.actions) expect(ALL_ACTIONS).toContain(a);
  });
});
