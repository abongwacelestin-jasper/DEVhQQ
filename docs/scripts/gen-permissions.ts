/**
 * Generates docs/concepts/permission-matrix.md from the code that enforces it.
 *
 *   node --experimental-strip-types docs/scripts/gen-permissions.ts [--check]
 *
 * Sources:
 *  - Backend/auth/rbac.ts           permissionMatrix (the authority)
 *  - Backend/routes/*.routes.ts     requireArea / requireStepUp guards and
 *                                   in-handler can(...) checks
 *  - Frontend/src/api/capabilities.ts  UI area/action → server area mapping
 *  - Frontend/src/data/roles.ts        curated navigation per role
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { permissionMatrix } from '../../Backend/auth/rbac.ts';
import type { PermissionArea, PermissionLevel, RoleName } from '../../Backend/types.ts';
import {
  AREA_TO_SERVER,
  ACTION_REQUIREMENT,
  canVisit,
} from '../../Frontend/src/api/capabilities.ts';
import { demoRoles, roleKeyFor } from '../../Frontend/src/data/roles.ts';
import type { Capabilities } from '../../Frontend/src/api/types.ts';
import { ROOT, emit, generatedBanner, readRouteGuards, displayPath, walk, rel } from './lib.ts';

const roles: RoleName[] = [
  'Owner',
  'Project manager',
  'Developer',
  'Designer',
  'Tester',
  'Operations',
];
const areas = Object.keys(permissionMatrix) as PermissionArea[];
const levels: PermissionLevel[] = ['none', 'view', 'contribute', 'manage', 'admin'];
const rank = (l: PermissionLevel) => levels.indexOf(l);

let md = generatedBanner('gen-permissions.ts', [
  'Backend/auth/rbac.ts',
  'Backend/routes/*.routes.ts',
  'Frontend/src/api/capabilities.ts',
  'Frontend/src/data/roles.ts',
]);

md += `
# Permission matrix

The matrix below is \`permissionMatrix\` in \`Backend/auth/rbac.ts\`, rendered
as-is. The server checks it on every request; the web app receives the
caller's row from \`GET /api/me/capabilities\` and never keeps its own copy.
For what the areas, levels and scopes mean, read
[Roles and permissions](roles-and-permissions.md).

## Levels

Levels are ordered; a check for a level passes for that level and every level
above it (\`can()\` compares ranks).

| Rank | Level |
|---|---|
${levels.map((l, i) => `| ${i} | \`${l}\` |`).join('\n')}

## Role × area

| Area | ${roles.join(' | ')} |
|---|${roles.map(() => '---').join('|')}|
${areas
  .map((a) => `| **${a}** | ${roles.map((r) => `\`${permissionMatrix[a][r]}\``).join(' | ')} |`)
  .join('\n')}

Product scope applies on top of every cell: apart from the Owner, a member
only sees rows belonging to the products they are assigned to, and anything
outside that scope answers \`404\`.

`;

// ── Enforcement points ─────────────────────────────────────────────────────
const guards = readRouteGuards();
md += `## Where each area is enforced

### Route guards (\`requireArea\`)

Routes whose middleware chain contains \`requireArea(area, level)\`. A route
not listed here authenticates the caller but has no area guard; it is still
scoped by product in its handler.

| Area | Minimum level | Method | Path | Step-up |
|---|---|---|---|---|
`;
const rows: string[] = [];
for (const g of guards)
  for (const a of g.areas)
    rows.push(
      `| ${a.area} | \`${a.level}\` | \`${g.method}\` | \`${displayPath(g.path)}\` | ${g.stepUp ? 'yes' : ''} |`,
    );
rows.sort((x, y) => x.localeCompare(y));
md += rows.join('\n') + '\n';

md += `
### Step-up without an area guard

Routes that require a fresh strong verification (\`requireStepUp\`) but no
\`requireArea\`; the handler applies its own rule.

| Method | Path | Rule in handler |
|---|---|---|
`;
const handlerRule: Record<string, string> = {
  'POST /api/auth/totp/enroll': 'your own account only',
  'POST /api/auth/passkeys/options': 'your own account only',
  'DELETE /api/auth/passkeys/:credentialId': 'your own passkeys only',
  'POST /api/offboarding/:memberId':
    'yourself (resignation), or Administration ≥ `manage` for anyone else',
  'PATCH /api/offboarding/:memberId':
    'Administration ≥ `manage`; the member may only withdraw their own resignation; nobody completes their own',
  'POST /api/tokens': 'interactive session; requested scopes cannot exceed your role',
  'POST /api/access/grants': 'caller must be assigned to the product in `scope`',
  'POST /api/access/grants/:grantId/approve':
    'approver must be Owner or Operations and not the requester (`Backend/auth/jit.ts`)',
};
for (const g of guards.filter((x) => x.stepUp && x.areas.length === 0))
  md += `| \`${g.method}\` | \`${displayPath(g.path)}\` | ${handlerRule[`${g.method} ${g.path}`] ?? '—'} |\n`;

// In-handler can(...) checks.
md += `
### In-handler checks (\`can(...)\`)

Calls to \`can(principal, area, level)\` inside handlers, where the outcome
changes what is returned rather than refusing the request.

| Area | Level | Location |
|---|---|---|
`;
const canRows: string[] = [];
for (const abs of walk(join(ROOT, 'Backend/routes'), (n) => n.endsWith('.ts'))) {
  const lines = readFileSync(abs, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/\bcan\(\s*[\w.!]+,\s*'(\w+)',\s*'(\w+)'\s*\)/g))
      canRows.push(
        `| ${m[1]} | \`${m[2]}\` | [${rel(abs)}:${i + 1}](../../${rel(abs)}#L${i + 1}) |`,
      );
  });
}
md += canRows.join('\n') + '\n';

// ── Frontend mapping ───────────────────────────────────────────────────────
md += `
## How the web app uses the matrix

The UI navigates by page *area*; \`Frontend/src/api/capabilities.ts\` maps each
one to a server area. A page is shown when the role's level in that server
area is at least \`view\` **and** the page is in the role's curated list in
\`Frontend/src/data/roles.ts\`. Denial wins: the curated list can hide a page
the server would allow, never the reverse. A page with no server area
(\`—\`) is available to every signed-in member.

### Page area → server area

| UI area | Server area |
|---|---|
${(Object.keys(AREA_TO_SERVER) as (keyof typeof AREA_TO_SERVER)[])
  .map((a) => `| \`${a}\` | ${AREA_TO_SERVER[a] ?? '—'} |`)
  .join('\n')}

### Pages each role is shown

Computed with the same \`canVisit()\` the app uses, from each role's matrix row.

`;
const uiAreas = Object.keys(AREA_TO_SERVER) as (keyof typeof AREA_TO_SERVER)[];
md += `| UI area | ${roles.join(' | ')} |\n|---|${roles.map(() => '---').join('|')}|\n`;
const capsFor = (role: RoleName): Capabilities =>
  ({
    role,
    products: [],
    matrix: Object.fromEntries(areas.map((a) => [a, permissionMatrix[a][role]])),
    levels,
    verifiedAt: 0,
    elevations: [],
  }) as unknown as Capabilities;
for (const a of uiAreas) {
  md += `| \`${a}\` | ${roles
    .map((r) => {
      const ui = demoRoles.find((d) => d.key === roleKeyFor(r))!;
      return canVisit(capsFor(r), a, ui.areas) ? '✓' : '';
    })
    .join(' | ')} |\n`;
}

md += `
### UI actions → required level

\`canPerform()\` additionally requires the action to be in the role's curated
action list. Actions marked \`—\` have no server area yet and are decided by the
curated list alone.

| Action | Server area | Minimum level | ${roles.join(' | ')} |
|---|---|---|${roles.map(() => '---').join('|')}|
`;
for (const [action, need] of Object.entries(ACTION_REQUIREMENT)) {
  const marks = roles.map((r) => {
    const ui = demoRoles.find((d) => d.key === roleKeyFor(r))!;
    if (!(ui.actions as string[]).includes(action)) return '';
    if (!need) return '✓';
    return rank(permissionMatrix[need.area][r]) >= rank(need.level) ? '✓' : '';
  });
  md += `| \`${action}\` | ${need ? need.area : '—'} | ${need ? `\`${need.level}\`` : '—'} | ${marks.join(' | ')} |\n`;
}

md += `
## Consistency checks

### Curated actions the server denies

Actions a role's curated list offers but its matrix row does not reach. The UI
hides them (denial wins); they are listed so the curated lists can be
corrected rather than silently disagreeing with the matrix.

`;
const denied: string[] = [];
for (const r of roles) {
  const ui = demoRoles.find((d) => d.key === roleKeyFor(r))!;
  for (const action of ui.actions) {
    const need = ACTION_REQUIREMENT[action];
    if (need && rank(permissionMatrix[need.area][r]) < rank(need.level))
      denied.push(
        `| ${r} | \`${action}\` | ${need.area} ≥ \`${need.level}\` | \`${permissionMatrix[need.area][r]}\` |`,
      );
  }
}
md += denied.length
  ? `| Role | Action | Needs | Role has |\n|---|---|---|---|\n${denied.join('\n')}\n`
  : 'None.\n';

md += `
### Authenticated routes without an area guard

These routes require a verified session but no \`requireArea\`, so every role
can call them. Most scope their rows by product in the handler; the ones that
return organisation-wide data are noted in
[Roles and permissions](roles-and-permissions.md#routes-open-to-every-signed-in-member).

`;
const open = guards
  .filter((g) => g.session && g.areas.length === 0)
  .map((g) => `\`${g.method} ${displayPath(g.path)}\``);
md += open.join(' · ') + '\n';

md += `
Role copy in \`Frontend/src/data/team.ts\` (\`roleDetails\`) is prose and is not
checked here. Per the Wave 4 owner decision, Developer keeps \`Deployment:
view\`; the UI copy changes to match the matrix, not the other way round.
`;

emit(
  'docs/concepts/permission-matrix.md',
  md
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n'),
);
