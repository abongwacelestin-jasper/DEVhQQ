import { useMemo, useState } from 'react';
import {
  BugIcon,
  CheckCircle2Icon,
  GaugeIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useConsoleData } from '../../contexts/ConsoleContext';
import { Card, CopyButton, EmptyState, MethodTag, Pill, StatusCode, ago } from './ConsoleBits';
import type { ConsoleMetrics } from '../../types/console';
import type { ServerLog } from '../../utils/consoleMockApi';

interface Issue {
  fingerprint: string;
  title: string;
  level: 'error' | 'warn';
  route: string;
  status: number;
  count: number;
  first: string;
  last: string;
  actors: Set<string>;
  sample: ServerLog;
  /** Occurrences per 10-minute bucket, oldest → newest (last 2h). */
  buckets: number[];
}

/** p95 above this, or p95 more than 3× p50, is flagged as a latency anomaly. */
const SLOW_P95_MS = 150;

/** Groups failing requests into issues with history, breadcrumbs and stack traces; flags slow routes. */
export function ErrorsView() {
  const logs = useConsoleData<ServerLog[]>('/api/system/logs?level=warn&limit=1000');
  const all = useConsoleData<ServerLog[]>('/api/system/logs?limit=1000');
  const metrics = useConsoleData<ConsoleMetrics>('/api/system/metrics');
  const [selected, setSelected] = useState<string | null>(null);
  const [showWarn, setShowWarn] = useState(false);

  const issues = useMemo(() => {
    const map = new Map<string, Issue>();
    const now = Date.now();
    for (const l of logs.data ?? []) {
      if (l.level !== 'error' && !(showWarn && l.level === 'warn')) continue;
      // Fingerprint: route shape + message without ids/numbers.
      const route = `${l.method} ${l.path.replace(/\/[A-Z]{2}-\d+|\/dp-\d+|\/INC-\d+|\/[0-9a-f]{8,}/g, '/:id')}`;
      const fp = `${route}|${l.message.replace(/\d+/g, '#')}`;
      const bucket = Math.max(0, 11 - Math.floor((now - new Date(l.at).getTime()) / 600_000));
      const cur = map.get(fp);
      if (!cur) {
        const buckets = Array(12).fill(0);
        if (bucket >= 0 && bucket < 12) buckets[bucket]++;
        map.set(fp, {
          fingerprint: fp,
          title: l.message,
          level: l.level as 'error' | 'warn',
          route,
          status: l.status,
          count: 1,
          first: l.at,
          last: l.at,
          actors: new Set(l.actor ? [l.actor] : []),
          sample: l,
          buckets,
        });
      } else {
        cur.count++;
        if (l.at < cur.first) cur.first = l.at;
        if (l.at > cur.last) {
          cur.last = l.at;
          if (l.stack || !cur.sample.stack) cur.sample = l;
        }
        if (l.actor) cur.actors.add(l.actor);
        if (bucket < 12) cur.buckets[bucket]++;
      }
    }
    return [...map.values()].sort(
      (a, b) =>
        Number(b.level === 'error') - Number(a.level === 'error') || b.last.localeCompare(a.last),
    );
  }, [logs.data, showWarn]);

  const slow = (metrics.data?.routes ?? [])
    .filter((r) => r.count >= 1 && (r.p95 > SLOW_P95_MS || (r.p50 > 0 && r.p95 / r.p50 > 3)))
    .sort((a, b) => b.p95 - a.p95);
  const current = issues.find((i) => i.fingerprint === selected) ?? issues[0] ?? null;

  // Breadcrumbs: the same actor's requests in the minutes before the failure.
  const crumbs = useMemo(() => {
    if (!current) return [];
    const at = new Date(current.sample.at).getTime();
    return (all.data ?? [])
      .filter(
        (l) =>
          l.actor === current.sample.actor &&
          new Date(l.at).getTime() <= at &&
          at - new Date(l.at).getTime() < 15 * 60_000 &&
          l.seq !== current.sample.seq,
      )
      .slice(0, 8)
      .reverse();
  }, [current, all.data]);

  const reload = () => {
    void logs.reload();
    void all.reload();
    void metrics.reload();
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[12px] text-muted">
          <b className="text-bad">{issues.filter((i) => i.level === 'error').length}</b> error
          issues · <b className={slow.length ? 'text-warn' : 'text-ink'}>{slow.length}</b> slow
          routes
        </p>
        <label className="ml-auto flex items-center gap-1.5 text-[12px] text-muted">
          <input
            type="checkbox"
            checked={showWarn}
            onChange={(e) => setShowWarn(e.target.checked)}
          />{' '}
          Include 4xx warnings
        </label>
        <button
          onClick={reload}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-line bg-white px-2 text-[12px] font-medium text-muted hover:text-ink"
        >
          <RefreshCwIcon className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {slow.length > 0 && (
        <Card
          title={
            <span className="inline-flex items-center gap-1.5">
              <GaugeIcon className="h-3.5 w-3.5 text-warn" /> Latency anomalies
            </span>
          }
        >
          <ul className="grid divide-y divide-line md:grid-cols-2 md:divide-y-0">
            {slow.slice(0, 6).map((r) => (
              <li
                key={r.route}
                className="flex items-center gap-2 px-3 py-1.5 text-[11.5px] md:border-b md:border-line"
              >
                <span className="min-w-0 flex-1 truncate font-mono">{r.route}</span>
                <span className="tabular-nums text-subtle">p50 {r.p50}ms</span>
                <Pill tone={r.p95 > SLOW_P95_MS * 1.5 ? 'bad' : 'warn'}>p95 {r.p95}ms</Pill>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Card title="Issues" className="self-start">
          {issues.length === 0 ? (
            <EmptyState>
              <CheckCircle2Icon className="mx-auto mb-1.5 h-5 w-5 text-ok" />
              No failures recorded. Send a request that errors to see it grouped here.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {issues.map((i) => {
                const on = current?.fingerprint === i.fingerprint;
                const max = Math.max(1, ...i.buckets);
                return (
                  <li key={i.fingerprint}>
                    <button
                      onClick={() => setSelected(i.fingerprint)}
                      aria-pressed={on}
                      className={`grid w-full grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-2 px-3 py-2 text-left ${on ? 'bg-sunken/70' : 'hover:bg-sunken/40'}`}
                    >
                      {i.level === 'error' ? (
                        <BugIcon className="mt-0.5 h-3.5 w-3.5 text-bad" />
                      ) : (
                        <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 text-warn" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-[12.5px] font-medium text-ink">
                          {i.title}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-subtle">
                          {i.route}
                        </span>
                        <span className="mt-0.5 block text-[10.5px] text-subtle">
                          first {ago(i.first)} · last {ago(i.last)} · {i.actors.size} user
                          {i.actors.size === 1 ? '' : 's'}
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        <span className="text-[13px] font-semibold tabular-nums text-ink">
                          {i.count}×
                        </span>
                        <span
                          className="flex h-4 items-end gap-px"
                          aria-label="Occurrences over the last 2 hours"
                        >
                          {i.buckets.map((b, k) => (
                            <span
                              key={k}
                              className={`w-[3px] rounded-[1px] ${b ? (i.level === 'error' ? 'bg-bad' : 'bg-warn') : 'bg-line'}`}
                              style={{ height: `${b ? Math.max(25, (b / max) * 100) : 12}%` }}
                            />
                          ))}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {current && (
          <Card title="Issue detail" className="self-start lg:sticky lg:top-0">
            <div className="space-y-3 p-3">
              <div>
                <p className="text-[13px] font-semibold text-ink">{current.title}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
                  <StatusCode status={current.status} />{' '}
                  <span className="font-mono">{current.route}</span> · {current.count} occurrence
                  {current.count === 1 ? '' : 's'}
                </p>
              </div>
              <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[11.5px]">
                <dt className="text-subtle">Last request</dt>
                <dd className="flex items-center gap-2 font-mono">
                  {current.sample.requestId}
                  <CopyButton text={current.sample.requestId} className="h-6" />
                </dd>
                <dt className="text-subtle">First seen</dt>
                <dd>{new Date(current.first).toLocaleString()}</dd>
                <dt className="text-subtle">Last seen</dt>
                <dd>{new Date(current.last).toLocaleString()}</dd>
              </dl>
              <div>
                <p className="mb-1 text-[11px] font-semibold text-subtle">Stack trace</p>
                {current.sample.stack ? (
                  <pre className="scroll-thin overflow-x-auto rounded-md border border-line bg-canvas p-2 font-mono text-[11px] leading-[1.6]">
                    {current.sample.stack.split('\n').map((line, k) => {
                      const m = /\((.+?):(\d+):(\d+)\)/.exec(line);
                      const ours = m?.[1].startsWith('backend/src/routes');
                      return (
                        <div
                          key={k}
                          className={
                            k === 0 ? 'font-semibold text-bad' : ours ? 'text-ink' : 'text-subtle'
                          }
                        >
                          {line}
                          {ours && (
                            <span className="ml-2 rounded bg-accent-soft px-1 text-[10px] text-accent-ink">
                              your code
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </pre>
                ) : (
                  <p className="rounded-md bg-sunken px-2 py-1.5 text-[11.5px] text-muted">
                    Handled error — no stack. The response body carried{' '}
                    <code className="font-mono">{current.title.split(':')[0]}</code>.
                  </p>
                )}
              </div>
              <div>
                <p className="mb-1 text-[11px] font-semibold text-subtle">
                  Breadcrumbs · same user, 15 min before
                </p>
                {crumbs.length === 0 ? (
                  <p className="text-[11.5px] text-muted">No earlier requests from this user.</p>
                ) : (
                  <ol className="relative space-y-1 border-l border-line pl-3">
                    {crumbs.map((c) => (
                      <li key={c.seq} className="flex items-center gap-2 text-[11.5px]">
                        <span
                          className={`absolute -left-[3.5px] h-1.5 w-1.5 rounded-full ${c.level === 'error' ? 'bg-bad' : c.level === 'warn' ? 'bg-warn' : 'bg-line-strong'}`}
                        />
                        <span className="w-14 shrink-0 font-mono text-subtle">
                          {new Date(c.at).toLocaleTimeString([], { hour12: false })}
                        </span>
                        <MethodTag method={c.method} />
                        <span className="min-w-0 flex-1 truncate font-mono">{c.path}</span>
                        <StatusCode status={c.status} />
                      </li>
                    ))}
                    <li className="flex items-center gap-2 text-[11.5px] font-semibold text-bad">
                      <span className="absolute -left-[3.5px] h-1.5 w-1.5 rounded-full bg-bad" />
                      <span className="w-14 shrink-0 font-mono">
                        {new Date(current.sample.at).toLocaleTimeString([], { hour12: false })}
                      </span>
                      Failure
                    </li>
                  </ol>
                )}
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
