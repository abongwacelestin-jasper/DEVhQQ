import type { PermissionArea } from '../types/team';
import { memberById } from './status';

export interface AuditRow {
  id: string;
  when: string;
  actor: string;
  action: string;
  target: string;
  area: PermissionArea;
  sensitive?: boolean;
  source: 'session' | 'workspace';
}

/** The audit trail records an action name; the UI filters by the area it belongs to. */
export function areaFor(action: string): PermissionArea {
  if (action.startsWith('task.') || action.startsWith('doc.')) return 'Project';
  if (action.startsWith('deploy.')) return 'Deployment';
  if (action.startsWith('incident.')) return 'Infrastructure';
  if (action.startsWith('team.') || action.startsWith('console.')) return 'Administration';
  return 'Organization';
}

/** Deterministic pseudo-hash so each entry shows a stable integrity fingerprint. */
export function fingerprint(r: AuditRow) {
  let h = 2166136261;
  for (const ch of `${r.id}|${r.when}|${r.actor}|${r.action}|${r.target}`)
    h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0') + ((h * 31) >>> 0).toString(16).padStart(8, '0');
}

/** Fingerprint of the previous entry, so each row shows the link it chains from. */
export function previousFingerprint(rows: AuditRow[], r: AuditRow) {
  const i = rows.findIndex((x) => x.id === r.id);
  return i >= 0 && i < rows.length - 1 ? fingerprint(rows[i + 1]) : '0'.repeat(16);
}

export function exportAuditCsv(rows: AuditRow[]) {
  // Quote every cell, and neutralise spreadsheet formulas in user text (F-FE-4, OWASP CSV injection).
  const esc = (s: string) => {
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const csv = [
    'when,actor,action,target,area,source,sensitive,fingerprint',
    ...rows.map((r) =>
      [
        r.when,
        memberById(r.actor).name,
        r.action,
        r.target,
        r.area,
        r.source,
        r.sensitive ? 'yes' : 'no',
        fingerprint(r),
      ]
        .map(esc)
        .join(','),
    ),
  ].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `devhq-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export const areaDot: Record<PermissionArea, string> = {
  Organization: 'bg-accent',
  Product: 'bg-info',
  Project: 'bg-ok',
  Repository: 'bg-ink',
  Deployment: 'bg-warn',
  Infrastructure: 'bg-bad',
  Administration: 'bg-subtle',
};
