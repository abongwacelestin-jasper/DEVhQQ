import type { Integration, Member, PermissionArea, PermissionLevel, RoleName } from '../types/team';

/**
 * Team presentation data: role copy, role colours, permission-area copy.
 *
 * Immutable. Who exists, their role and the live permission matrix come from
 * the API (`GET /api/team`, `GET /api/team/roles`).
 */

export const roles: readonly { name: RoleName; summary: string }[] = [
  { name: 'Owner', summary: 'Full organization control. Production actions require MFA.' },
  { name: 'Project manager', summary: 'Plans and assigns work. No production access by default.' },
  { name: 'Developer', summary: 'Works on assigned products and repositories.' },
  { name: 'Designer', summary: 'Contributes to design and product tasks.' },
  { name: 'Tester', summary: 'Manages testing, reports defects, reads staging.' },
  { name: 'Operations', summary: 'Approved deployments and incident response.' },
];

/** Longer role descriptions and the colour used for the role dot across the Team UI. */
export const roleDetails: Readonly<
  Record<RoleName, { description: string; dot: string; productionDefault: boolean }>
> = {
  Owner: {
    description: 'Full control, billing, and the only role that can delete the workspace.',
    dot: 'bg-ink',
    productionDefault: true,
  },
  'Project manager': {
    description: 'Plans projects, assigns work, publishes docs and approves releases.',
    dot: 'bg-accent',
    productionDefault: false,
  },
  Developer: {
    description:
      'Writes code and opens PRs on assigned products; can view deployments, while releases are run by Operations.',
    dot: 'bg-info',
    productionDefault: false,
  },
  Designer: {
    description: 'Owns design tasks and specs; read access to code and releases.',
    dot: 'bg-warn',
    productionDefault: false,
  },
  Tester: {
    description: 'Runs the test queue, passes or returns work, files bugs.',
    dot: 'bg-ok',
    productionDefault: false,
  },
  Operations: {
    description: 'Runs deploys, monitors and incidents; time-limited production access.',
    dot: 'bg-bad',
    productionDefault: false,
  },
};

export const permissionAreas: readonly { area: PermissionArea; example: string }[] = [
  { area: 'Organization', example: 'Manage membership and organization settings' },
  { area: 'Product', example: 'View or administer a particular product' },
  { area: 'Project', example: 'Create tasks, assign work, manage milestones' },
  { area: 'Repository', example: 'View code activity or manage repo integrations' },
  { area: 'Deployment', example: 'View deployments, approve releases, run permitted operations' },
  { area: 'Infrastructure', example: 'View server metrics or manage designated resources' },
  { area: 'Administration', example: 'Integration credentials, security policies, audit records' },
];

/**
 * Copy of the server's role × area matrix (`GET /api/team/roles`), used only as
 * labels where the matrix hasn't loaded. Team/MemberDetail read the live matrix
 * through `useTeamData`. Keep in step with `Backend/auth/rbac.ts`.
 */
export const permissionMatrix: Readonly<
  Record<PermissionArea, Readonly<Record<RoleName, PermissionLevel>>>
> = {
  Organization: {
    Owner: 'admin',
    'Project manager': 'view',
    Developer: 'view',
    Designer: 'view',
    Tester: 'view',
    Operations: 'view',
  },
  Product: {
    Owner: 'admin',
    'Project manager': 'manage',
    Developer: 'contribute',
    Designer: 'contribute',
    Tester: 'contribute',
    Operations: 'view',
  },
  Project: {
    Owner: 'admin',
    'Project manager': 'manage',
    Developer: 'contribute',
    Designer: 'contribute',
    Tester: 'contribute',
    Operations: 'view',
  },
  Repository: {
    Owner: 'admin',
    'Project manager': 'view',
    Developer: 'contribute',
    Designer: 'view',
    Tester: 'view',
    Operations: 'view',
  },
  Deployment: {
    Owner: 'admin',
    'Project manager': 'view',
    Developer: 'view',
    Designer: 'none',
    Tester: 'view',
    Operations: 'manage',
  },
  Infrastructure: {
    Owner: 'admin',
    'Project manager': 'none',
    Developer: 'view',
    Designer: 'none',
    Tester: 'none',
    Operations: 'manage',
  },
  Administration: {
    Owner: 'admin',
    'Project manager': 'none',
    Developer: 'none',
    Designer: 'none',
    Tester: 'none',
    Operations: 'view',
  },
};

/** Integration catalogue copy (F-ENG replaces this with `GET /api/integrations`). */
export const integrations: readonly Integration[] = [
  {
    id: 'i1',
    name: 'GitHub App',
    category: 'Source control',
    status: 'connected',
    detail: '4 repositories · webhooks signed',
    lastSync: '2m ago',
    authority: 'GitHub stays authoritative for code, reviews and merges.',
    syncs: ['Pull requests', 'Commits', 'Reviews', 'CI checks', 'Tags'],
  },
  {
    id: 'i2',
    name: 'GitHub Actions',
    category: 'Deployment',
    status: 'connected',
    detail: 'RenewBerry pipelines',
    lastSync: '1m ago',
    authority: 'Executes RenewBerry deployments. DevHQ records and approves.',
    syncs: ['Workflow runs', 'Deploy events', 'Logs link'],
  },
  {
    id: 'i3',
    name: 'Coolify',
    category: 'Deployment',
    status: 'connected',
    detail: 'Blog & Mirror Acture',
    lastSync: '4m ago',
    authority: 'Executes Blog and Mirror Acture deployments.',
    syncs: ['Deploy events', 'Environment status'],
  },
  {
    id: 'i4',
    name: 'Uptime checks',
    category: 'Monitoring',
    status: 'degraded',
    detail: '6 checks · 1 failing',
    lastSync: '30s ago',
    authority: 'Built into DevHQ. Source of truth for availability history.',
    syncs: ['Availability', 'Latency'],
  },
  {
    id: 'i5',
    name: 'Supabase Auth',
    category: 'Identity',
    status: 'connected',
    detail: 'SSO + MFA enforced for production',
    lastSync: 'Live',
    authority: 'Authoritative for identity and sessions.',
    syncs: ['Sign-ins', 'MFA status'],
  },
  {
    id: 'i6',
    name: 'S3 storage',
    category: 'Storage',
    status: 'connected',
    detail: 'Attachments · 18.4 GB',
    lastSync: 'Live',
    authority: 'Stores files; DevHQ stores references only.',
    syncs: ['Attachments'],
  },
  {
    id: 'i7',
    name: 'Slack',
    category: 'Notifications',
    status: 'connected',
    detail: '#releases, #incidents',
    lastSync: '12m ago',
    authority: 'Delivery channel only — discussions stay in DevHQ.',
    syncs: ['Outbound alerts'],
  },
  {
    id: 'i8',
    name: 'Sentry',
    category: 'Monitoring',
    status: 'not-connected',
    detail: 'Application exceptions',
    lastSync: '—',
    authority: 'Would remain authoritative for exception data.',
    syncs: ['Exceptions', 'Releases'],
  },
  {
    id: 'i9',
    name: 'GitLab',
    category: 'Source control',
    status: 'planned',
    detail: 'Phase 6 provider adapter',
    lastSync: '—',
    authority: 'Same adapter interface as GitHub.',
    syncs: [],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY DIRECTORY MIRROR — deprecated, scheduled for removal.
//
// Nothing in the collaboration area (messaging, docs, work, team) reads these
// any more: those views take the signed-in member from `useAuth().session` and
// the directory from `useDirectory()` / `useTeamData()` (GET /api/team).
// They remain only because files outside F-COLLAB still import them
// (AuthContext, SignIn demo list, utils/status `memberById` → ui/Avatar,
// CommandMenu, QuickActions, ApiTokens, IncidentContext, useNavEntries, …).
// F-SEC is removing the AuthContext writes; the coordinator deletes this block
// once the remaining importers are migrated.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @deprecated Use `useAuth().session?.memberId`. Empty until a session exists —
 * it no longer falls back to the Owner account.
 */
export let currentUserId = '';

/** @deprecated Written by AuthContext only; see the block comment above. */
export function setCurrentUserId(id: string) {
  currentUserId = id;
}

/** @deprecated Written by AuthContext only; see the block comment above. */
export function setMembers(list: Member[]) {
  if (list.length) members = list;
}

/**
 * @deprecated Use `useDirectory()` / `useTeamData()`. Seeded only because the
 * sign-in screen and `utils/status.memberById` (non-F-COLLAB) need a row before
 * the API answers; replaced wholesale by `setMembers()` after sign-in.
 */
export let members: Member[] = [
  {
    id: 'm1',
    name: 'Amara Okafor',
    initials: 'AO',
    email: 'amara@techorg.io',
    role: 'Owner',
    products: ['renewberry', 'blog', 'mirror'],
    productionAccess: true,
    mfa: true,
    status: 'active',
    lastActive: 'Now',
    openTasks: 2,
    capacity: 6,
    color: '#4F46E5',
  },
  {
    id: 'm2',
    name: 'Daniel Reyes',
    initials: 'DR',
    email: 'daniel@techorg.io',
    role: 'Project manager',
    products: ['renewberry'],
    productionAccess: false,
    mfa: true,
    status: 'active',
    lastActive: '5m',
    openTasks: 7,
    capacity: 10,
    color: '#0E7490',
  },
  {
    id: 'm3',
    name: 'Priya Nair',
    initials: 'PN',
    email: 'priya@techorg.io',
    role: 'Project manager',
    products: ['blog', 'mirror'],
    productionAccess: false,
    mfa: true,
    status: 'active',
    lastActive: '1h',
    openTasks: 6,
    capacity: 10,
    color: '#B45309',
  },
  {
    id: 'm4',
    name: 'Kofi Mensah',
    initials: 'KM',
    email: 'kofi@techorg.io',
    role: 'Developer',
    products: ['renewberry'],
    productionAccess: false,
    mfa: true,
    status: 'active',
    lastActive: '2m',
    openTasks: 12,
    capacity: 10,
    color: '#15803D',
  },
  {
    id: 'm5',
    name: 'Lena Fischer',
    initials: 'LF',
    email: 'lena@techorg.io',
    role: 'Developer',
    products: ['renewberry', 'mirror'],
    productionAccess: false,
    mfa: true,
    status: 'active',
    lastActive: '20m',
    openTasks: 8,
    capacity: 10,
    color: '#BE185D',
  },
  {
    id: 'm6',
    name: 'Tomás Silva',
    initials: 'TS',
    email: 'tomas@techorg.io',
    role: 'Developer',
    products: ['blog'],
    productionAccess: false,
    mfa: true,
    status: 'active',
    lastActive: '12m',
    openTasks: 5,
    capacity: 10,
    color: '#7C3AED',
  },
  {
    id: 'm7',
    name: 'Yuki Tanaka',
    initials: 'YT',
    email: 'yuki@techorg.io',
    role: 'Developer',
    products: ['renewberry', 'mirror'],
    productionAccess: false,
    mfa: false,
    status: 'active',
    lastActive: '3h',
    openTasks: 5,
    capacity: 10,
    color: '#0369A1',
  },
  {
    id: 'm8',
    name: 'Sam Carter',
    initials: 'SC',
    email: 'sam@techorg.io',
    role: 'Developer',
    products: ['blog', 'mirror'],
    productionAccess: false,
    mfa: true,
    status: 'active',
    lastActive: '1d',
    openTasks: 3,
    capacity: 10,
    color: '#A16207',
  },
  {
    id: 'm9',
    name: 'Inès Moreau',
    initials: 'IM',
    email: 'ines@techorg.io',
    role: 'Designer',
    products: ['renewberry', 'mirror'],
    productionAccess: false,
    mfa: true,
    status: 'active',
    lastActive: '40m',
    openTasks: 6,
    capacity: 8,
    color: '#C2410C',
  },
  {
    id: 'm10',
    name: 'Ravi Patel',
    initials: 'RP',
    email: 'ravi@techorg.io',
    role: 'Tester',
    products: ['renewberry', 'mirror'],
    productionAccess: false,
    mfa: true,
    status: 'active',
    lastActive: '4h',
    openTasks: 4,
    capacity: 8,
    color: '#047857',
  },
  {
    id: 'm11',
    name: 'Grace Liu',
    initials: 'GL',
    email: 'grace@techorg.io',
    role: 'Operations',
    products: ['renewberry', 'blog', 'mirror'],
    productionAccess: true,
    mfa: true,
    status: 'active',
    lastActive: 'Now',
    openTasks: 4,
    capacity: 8,
    color: '#B91C1C',
  },
  {
    id: 'm12',
    name: 'Noah Adeyemi',
    initials: 'NA',
    email: 'noah@techorg.io',
    role: 'Developer',
    products: ['blog'],
    productionAccess: false,
    mfa: false,
    status: 'invited',
    lastActive: 'Invite sent 2d',
    openTasks: 0,
    capacity: 10,
    color: '#475569',
  },
];
