/**
 * Code findings ingest (secret scanning, dependency, code scanning, license).
 *
 * Findings arrive from CI (`POST /api/security/code-findings`) or from GitHub
 * alert webhooks. They are de-duplicated by a fingerprint so re-running a scan
 * updates rows instead of multiplying them. Free-text fields are passed
 * through the same secret patterns as the frontend pre-commit scanner
 * (Frontend/src/utils/secretScan.ts) and masked, so a scanner that echoes the
 * secret it found can never make DevHQ store or display it.
 */

import { createHash } from 'node:crypto';
import type { Repo, CodeFinding, FindingKind, FindingSeverity } from './types.ts';
import { findings } from './store.ts';

const secretRules: RegExp[] = [
  /sk_(?:live|test)_[A-Za-z0-9]{8,}/g,
  /AKIA[0-9A-Z]{12,}/g,
  /gh[pousr]_[A-Za-z0-9]{12,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /xox[bpas]-[A-Za-z0-9-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /((?:password|passwd|secret|token)\s*[:=]\s*['"])([^'"]{6,})(['"])/gi,
];

function mask(s: string): string {
  if (s.length <= 8) return '••••••';
  return `${s.slice(0, 4)}${'•'.repeat(Math.min(12, s.length - 6))}${s.slice(-2)}`;
}

/** Masks anything that looks like a credential. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const re of secretRules)
    out = out.replace(re, (m: string, pre?: string, val?: string, post?: string) =>
      typeof val === 'string' && typeof pre === 'string'
        ? `${pre}${mask(val)}${post ?? ''}`
        : mask(m),
    );
  return out;
}

export interface FindingInput {
  kind: FindingKind;
  severity: FindingSeverity;
  title: string;
  location: string;
  detail?: string;
  fix?: string;
  cve?: string;
  ruleId?: string;
  owner?: string;
  status?: 'open' | 'fixed' | 'dismissed';
  dismissReason?: string;
}

let seq = 0;
function nextId(): string {
  const max = [...findings.keys()]
    .map((k) => Number(k.replace(/^SF-/, '')))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 200);
  seq = Math.max(seq, max) + 1;
  return `SF-${seq}`;
}

/** Inserts or updates a finding. Returns the row and whether it was new. */
export function upsertFinding(
  repo: Repo,
  input: FindingInput,
  origin: CodeFinding['origin'],
): { row: CodeFinding; created: boolean } {
  const fingerprint = createHash('sha256')
    .update([repo.id, input.kind, input.ruleId ?? input.title, input.location].join('|'))
    .digest('hex');
  const now = new Date().toISOString();
  const clean = {
    title: redactSecrets(input.title),
    location: redactSecrets(input.location),
    detail: redactSecrets(input.detail ?? ''),
    fix: redactSecrets(input.fix ?? ''),
  };
  const existing = [...findings.values()].find((f) => f.fingerprint === fingerprint);
  if (existing) {
    Object.assign(existing, clean, {
      severity: input.severity,
      status: input.status ?? existing.status,
      dismissReason: input.dismissReason ?? existing.dismissReason,
      cve: input.cve ?? existing.cve,
      owner: input.owner ?? existing.owner,
      updatedAt: now,
    });
    findings.save(existing.id);
    return { row: existing, created: false };
  }
  const row: CodeFinding = {
    id: nextId(),
    fingerprint,
    kind: input.kind,
    severity: input.severity,
    ...clean,
    repoId: repo.id,
    repo: repo.name,
    product: repo.product,
    detectedAt: now,
    updatedAt: now,
    status: input.status ?? 'open',
    owner: input.owner,
    cve: input.cve,
    ruleId: input.ruleId,
    dismissReason: input.dismissReason,
    origin,
    source: origin === 'demo' ? 'demo' : origin === 'github' ? 'github' : 'manual',
  };
  findings.set(row.id, row);
  return { row, created: true };
}
