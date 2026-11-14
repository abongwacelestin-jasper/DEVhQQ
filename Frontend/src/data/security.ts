import type {
  AccessGrant,
  ApiToken,
  IntegrationConfig,
  SecurityCheck,
  SecurityPolicy,
  Session,
  SignInEvent,
} from '../types/security';

export const securityPolicies: SecurityPolicy[] = [
  {
    id: 'mfa-all',
    label: 'Require MFA for every member',
    description: 'Members without MFA are blocked after a 7-day grace period.',
    enabled: true,
  },
  {
    id: 'mfa-prod',
    label: 'Re-verify MFA for production actions',
    description: 'Approvals, rollbacks and access grants ask for a fresh code.',
    enabled: true,
    locked: true,
  },
  {
    id: 'sso',
    label: 'Sign in with Google Workspace only',
    description: 'Disables email + password sign-in for the organization.',
    enabled: false,
  },
  {
    id: 'ip',
    label: 'IP allowlist for admin actions',
    description: 'Administration area only reachable from office and VPN ranges.',
    enabled: true,
  },
  {
    id: 'pat',
    label: 'Block personal access tokens',
    description: 'Integrations must use scoped app installations instead.',
    enabled: true,
  },
  {
    id: 'session',
    label: 'Expire idle sessions after 12 hours',
    description: 'Members re-authenticate after 12 hours of inactivity.',
    enabled: true,
  },
  {
    id: 'stream',
    label: 'Stream audit log to S3',
    description: 'Append-only copy in a bucket TavetaHQ cannot delete from.',
    enabled: true,
  },
];

export const securityChecks: SecurityCheck[] = [
  {
    id: 'c1',
    label: 'MFA coverage',
    detail: '10 of 11 active members — Yuki Tanaka has MFA off',
    status: 'warn',
    to: '/team/m7',
  },
  {
    id: 'c2',
    label: 'Production access',
    detail: '2 standing grants, 1 time-boxed grant expiring today',
    status: 'pass',
  },
  {
    id: 'c3',
    label: 'API tokens',
    detail: '1 token expires in 5 days and has write scope',
    status: 'warn',
  },
  {
    id: 'c4',
    label: 'Webhook signatures',
    detail: 'All 4 providers sign payloads (HMAC-SHA256)',
    status: 'pass',
  },
  {
    id: 'c5',
    label: 'Branch protection',
    detail: 'mirror-acture/app allows merges without review',
    status: 'fail',
    to: '/repositories/mirror-acture--app',
  },
  { id: 'c6', label: 'Backups', detail: 'Last verified restore 3 days ago', status: 'pass' },
];

export const apiTokens: ApiToken[] = [
  {
    id: 't1',
    name: 'CI release notes bot',
    prefix: 'dhq_live_7Kq2',
    scopes: ['tasks:read', 'releases:write'],
    createdBy: 'm1',
    created: 'Aug 14',
    lastUsed: '2h ago',
    expires: 'Oct 28',
    status: 'expiring',
  },
  {
    id: 't2',
    name: 'Grafana read-only',
    prefix: 'dhq_live_Pz81',
    scopes: ['deployments:read', 'incidents:read'],
    createdBy: 'm11',
    created: 'Sep 2',
    lastUsed: '5m ago',
    expires: 'Mar 2',
    status: 'active',
  },
  {
    id: 't3',
    name: 'Legacy deploy token',
    prefix: 'dhq_live_c0Ff',
    scopes: ['deployments:write'],
    createdBy: 'm1',
    created: 'Mar 3',
    lastUsed: '41d ago',
    expires: '—',
    status: 'revoked',
  },
];

export const tokenScopes = [
  { key: 'tasks:read', label: 'Read tasks and projects' },
  { key: 'tasks:write', label: 'Create and update tasks', write: true },
  { key: 'deployments:read', label: 'Read deployments' },
  { key: 'deployments:write', label: 'Record deployments', write: true },
  { key: 'incidents:read', label: 'Read incidents' },
  { key: 'releases:write', label: 'Draft release notes', write: true },
  { key: 'audit:read', label: 'Read audit log' },
];

export const sessions: Session[] = [
  {
    id: 's1',
    member: 'm1',
    device: 'MacBook Pro · Chrome 130',
    location: 'Lagos, NG',
    ip: '102.89.xx.xx',
    lastSeen: 'Now',
    current: true,
  },
  {
    id: 's2',
    member: 'm1',
    device: 'iPhone 15 · TavetaHQ app',
    location: 'Lagos, NG',
    ip: '102.89.xx.xx',
    lastSeen: '2h ago',
  },
  {
    id: 's3',
    member: 'm1',
    device: 'Windows · Edge 129',
    location: 'Frankfurt, DE',
    ip: '91.64.xx.xx',
    lastSeen: '6d ago',
  },
  {
    id: 's4',
    member: 'm11',
    device: 'ThinkPad · Firefox 131',
    location: 'Berlin, DE',
    ip: '85.214.xx.xx',
    lastSeen: 'Now',
  },
  {
    id: 's5',
    member: 'm7',
    device: 'MacBook Air · Safari 18',
    location: 'Tokyo, JP',
    ip: '133.32.xx.xx',
    lastSeen: '3h ago',
  },
];

export const signIns: SignInEvent[] = [
  {
    id: 'g1',
    member: 'm1',
    when: 'Today 08:02',
    method: 'Passkey',
    location: 'Lagos, NG',
    result: 'success',
  },
  {
    id: 'g2',
    member: 'm11',
    when: 'Today 07:41',
    method: 'Google SSO + TOTP',
    location: 'Berlin, DE',
    result: 'success',
  },
  {
    id: 'g3',
    member: 'm7',
    when: 'Today 05:12',
    method: 'Password',
    location: 'Tokyo, JP',
    result: 'success',
  },
  {
    id: 'g4',
    member: 'm4',
    when: 'Yesterday 23:48',
    method: 'Password + TOTP',
    location: 'São Paulo, BR',
    result: 'blocked',
  },
  {
    id: 'g5',
    member: 'm5',
    when: 'Yesterday 18:30',
    method: 'Password + TOTP',
    location: 'Munich, DE',
    result: 'mfa-failed',
  },
  {
    id: 'g6',
    member: 'm5',
    when: 'Yesterday 18:31',
    method: 'Password + TOTP',
    location: 'Munich, DE',
    result: 'success',
  },
];

export const accessGrants: AccessGrant[] = [
  {
    id: 'ag1',
    member: 'm11',
    scope: 'Production · all products',
    reason: 'On-call operations engineer',
    expires: 'Standing',
    approvedBy: 'm1',
  },
  {
    id: 'ag2',
    member: 'm4',
    scope: 'Production logs · RenewBerry',
    reason: 'Investigating INC-31',
    expires: 'Today 18:00',
    approvedBy: 'm1',
  },
  {
    id: 'ag3',
    member: 'm10',
    scope: 'Staging · RenewBerry',
    reason: 'Testing RB-212 password reset',
    expires: 'Oct 30',
    approvedBy: 'm2',
  },
];

export const integrationConfigs: IntegrationConfig[] = [
  {
    id: 'i1',
    account: 'github.com/techorg',
    installedBy: 'm1',
    installed: 'Mar 4',
    scopes: [
      {
        key: 'metadata',
        label: 'Repository metadata',
        description: 'Names, default branches, topics',
        granted: true,
        required: true,
      },
      {
        key: 'pull_requests',
        label: 'Pull requests',
        description: 'Read PRs, reviews and review requests',
        granted: true,
        required: true,
      },
      {
        key: 'checks',
        label: 'Checks & statuses',
        description: 'Read CI results on commits',
        granted: true,
      },
      {
        key: 'contents',
        label: 'Repository contents',
        description: 'Read commit messages and tags — not source code',
        granted: true,
      },
      {
        key: 'issues_write',
        label: 'Issues (write)',
        description: 'Create GitHub issues from TavetaHQ tasks',
        granted: false,
        write: true,
      },
      {
        key: 'admin',
        label: 'Administration (write)',
        description: 'Change branch protection and settings',
        granted: false,
        write: true,
      },
    ],

    settings: [
      {
        key: 'auto-link',
        label: 'Link PRs to tasks from branch names',
        description: 'Branches like feat/rb-212-… link to RB-212 automatically',
        enabled: true,
      },
      {
        key: 'auto-status',
        label: 'Move task to “In review” when a PR opens',
        description: 'Never marks a task Done — that requires a production deploy',
        enabled: true,
      },
      {
        key: 'review-notify',
        label: 'Notify reviewers after 24h',
        description: 'Nudge requested reviewers in TavetaHQ and Slack',
        enabled: true,
      },
      {
        key: 'drafts',
        label: 'Sync draft pull requests',
        description: 'Drafts appear with a draft label',
        enabled: false,
      },
    ],

    mappings: [
      { external: 'renewberry/api', product: 'renewberry' },
      { external: 'renewberry/web', product: 'renewberry' },
      { external: 'blog/platform', product: 'blog' },
      { external: 'mirror-acture/app', product: 'mirror' },
    ],

    webhook: {
      url: 'https://hooks.tavetahq.io/github/9f2c',
      secretHint: 'whsec_••••••••••••a91e',
      lastRotated: '42 days ago',
      events: [
        { key: 'pull_request', enabled: true },
        { key: 'pull_request_review', enabled: true },
        { key: 'check_suite', enabled: true },
        { key: 'push', enabled: true },
        { key: 'release', enabled: true },
        { key: 'issues', enabled: false },
      ],
    },
    deliveries: [
      { id: 'w1', event: 'pull_request.closed', status: 200, when: '12m ago', duration: '84ms' },
      { id: 'w2', event: 'check_suite.completed', status: 200, when: '31m ago', duration: '62ms' },
      {
        id: 'w3',
        event: 'pull_request_review.submitted',
        status: 200,
        when: '1h ago',
        duration: '71ms',
      },
      { id: 'w4', event: 'push', status: 401, when: '3h ago', duration: '12ms' },
      { id: 'w5', event: 'push', status: 200, when: '3h ago', duration: '90ms' },
    ],
  },
  {
    id: 'i3',
    account: 'coolify.techorg.io',
    installedBy: 'm11',
    installed: 'Apr 19',
    scopes: [
      {
        key: 'read',
        label: 'Read deployments',
        description: 'Deployment events and environment status',
        granted: true,
        required: true,
      },
      {
        key: 'trigger',
        label: 'Trigger approved deployments',
        description: 'Only after an approval recorded in TavetaHQ',
        granted: true,
        write: true,
      },
      {
        key: 'env',
        label: 'Read environment variables',
        description: 'Never needed — TavetaHQ does not store secrets',
        granted: false,
        write: false,
      },
    ],

    settings: [
      {
        key: 'approval',
        label: 'Require approval for production',
        description: 'Owner or Operations, with MFA',
        enabled: true,
      },
      {
        key: 'staging-approval',
        label: 'Require approval for staging',
        description: 'Recommended for Mirror Acture beta',
        enabled: true,
      },
      {
        key: 'health',
        label: 'Run health check after deploy',
        description: 'Marks the deploy failed if /health is not 200 within 2 minutes',
        enabled: true,
      },
    ],

    mappings: [
      { external: 'blog-production', product: 'blog' },
      { external: 'blog-staging', product: 'blog' },
      { external: 'mirror-production', product: 'mirror' },
      { external: 'mirror-staging', product: 'mirror' },
    ],

    webhook: {
      url: 'https://hooks.tavetahq.io/coolify/41ab',
      secretHint: 'whsec_••••••••••••7c02',
      lastRotated: '9 days ago',
      events: [
        { key: 'deployment.started', enabled: true },
        { key: 'deployment.finished', enabled: true },
        { key: 'deployment.failed', enabled: true },
      ],
    },
    deliveries: [
      { id: 'c1', event: 'deployment.finished', status: 200, when: '1d ago', duration: '55ms' },
      { id: 'c2', event: 'deployment.started', status: 200, when: '1d ago', duration: '49ms' },
    ],

    credential: { label: 'API token', hint: 'cfy_••••••••3f9d', rotated: '9 days ago' },
  },
];
