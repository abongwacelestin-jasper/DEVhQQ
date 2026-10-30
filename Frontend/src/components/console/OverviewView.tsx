import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ActivityIcon, ArrowRightIcon, RefreshCwIcon } from 'lucide-react';
import { useConsole, useConsoleData } from '../../contexts/ConsoleContext';
import { consoleEndpoints } from '../../data/consoleEndpoints';
import { draftFromEndpoint } from '../../utils/consoleDraft';
import { Card, EmptyState, MethodTag, Pill, StatusCode, ago, fmtMs } from './ConsoleBits';
import type { AuditRow, ConsoleMetrics } from '../../types/console';

const uptime = (s: number) =>
  s >= 3600
    ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
    : `${Math.floor(s / 60)}m ${s % 60}s`;

/** Health at a glance: one primary status, supporting numbers, traffic by route and recent audit. */
export function OverviewView() {
  const { setDraft, call, history } = useConsole();
  const navigate = useNavigate();
  const metrics = useConsoleData<ConsoleMetrics>('/api/system/metrics');
  const audit = useConsoleData<AuditRow[]>('/api/audit?limit=8');

  const reloadMetrics = metrics.reload;
  useEffect(() => {
    const id = setInterval(() => void reloadMetrics(), 6000);
    return () => clearInterval(id);
  }, [reloadMetrics]);

  const warmUp = async () => {
    for (const url of [
      '/api/tasks',
      '/api/team',
      '/api/deployments',
      '/api/incidents',
      '/api/tasks/RB-999',
      '/api/locations/summary',
    ])
      await call('GET', url);
    await call('POST', '/api/tasks', JSON.stringify({ projectId: 'p1', title: 'x' }));
    void metrics.reload();
  };

  const m = metrics.data;
  const by = (d: string) =>
    m
      ? Object.entries(m.statuses)
          .filter(([k]) => k[0] === d)
          .reduce((n, [, x]) => n + x, 0)
      : 0;
  const total = m?.totalRequests ?? 0;
  const e4 = by('4');
  const e5 = by('5');
  const okN = total - e4 - e5;
  const errRate = total ? (e5 / total) * 100 : 0;
  const p95 = m?.routes.length ? Math.max(...m.routes.map((r) => r.p95)) : 0;
  const open = (method: string, route: string) => {
    const ep = consoleEndpoints.find((e) => e.method === method && e.path === route);
    if (ep) {
      setDraft(draftFromEndpoint(ep));
      navigate('/console/editor');
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-3">
      {/* Primary status + supporting numbers on one row */}
      <section className="grid gap-3 rounded-xl border border-line bg-white p-4 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))] lg:divide-x lg:divide-line lg:p-0">
        <div className="lg:p-4">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${errRate < 1 ? 'bg-ok' : errRate < 5 ? 'bg-warn' : 'bg-bad'}`}
            />
            <span className="text-[11.5px] font-medium text-muted">Service health</span>
            {m && (
              <Pill tone={m.audit.chain === 'intact' ? 'ok' : 'bad'}>
                audit chain {m.audit.chain}
              </Pill>
            )}
          </div>
          <p className="mt-1 text-[24px] font-semibold tracking-tight">
            {!m ? '—' : errRate < 1 ? 'Operational' : errRate < 5 ? 'Degraded' : 'Failing'}
          </p>
          <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
            {total > 0 && (
              <>
                <i className="bg-ok" style={{ width: `${(okN / total) * 100}%` }} />
                <i className="bg-warn" style={{ width: `${(e4 / total) * 100}%` }} />
                <i className="bg-bad" style={{ width: `${(e5 / total) * 100}%` }} />
              </>
            )}
          </div>
          <p className="mt-1.5 text-[11.5px] text-subtle">
            {total.toLocaleString()} requests · {okN} ok · {e4} client errors · {e5} server errors
          </p>
        </div>
        {[
          ['Worst p95', m ? fmtMs(p95) : '—', `${m?.routes.length ?? 0} active routes`],
          ['Uptime', m ? uptime(m.uptimeSec) : '—', `${m?.sessions.active ?? 0} live sessions`],
          [
            'Memory',
            m ? `${m.memoryMb.heapUsed} MB` : '—',
            m ? `${m.memoryMb.rss} MB resident` : '',
          ],
        ].map(([l, v, s]) => (
          <div key={l} className="lg:p-4">
            <p className="text-[11.5px] font-medium text-muted">{l}</p>
            <p className="mt-1 text-[18px] font-semibold tabular-nums">{v}</p>
            <p className="text-[11.5px] text-subtle">{s}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Card
          title="Traffic by route"
          actions={
            <>
              <span className="text-[11px] text-subtle">refreshes every 6s</span>
              <button
                onClick={() => void metrics.reload()}
                aria-label="Refresh"
                className="grid h-7 w-7 place-items-center rounded-md text-subtle hover:bg-sunken hover:text-ink"
              >
                <RefreshCwIcon className="h-3.5 w-3.5" />
              </button>
            </>
          }
        >
          {m && m.routes.length ? (
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-[560px] text-[12px]">
                <thead className="text-left text-[11px] text-subtle">
                  <tr className="border-b border-line">
                    <th className="px-3 py-2 font-medium">Route</th>
                    <th className="px-3 py-2 text-right font-medium">Calls</th>
                    <th className="px-3 py-2 text-right font-medium">p50</th>
                    <th className="px-3 py-2 text-right font-medium">p95</th>
                    <th className="px-3 py-2 font-medium">Responses</th>
                  </tr>
                </thead>
                <tbody>
                  {m.routes.slice(0, 14).map((r) => {
                    const [method, path] = r.route.split(' ');
                    return (
                      <tr
                        key={r.route}
                        onClick={() => open(method, path)}
                        className="cursor-pointer border-b border-line last:border-0 hover:bg-sunken/50"
                      >
                        <td className="px-3 py-1.5">
                          <span className="flex items-center">
                            <MethodTag method={method} />
                            <span className="truncate font-mono text-[11.5px]">{path}</span>
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.count}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted">
                          {fmtMs(r.p50)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                          {fmtMs(r.p95)}
                        </td>
                        <td className="px-3 py-1.5">
                          <span className="flex flex-wrap gap-1">
                            {Object.entries(r.statuses).map(([c, n]) => (
                              <span key={c} className="inline-flex items-center gap-0.5">
                                <StatusCode status={Number(c)} />
                                <span className="text-[10.5px] text-subtle">×{n}</span>
                              </span>
                            ))}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState>
              <ActivityIcon className="mx-auto mb-2 h-5 w-5 text-subtle" />
              No traffic recorded yet.
              <div className="mt-3 flex justify-center gap-2">
                <button
                  onClick={warmUp}
                  className="h-8 rounded-md bg-ink px-3 text-[12px] font-semibold text-canvas hover:opacity-90"
                >
                  Send sample traffic
                </button>
                <button
                  onClick={() => navigate('/console/editor')}
                  className="h-8 rounded-md border border-line-strong px-3 text-[12px] font-medium hover:bg-sunken"
                >
                  Open editor
                </button>
              </div>
            </EmptyState>
          )}
        </Card>

        <div className="grid content-start gap-3">
          <Card
            title="Recent audit"
            actions={
              <button
                onClick={() => navigate('/console/audit')}
                className="inline-flex items-center gap-1 text-[11.5px] font-medium text-muted hover:text-ink"
              >
                All <ArrowRightIcon className="h-3 w-3" />
              </button>
            }
          >
            <ul className="divide-y divide-line">
              {(audit.data ?? []).map((e) => (
                <li key={e.seq} className="flex items-start gap-2 px-3 py-2">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${e.sensitive ? 'bg-warn' : 'bg-line-strong'}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[11.5px] text-ink">{e.action}</p>
                    <p className="truncate text-[11.5px] text-muted">{e.target}</p>
                  </div>
                  <span className="shrink-0 text-[10.5px] text-subtle">{ago(e.at)}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Your recent requests">
            {history.length ? (
              <ul className="divide-y divide-line">
                {history.slice(0, 5).map((h) => (
                  <li key={h.id} className="flex items-center gap-2 px-3 py-1.5 text-[11.5px]">
                    <MethodTag method={h.method} />
                    <span className="min-w-0 flex-1 truncate font-mono">{h.url}</span>
                    <StatusCode status={h.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState>Requests you send from the editor appear here.</EmptyState>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
