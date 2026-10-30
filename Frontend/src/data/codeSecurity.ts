import type { ProductId } from '../types/portfolio';

export type FindingKind = 'dependency' | 'secret' | 'code' | 'license';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type FindingStatus = 'open' | 'fixed' | 'dismissed';

export interface SecurityFinding {
  id: string;
  kind: FindingKind;
  severity: Severity;
  title: string;
  repo: string;
  product: ProductId;
  location: string;
  detail: string;
  fix: string;
  detectedAt: string;
  status: FindingStatus;
  owner?: string;
  cve?: string;
  dismissReason?: string;
}

export const severityMeta: Record<Severity, { label: string; cls: string; rank: number }> = {
  critical: { label: 'Critical', cls: 'bg-bad text-white', rank: 0 },
  high: { label: 'High', cls: 'bg-bad-soft text-bad', rank: 1 },
  medium: { label: 'Medium', cls: 'bg-warn-soft text-warn', rank: 2 },
  low: { label: 'Low', cls: 'bg-sunken text-ink', rank: 3 },
};

export const kindLabel: Record<FindingKind, string> = {
  dependency: 'Dependency',
  secret: 'Secret',
  code: 'Code scanning',
  license: 'License',
};

export const seedFindings: SecurityFinding[] = [
  {
    id: 'SF-101',
    kind: 'dependency',
    severity: 'critical',
    title: 'jsonwebtoken signature bypass',
    repo: 'renewberry/api',
    product: 'renewberry',
    location: 'package.json · jsonwebtoken@8.5.1',
    detail:
      'Versions below 9.0.0 accept tokens signed with insecure algorithms when the key type is not checked.',
    fix: 'Upgrade to jsonwebtoken@9.0.2',
    detectedAt: '2026-10-22T09:12:00.000Z',
    status: 'open',
    owner: 'm4',
    cve: 'CVE-2022-23529',
  },
  {
    id: 'SF-102',
    kind: 'secret',
    severity: 'high',
    title: 'Stripe test key committed',
    repo: 'renewberry/web',
    product: 'renewberry',
    location: 'src/checkout/client.ts:14 · c03e8b1',
    detail: 'A Stripe key was pushed in a commit. Treat as compromised even if removed later.',
    fix: 'Key rotated by Kofi; purge from history',
    detectedAt: '2026-10-23T08:40:00.000Z',
    status: 'fixed',
    owner: 'm4',
  },
  {
    id: 'SF-103',
    kind: 'code',
    severity: 'high',
    title: 'SQL built from request input',
    repo: 'blog/platform',
    product: 'blog',
    location: 'src/search/query.ts:31',
    detail: 'User-controlled `q` is concatenated into a raw SQL string.',
    fix: 'Use parameterised queries via db.sql``',
    detectedAt: '2026-10-21T15:02:00.000Z',
    status: 'open',
    owner: 'm6',
  },
  {
    id: 'SF-104',
    kind: 'dependency',
    severity: 'medium',
    title: 'express open redirect',
    repo: 'renewberry/api',
    product: 'renewberry',
    location: 'package.json · express@4.19.2',
    detail: 'res.location() can redirect to attacker-controlled URLs with malformed input.',
    fix: 'Upgrade to express@4.21.1',
    detectedAt: '2026-10-20T11:30:00.000Z',
    status: 'open',
    owner: 'm5',
    cve: 'CVE-2024-43796',
  },
  {
    id: 'SF-105',
    kind: 'code',
    severity: 'medium',
    title: 'Missing rate limit on password reset',
    repo: 'renewberry/api',
    product: 'renewberry',
    location: 'src/auth/reset.ts:5',
    detail: 'requestReset can be called without limits, enabling email bombing.',
    fix: 'Add per-IP and per-email rate limit (5/hour)',
    detectedAt: '2026-10-22T17:45:00.000Z',
    status: 'open',
    owner: 'm5',
  },
  {
    id: 'SF-106',
    kind: 'license',
    severity: 'low',
    title: 'GPL-3.0 dependency in client bundle',
    repo: 'mirror-acture/app',
    product: 'mirror',
    location: 'node_modules/fancy-charts',
    detail: 'Copyleft license conflicts with workspace policy for distributed code.',
    fix: 'Replace with an MIT-licensed charting library',
    detectedAt: '2026-10-18T10:00:00.000Z',
    status: 'open',
    owner: 'm7',
  },
  {
    id: 'SF-107',
    kind: 'dependency',
    severity: 'high',
    title: 'Prototype pollution in lodash.merge',
    repo: 'mirror-acture/app',
    product: 'mirror',
    location: 'package-lock.json · lodash.merge@4.6.1',
    detail: 'Crafted input can modify Object.prototype.',
    fix: 'Upgrade to lodash.merge@4.6.2',
    detectedAt: '2026-10-19T08:20:00.000Z',
    status: 'open',
    owner: 'm7',
    cve: 'CVE-2020-8203',
  },
  {
    id: 'SF-108',
    kind: 'code',
    severity: 'low',
    title: 'Verbose error leaks stack trace',
    repo: 'blog/platform',
    product: 'blog',
    location: 'src/server/errors.ts:12',
    detail: 'Production responses include stack traces.',
    fix: 'Return generic messages when NODE_ENV=production',
    detectedAt: '2026-10-16T13:10:00.000Z',
    status: 'dismissed',
    owner: 'm8',
    dismissReason: 'Only reachable behind admin auth',
  },
];

export const securityPolicies = [
  { id: 'block-critical', label: 'Block merges with critical findings', on: true },
  { id: 'secret-push', label: 'Push protection for secrets', on: true },
  { id: 'precommit', label: 'Require pre-commit hook on developer machines', on: true },
  { id: 'signed', label: 'Require signed commits on main', on: false },
  { id: 'license', label: 'Fail CI on copyleft licenses', on: true },
];
