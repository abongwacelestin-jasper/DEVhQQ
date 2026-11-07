import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memberById } from './status';
import {
  areaDot,
  areaFor,
  exportAuditCsv,
  fingerprint,
  previousFingerprint,
  type AuditRow,
} from './audit';

const row = (id: string, patch: Partial<AuditRow> = {}): AuditRow => ({
  id,
  when: '2026-10-23T10:00:00Z',
  actor: 'm1',
  action: 'task.updated',
  target: `RB-${id}`,
  area: 'Project',
  source: 'session',
  ...patch,
});

describe('areaFor', () => {
  it.each([
    ['task.created', 'Project'],
    ['doc.updated', 'Project'],
    ['deploy.approved', 'Deployment'],
    ['incident.declared', 'Infrastructure'],
    ['team.invited', 'Administration'],
    ['console.query', 'Administration'],
    ['auth.mfa_ok', 'Organization'],
    ['', 'Organization'],
  ])('%s → %s', (action, area) => {
    expect(areaFor(action)).toBe(area);
  });

  it('has a dot colour for every area it can return', () => {
    for (const a of ['task.x', 'deploy.x', 'incident.x', 'team.x', 'other'])
      expect(areaDot[areaFor(a)]).toMatch(/^bg-/);
  });
});

describe('fingerprint', () => {
  it('is a stable 16-hex-character digest', () => {
    const r = row('1');
    expect(fingerprint(r)).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprint(r)).toBe(fingerprint({ ...r }));
  });

  it('changes when any hashed field changes', () => {
    const base = row('1');
    const variants: Partial<AuditRow>[] = [
      { id: '2' },
      { when: '2026-10-23T10:00:01Z' },
      { actor: 'm2' },
      { action: 'task.deleted' },
      { target: 'RB-999' },
    ];
    for (const v of variants) expect(fingerprint({ ...base, ...v })).not.toBe(fingerprint(base));
  });

  it('links each row to the next (older) row, and the last row to genesis', () => {
    const rows = [row('3'), row('2'), row('1')];
    expect(previousFingerprint(rows, rows[0])).toBe(fingerprint(rows[1]));
    expect(previousFingerprint(rows, rows[1])).toBe(fingerprint(rows[2]));
    expect(previousFingerprint(rows, rows[2])).toBe('0'.repeat(16));
    expect(previousFingerprint(rows, row('missing'))).toBe('0'.repeat(16));
  });
});

describe('exportAuditCsv', () => {
  let blobs: Blob[];
  let clicked: HTMLAnchorElement[];
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };

  beforeEach(() => {
    blobs = [];
    clicked = [];
    URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
      blobs.push(b as Blob);
      return 'blob:test-1';
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-07T12:00:00Z'));
  });

  afterEach(() => {
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
  });

  const csvText = () =>
    new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blobs[0]);
    });

  it('downloads a dated CSV with a header, member names and quoted cells', async () => {
    const r = row('1', { target: 'Title with "quotes", commas', sensitive: true });
    exportAuditCsv([r, row('2', { actor: 'm2' })]);

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('devhq-audit-2026-11-07.csv');
    expect(clicked[0].href).toBe('blob:test-1');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-1');
    expect(blobs[0].type).toBe('text/csv');

    vi.useRealTimers();
    const lines = (await csvText()).split('\n');
    expect(lines[0]).toBe('when,actor,action,target,area,source,sensitive,fingerprint');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe(
      [
        r.when,
        memberById('m1').name,
        r.action,
        'Title with ""quotes"", commas',
        'Project',
        'session',
        'yes',
        fingerprint(r),
      ]
        .map((c) => `"${c}"`)
        .join(','),
    );
    expect(lines[2]).toContain(`"${memberById('m2').name}"`);
    expect(lines[2]).toContain('"no"');
  });

  // FINDING F-FE-4: exportAuditCsv writes user-controlled text (task titles, doc
  // titles) verbatim, so a target like `=HYPERLINK(...)` becomes a live formula
  // when the export is opened in Excel/Sheets (CSV/formula injection, OWASP).
  // Correct behaviour: cells starting with = + - @ (or tab/CR) are neutralised,
  // e.g. prefixed with a single quote.
  it.fails('neutralises spreadsheet formulas in exported cells (F-FE-4)', async () => {
    exportAuditCsv([row('1', { target: '=HYPERLINK("http://evil.example","x")' })]);
    vi.useRealTimers();
    const lines = (await csvText()).split('\n');
    expect(lines[1]).not.toMatch(/(^|,)"[=+\-@]/);
  });
});
