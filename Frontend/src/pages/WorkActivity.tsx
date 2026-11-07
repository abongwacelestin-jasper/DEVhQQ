import { useLanguage } from '../contexts/LanguageContext';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DownloadIcon, SearchIcon } from 'lucide-react';
import { Panel } from '../components/ui/Panel';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { ProductMark } from '../components/ui/ProductMark';
import { TimelineIllustration } from '../components/illustrations/TimelineIllustration';
import { EmptyIllustration } from '../components/illustrations/EmptyIllustration';
import { useWork } from '../contexts/WorkContext';
import { useDateRange } from '../contexts/DateRangeContext';
import { useProductFilter } from '../contexts/ProductFilterContext';
import { useDirectory } from '../components/team/useDirectory';
import { useTaskInsights } from '../components/work/useTaskInsights';
import { TaskInsightBadge } from '../components/work/TaskInsightBadge';
import { NOW, addDays, formatDay, formatDayHeading, formatTime, startOfDay } from '../utils/date';
import { describeEvent, eventKindLabel, formatMinutes } from '../utils/taskEvents';
import type { TaskEventKind } from '../types/work';

const kinds = Object.keys(eventKindLabel) as TaskEventKind[];

/** RFC 4180 quoting; a leading =,+,-,@ is prefixed so spreadsheets don't evaluate it. */
const csvCell = (v: string) => {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function WorkActivity() {
  const { heading } = useLanguage();
  const { events, tasks } = useWork();
  const { inRange, from, to, label } = useDateRange();
  const { matchesTask } = useProductFilter();
  const { members, memberById } = useDirectory();
  const [params, setParams] = useSearchParams();
  const member = params.get('member') ?? '';
  const kind = (params.get('kind') ?? '') as TaskEventKind | '';
  const q = params.get('q') ?? '';

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const taskByKey = useMemo(() => new Map(tasks.map((t) => [t.key, t])), [tasks]);

  const rows = useMemo(
    () =>
      events
        .filter((e) => {
          const t = taskByKey.get(e.taskKey);
          if (!t || !matchesTask(t) || !inRange(new Date(e.at))) return false;
          if (member && e.actor !== member) return false;
          if (kind && e.kind !== kind) return false;
          if (
            q &&
            !`${e.taskKey} ${t.title} ${describeEvent(e)} ${e.note ?? ''}`
              .toLowerCase()
              .includes(q.toLowerCase())
          )
            return false;
          return true;
        })
        .sort((a, b) => b.at.localeCompare(a.at)),
    [events, taskByKey, matchesTask, inRange, member, kind, q],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, typeof rows>();
    rows.forEach((e) => {
      const k = startOfDay(new Date(e.at)).toISOString();
      map.set(k, [...(map.get(k) ?? []), e]);
    });
    return [...map.entries()];
  }, [rows]);

  // Daily bars: up to the last 21 days of the selected range, capped at today.
  const end = startOfDay(to < NOW ? to : NOW);
  const start = from > addDays(end, -20) ? startOfDay(from) : addDays(end, -20);
  const days: { d: Date; n: number }[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const key = d.getTime();
    days.push({ d, n: rows.filter((e) => startOfDay(new Date(e.at)).getTime() === key).length });
  }
  const max = Math.max(1, ...days.map((x) => x.n));

  const stats = [
    { label: 'Events', value: rows.length },
    { label: 'Tasks created', value: rows.filter((e) => e.kind === 'created').length },
    {
      label: 'Completed',
      value: rows.filter((e) => e.kind === 'status' && e.to === 'done').length,
      tone: 'text-ok',
    },
    { label: 'Reassignments', value: rows.filter((e) => e.kind === 'assignee' && e.from).length },
    {
      label: 'Time logged',
      value: formatMinutes(
        rows.filter((e) => e.kind === 'time').reduce((s, e) => s + Number(e.to ?? 0), 0),
      ),
    },
  ];

  const people = members.filter((m) => m.status === 'active');

  // ETA / overdue-risk for open tasks in view (first 40, so a wide range doesn't fan out requests).
  const openKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const e of rows) {
      const t = taskByKey.get(e.taskKey);
      if (t && t.status !== 'done') keys.add(t.key);
      if (keys.size >= 40) break;
    }
    return [...keys];
  }, [rows, taskByKey]);
  const insights = useTaskInsights(openKeys);

  const exportCsv = () => {
    const header = ['time', 'actor', 'task', 'title', 'change', 'note'];
    const lines = rows.map((e) =>
      [
        e.at,
        memberById(e.actor).name,
        e.taskKey,
        taskByKey.get(e.taskKey)?.title ?? '',
        describeEvent(e),
        e.note ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
    const blob = new Blob([[header.join(','), ...lines].join('\r\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `devhq-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const topPeople = people
    .map((m) => ({ m, n: rows.filter((e) => e.actor === m.id).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 6);

  return (
    <div className="space-y-3.5">
      <section className="grid items-center gap-3 overflow-hidden rounded-lg border border-line bg-sunken/40 px-3.5 py-3 md:grid-cols-[auto_minmax(0,1fr)] lg:grid-cols-[auto_minmax(0,1fr)_auto]">
        <TimelineIllustration className="hidden h-[84px] w-auto md:block" />
        <div className="min-w-0">
          <h1 className="text-[17px] font-semibold tracking-tight text-ink">
            {heading('Work activity')}
          </h1>
          <p className="mt-0.5 text-[12.5px] text-muted">
            An append-only record of every task change — who did what, and exactly when. {label}.
          </p>
          <Button
            size="sm"
            className="mt-2"
            icon={<DownloadIcon className="h-3.5 w-3.5" />}
            onClick={exportCsv}
            disabled={rows.length === 0}
          >
            Export CSV
          </Button>
        </div>
        <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-5 md:col-span-2 xl:col-span-1">
          {stats.map((s) => (
            <div key={s.label} className="min-w-0 bg-white px-3 py-1.5">
              <dt className="truncate text-[11px] font-medium text-muted">{s.label}</dt>
              <dd className={`text-[16px] font-semibold tabular-nums ${s.tone ?? 'text-ink'}`}>
                {s.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Panel
          title="Events per day"
          meta={
            <span>
              {days.length > 0
                ? `${formatDay(days[0].d)} – ${formatDay(days[days.length - 1].d)}`
                : '—'}
            </span>
          }
        >
          <div
            className="flex h-28 items-end gap-1 px-3.5 pb-2 pt-3"
            role="img"
            aria-label="Bar chart of task events per day"
          >
            {days.map((x) => (
              <div
                key={x.d.getTime()}
                className="group relative flex h-full min-w-0 flex-1 flex-col justify-end"
              >
                <div
                  className={`w-full rounded-t ${x.n ? 'bg-accent' : 'bg-sunken'}`}
                  style={{ height: `${Math.max(4, (x.n / max) * 100)}%` }}
                />
                <span className="pointer-events-none absolute -top-5 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink px-1.5 py-0.5 text-[10.5px] text-white group-hover:block">
                  {formatDay(x.d)} · {x.n}
                </span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Most active" meta={<span>{label}</span>}>
          <ul className="divide-y divide-line">
            {topPeople.map(({ m, n }) => (
              <li key={m.id}>
                <button
                  onClick={() => setParam('member', member === m.id ? '' : m.id)}
                  className={`flex w-full items-center gap-2 px-3.5 py-1.5 text-left hover:bg-sunken/50 ${member === m.id ? 'bg-accent-soft/50' : ''}`}
                >
                  <Avatar id={m.id} size="xs" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
                    {m.name}
                  </span>
                  <span className="text-[12px] font-semibold tabular-nums text-ink">{n}</span>
                </button>
              </li>
            ))}
            {topPeople.length === 0 && (
              <li className="px-3.5 py-3 text-[12.5px] text-muted">No activity.</li>
            )}
          </ul>
        </Panel>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <label className="relative min-w-0 flex-1 basis-44 sm:max-w-[240px]">
          <span className="sr-only">Search activity</span>
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setParam('q', e.target.value)}
            placeholder="Search tasks or notes…"
            className="h-7 w-full rounded-md border border-line bg-white pl-7 pr-2 text-[12px] text-ink outline-none placeholder:text-subtle focus:border-accent"
          />
        </label>
        <select
          aria-label="Person"
          value={member}
          onChange={(e) => setParam('member', e.target.value)}
          className="h-7 rounded-md border border-line bg-white px-1.5 text-[12px] text-ink"
        >
          <option value="">Everyone</option>
          {people.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Event type"
          value={kind}
          onChange={(e) => setParam('kind', e.target.value)}
          className="h-7 rounded-md border border-line bg-white px-1.5 text-[12px] text-ink"
        >
          <option value="">All changes</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {eventKindLabel[k]}
            </option>
          ))}
        </select>
        <span className="ml-auto text-[11.5px] tabular-nums text-muted">{rows.length} events</span>
      </div>

      {grouped.length === 0 ? (
        <div className="flex flex-col items-center rounded-lg border border-line px-4 py-10 text-center">
          <EmptyIllustration className="h-20 w-auto" />
          <p className="mt-2 text-[13px] font-medium text-ink">No activity matches</p>
          <p className="text-[12px] text-muted">Try a wider date range or clear the filters.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line">
          {grouped.map(([day, list]) => (
            <section key={day} aria-label={formatDayHeading(new Date(day))}>
              <h2 className="sticky top-12 z-10 flex items-center gap-2 border-b border-line bg-sunken px-3.5 py-1.5 text-[11.5px] font-semibold text-ink">
                {formatDayHeading(new Date(day))}
                <span className="font-medium tabular-nums text-muted">{list.length}</span>
              </h2>
              <ol className="divide-y divide-line">
                {list.map((e) => {
                  const t = taskByKey.get(e.taskKey);
                  return (
                    <li
                      key={e.id}
                      className="grid grid-cols-[44px_minmax(0,1fr)] items-start gap-x-3 gap-y-0.5 px-3.5 py-1.5 md:grid-cols-[44px_150px_minmax(0,1fr)_minmax(0,220px)] md:items-center"
                    >
                      <time
                        dateTime={e.at}
                        className="pt-px font-mono text-[11.5px] tabular-nums text-muted"
                      >
                        {formatTime(new Date(e.at))}
                      </time>
                      <Link
                        to={`/team/${e.actor}`}
                        className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold text-ink hover:underline"
                      >
                        <Avatar id={e.actor} size="xs" />
                        <span className="truncate">{memberById(e.actor).name}</span>
                      </Link>
                      <p className="col-start-2 min-w-0 text-[12.5px] text-ink md:col-start-auto">
                        <span className="text-muted">{describeEvent(e)}</span>
                        {e.note && e.kind !== 'subtask' && (
                          <span className="ml-1 text-muted">— “{e.note}”</span>
                        )}
                      </p>
                      {t && (
                        <Link
                          to={`/tasks/${t.key}`}
                          className="col-start-2 flex min-w-0 items-center gap-1.5 text-[12px] hover:underline md:col-start-auto"
                        >
                          <ProductMark product={t.product} size="sm" />
                          <span className="font-mono font-medium text-accent">{t.key}</span>
                          <span className="truncate text-ink">{t.title}</span>
                          {insights.available && t.status !== 'done' && (
                            <TaskInsightBadge insight={insights.get(t.key)} />
                          )}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
