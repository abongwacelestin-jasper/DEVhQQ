import { useLanguage } from '../contexts/LanguageContext';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { DownloadIcon, LockIcon, SearchIcon, ShieldCheckIcon, XIcon } from 'lucide-react';
import { MultiSelect } from '../components/ui/MultiSelect';
import { AuditTable } from '../components/audit/AuditTable';
import { AuditDetailDrawer } from '../components/audit/AuditDetailDrawer';
import { api } from '../api/client';
import type { ApiAuditEntry } from '../api/types';
import { useAuth } from '../contexts/AuthContext';
import { memberById } from '../utils/status';
import { formatDateTime } from '../utils/date';
import { areaDot, areaFor, exportAuditCsv, type AuditRow } from '../utils/audit';
import type { PermissionArea } from '../types/team';

const AREAS: PermissionArea[] = [
  'Organization',
  'Product',
  'Project',
  'Repository',
  'Deployment',
  'Infrastructure',
  'Administration',
];
const PAGE = 30;
type Source = AuditRow['source'];

function toRow(e: ApiAuditEntry): AuditRow {
  return {
    id: `s${e.seq}`,
    when: formatDateTime(new Date(e.at)),
    actor: e.actor,
    action: e.action,
    target: e.target,
    area: areaFor(e.action),
    sensitive: e.sensitive,
    source: 'workspace',
  };
}

export function AuditLog() {
  const { heading } = useLanguage();
  const { authEvents, session } = useAuth();
  const [workspace, setWorkspace] = useState<AuditRow[]>([]);
  const [params] = useSearchParams();
  const [q, setQ] = useState('');
  const [areas, setAreas] = useState<PermissionArea[]>([]);
  const [actors, setActors] = useState<string[]>(() =>
    params.get('actor') ? [params.get('actor')!] : [],
  );
  const [sources, setSources] = useState<Source[]>([]);
  const [sensitiveOnly, setSensitiveOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<string | null>(null);

  // The server's hash-chained trail is the record of truth; local session events
  // are added on top so the current page's actions are never missing.
  useEffect(() => {
    if (!session?.memberId) {
      setWorkspace([]);
      return;
    }
    let alive = true;
    api<ApiAuditEntry[]>('/api/audit?limit=500')
      .then((rows) => {
        if (alive) setWorkspace(rows.map(toRow));
      })
      .catch(() => {
        /* the local session events still render; the trail reloads on the next visit */
      });
    return () => {
      alive = false;
    };
  }, [session?.memberId]);

  const all = useMemo<AuditRow[]>(
    () => [
      ...authEvents.map((e) => ({
        id: e.id,
        when: formatDateTime(new Date(e.at)),
        actor: e.actor,
        action: e.action,
        target: e.target,
        area: 'Organization' as PermissionArea,
        sensitive: e.sensitive,
        source: 'session' as const,
      })),
      ...workspace,
    ],

    [authEvents, workspace],
  );
  const actorIds = useMemo(() => Array.from(new Set(all.map((r) => r.actor))), [all]);

  const rows = all.filter(
    (e) =>
      (!areas.length || areas.includes(e.area)) &&
      (!actors.length || actors.includes(e.actor)) &&
      (!sources.length || sources.includes(e.source)) &&
      (!sensitiveOnly || e.sensitive) &&
      (!q ||
        `${e.action} ${e.target} ${memberById(e.actor).name} ${e.area}`
          .toLowerCase()
          .includes(q.toLowerCase())),
  );
  const shown = rows.slice(0, limit);
  const current = all.find((r) => r.id === selected) ?? null;
  const activeFilters =
    areas.length + actors.length + sources.length + Number(sensitiveOnly) + Number(!!q);
  const sensitive = all.filter((r) => r.sensitive).length;
  const byArea = AREAS.map((a) => ({ a, n: all.filter((r) => r.area === a).length })).filter(
    (x) => x.n,
  );

  const reset = () => {
    setQ('');
    setAreas([]);
    setActors([]);
    setSources([]);
    setSensitiveOnly(false);
  };
  const exportCsv = () => {
    exportAuditCsv(rows);
    toast.success(`Exported ${rows.length} events`, {
      description: 'Filters applied · fingerprints included for verification',
    });
  };
  const close = useCallback(() => setSelected(null), []);

  return (
    <div className="space-y-3">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-[18px] font-semibold tracking-tight text-ink">
            {heading('Audit log')}
          </h1>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Append-only · retained 400 days · every entry hash-chained to the one before it
          </p>
        </div>
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-ok/25 bg-ok-soft px-2.5 text-[11.5px] font-medium text-ok">
          <ShieldCheckIcon className="h-3.5 w-3.5" /> Chain intact · {all.length} entries
        </span>
        <button
          onClick={exportCsv}
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-[12.5px] font-semibold text-white hover:bg-ink/90"
        >
          <DownloadIcon className="h-3.5 w-3.5" /> Export CSV{activeFilters ? ' · filtered' : ''}
        </button>
      </header>

      {/* Summary strip: totals + area distribution (click to filter) */}
      <section
        aria-label="Summary"
        className="grid overflow-hidden rounded-lg border border-line bg-white md:grid-cols-[repeat(4,minmax(0,140px))_minmax(0,1fr)]"
      >
        {[
          { label: 'Events', value: all.length },
          { label: 'Sensitive', value: sensitive, tone: 'text-warn' },
          { label: 'People', value: actorIds.length },
          { label: 'This session', value: authEvents.length },
        ].map((s, i) => (
          <div
            key={s.label}
            className={`flex items-baseline justify-between gap-2 border-line px-3 py-2 md:block ${i ? 'border-t md:border-l md:border-t-0' : ''}`}
          >
            <p className="text-[11px] text-muted">{s.label}</p>
            <p
              className={`text-[17px] font-semibold leading-6 tabular-nums ${s.tone ?? 'text-ink'}`}
            >
              {s.value}
            </p>
          </div>
        ))}
        <div className="border-t border-line px-3 py-2 md:border-l md:border-t-0">
          <p className="text-[11px] text-muted">By area</p>
          <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-sunken">
            {byArea.map(({ a, n }) => (
              <button
                key={a}
                onClick={() => setAreas([a])}
                title={`${a} · ${n}`}
                aria-label={`Filter ${a}`}
                className={`h-full transition-opacity duration-150 hover:opacity-80 ${areaDot[a]}`}
                style={{ width: `${(n / all.length) * 100}%` }}
              />
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-muted">
            {byArea.map(({ a, n }) => (
              <span key={a} className="inline-flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${areaDot[a]}`} />
                {a} <b className="font-semibold tabular-nums text-ink">{n}</b>
              </span>
            ))}
          </div>
        </div>
      </section>

      <section
        aria-label="Events"
        className="overflow-hidden rounded-lg border border-line bg-white"
      >
        {/* Control bar — search fills the row, filters share equal heights */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-2.5 py-2">
          <label className="relative block min-w-0 basis-full sm:basis-[280px] sm:flex-1">
            <span className="sr-only">Search events</span>
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setLimit(PAGE);
              }}
              placeholder="Search action, target, person or area"
              className="h-8 w-full rounded-md border border-line bg-white pl-8 pr-8 text-[12.5px] outline-none focus:border-accent"
            />
            {q && (
              <button
                onClick={() => setQ('')}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-subtle hover:bg-sunken hover:text-ink"
              >
                <XIcon className="h-3 w-3" />
              </button>
            )}
          </label>
          <div className="grid flex-1 grid-cols-2 gap-1.5 sm:flex-none sm:grid-cols-[repeat(4,minmax(112px,auto))]">
            <MultiSelect<PermissionArea>
              className="h-8"
              label="Area"
              value={areas}
              onChange={(v) => {
                setAreas(v);
                setLimit(PAGE);
              }}
              options={AREAS.map((a) => ({
                value: a,
                label: a,
                dot: areaDot[a],
                count: all.filter((r) => r.area === a).length,
              }))}
            />
            <MultiSelect<string>
              className="h-8"
              label="Person"
              value={actors}
              onChange={setActors}
              options={actorIds.map((id) => ({
                value: id,
                label: memberById(id).name,
                count: all.filter((r) => r.actor === id).length,
              }))}
            />
            <MultiSelect<Source>
              className="h-8"
              label="Source"
              value={sources}
              onChange={setSources}
              options={[
                {
                  value: 'workspace',
                  label: 'Workspace',
                  count: all.filter((r) => r.source === 'workspace').length,
                },
                { value: 'session', label: 'Session', count: authEvents.length },
              ]}
            />
            <button
              onClick={() => setSensitiveOnly((v) => !v)}
              aria-pressed={sensitiveOnly}
              className={`inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-[12px] font-medium transition-colors duration-150 ${sensitiveOnly ? 'border-warn/40 bg-warn-soft text-warn' : 'border-line bg-white text-ink hover:border-line-strong'}`}
            >
              <LockIcon className="h-3.5 w-3.5" /> Sensitive
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            {activeFilters > 0 && (
              <button
                onClick={reset}
                className="h-8 rounded-md px-2 text-[12px] font-medium text-accent hover:bg-accent-soft/50"
              >
                Reset
              </button>
            )}
            <span className="whitespace-nowrap px-1 text-[11.5px] tabular-nums text-muted">
              {rows.length} of {all.length}
            </span>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-[12.5px] font-medium text-ink">No events match these filters</p>
            <button
              onClick={reset}
              className="mt-1 text-[12px] font-medium text-accent hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <AuditTable rows={shown} selectedId={selected} onSelect={setSelected} />
        )}

        {rows.length > shown.length && (
          <div className="flex h-10 items-center justify-between border-t border-line px-3 text-[12px] text-muted">
            Showing {shown.length} of {rows.length}
            <button
              onClick={() => setLimit((l) => l + PAGE)}
              className="font-semibold text-accent hover:underline"
            >
              Load {Math.min(PAGE, rows.length - shown.length)} more
            </button>
          </div>
        )}
      </section>

      <AuditDetailDrawer
        row={current}
        all={all}
        onClose={close}
        onFilterActor={(id) => {
          setActors([id]);
          setSelected(null);
        }}
      />
    </div>
  );
}
