import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronRightIcon, PauseIcon, PlayIcon, SearchIcon } from 'lucide-react';
import { useConsoleData } from '../../contexts/ConsoleContext';
import { Card, CopyButton, EmptyState, MethodTag, StatusCode, ago } from './ConsoleBits';
import type { LogLevel, ServerLog } from '../../utils/consoleMockApi';

const LEVELS: { id: LogLevel | 'debug'; label: string; cls: string }[] = [
  { id: 'debug', label: 'All', cls: '' },
  { id: 'info', label: 'Info+', cls: 'text-info' },
  { id: 'warn', label: 'Warn+', cls: 'text-warn' },
  { id: 'error', label: 'Errors', cls: 'text-bad' },
];

const LEVEL_TAG: Record<LogLevel, string> = {
  debug: 'text-subtle',
  info: 'text-info',
  warn: 'text-warn',
  error: 'text-bad',
};

/** Structured server logs with level filtering, search and expandable stack traces. */
export function LogsView() {
  const [level, setLevel] = useState<LogLevel>('debug');
  const [params] = useSearchParams();
  const [q, setQ] = useState(() => params.get('q') ?? '');
  const [live, setLive] = useState(true);
  const [open, setOpen] = useState<number | null>(null);
  const logs = useConsoleData<ServerLog[]>(
    `/api/system/logs?level=${level}&limit=300${q ? `&q=${encodeURIComponent(q)}` : ''}`,
    [level, q],
  );
  const reload = logs.reload;

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => void reload(), 3000);
    return () => clearInterval(id);
  }, [live, reload]);

  const rows = logs.data ?? [];
  const counts = rows.reduce<Record<string, number>>(
    (acc, l) => ({ ...acc, [l.level]: (acc[l.level] ?? 0) + 1 }),
    {},
  );

  return (
    <div className="mx-auto max-w-[1500px] space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="inline-flex rounded-lg border border-line bg-white p-0.5"
          role="radiogroup"
          aria-label="Minimum level"
        >
          {LEVELS.map((l) => (
            <button
              key={l.id}
              role="radio"
              aria-checked={level === l.id}
              onClick={() => setLevel(l.id)}
              className={`h-7 rounded-md px-2.5 text-[12px] font-medium transition-colors duration-150 ${level === l.id ? 'bg-ink text-canvas' : `text-muted hover:text-ink ${l.cls}`}`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <label className="relative min-w-[180px] flex-1 sm:max-w-xs">
          <span className="sr-only">Search logs</span>
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Message, path or request id"
            className="h-8 w-full rounded-md border border-line bg-white pl-7 pr-2 text-[12px] outline-none focus:border-accent"
          />
        </label>
        <span className="text-[11.5px] text-muted">
          <b className="text-bad">{counts.error ?? 0}</b> errors ·{' '}
          <b className="text-warn">{counts.warn ?? 0}</b> warnings
        </span>
        <button
          onClick={() => setLive((l) => !l)}
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-white px-2.5 text-[12px] font-medium text-muted hover:text-ink"
        >
          {live ? <PauseIcon className="h-3.5 w-3.5" /> : <PlayIcon className="h-3.5 w-3.5" />}{' '}
          {live ? 'Pause' : 'Resume'}
          {live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" />}
        </button>
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState>{logs.error ?? 'No log lines at this level.'}</EmptyState>
        ) : (
          <ul className="divide-y divide-line font-mono text-[11.5px]">
            {rows.map((l) => {
              const isOpen = open === l.seq;
              return (
                <li key={l.seq} className={l.level === 'error' ? 'bg-bad-soft/30' : ''}>
                  <button
                    onClick={() => setOpen(isOpen ? null : l.seq)}
                    aria-expanded={isOpen}
                    className="grid w-full grid-cols-[14px_44px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 text-left hover:bg-sunken/50 md:grid-cols-[14px_64px_44px_46px_minmax(0,220px)_minmax(0,1fr)_44px_52px]"
                  >
                    <ChevronRightIcon
                      className={`h-3 w-3 text-subtle transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`}
                    />
                    <span className="hidden text-subtle md:block">
                      {new Date(l.at).toLocaleTimeString([], { hour12: false })}
                    </span>
                    <span className={`font-semibold uppercase ${LEVEL_TAG[l.level]}`}>
                      {l.level}
                    </span>
                    <span className="hidden md:block">
                      <MethodTag method={l.method} />
                    </span>
                    <span className="hidden truncate md:block">{l.path}</span>
                    <span className="truncate font-sans text-ink">{l.message}</span>
                    <span className="hidden md:block">
                      <StatusCode status={l.status} />
                    </span>
                    <span className="text-right tabular-nums text-subtle">{l.ms}ms</span>
                  </button>
                  {isOpen && (
                    <div className="space-y-2 border-t border-line bg-sunken/40 px-3 py-2.5 pl-8">
                      <dl className="grid grid-cols-[90px_minmax(0,1fr)] gap-x-3 gap-y-0.5 font-sans text-[11.5px]">
                        <dt className="text-subtle">Request id</dt>
                        <dd className="flex items-center gap-2 font-mono">
                          {l.requestId} <CopyButton text={l.requestId} className="h-6" />
                        </dd>
                        <dt className="text-subtle">Route</dt>
                        <dd className="font-mono">
                          {l.method} {l.path}
                        </dd>
                        <dt className="text-subtle">Actor</dt>
                        <dd>{l.actor ?? 'anonymous'}</dd>
                        <dt className="text-subtle">When</dt>
                        <dd>
                          {new Date(l.at).toLocaleString()} · {ago(new Date(l.at).getTime())}
                        </dd>
                      </dl>
                      {l.stack && (
                        <div>
                          <p className="mb-1 font-sans text-[11px] font-semibold text-subtle">
                            Stack trace (source-mapped)
                          </p>
                          <pre className="overflow-x-auto rounded-md border border-line bg-white p-2 text-[11px] leading-[1.6]">
                            {l.stack.split('\n').map((line, i) => (
                              <div
                                key={i}
                                className={
                                  i === 0
                                    ? 'font-semibold text-bad'
                                    : line.includes('backend/src/routes')
                                      ? 'text-ink'
                                      : 'text-subtle'
                                }
                              >
                                {line}
                              </div>
                            ))}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
