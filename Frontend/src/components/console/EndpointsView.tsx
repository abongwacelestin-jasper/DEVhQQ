import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightIcon, SearchIcon } from 'lucide-react';
import { useConsole } from '../../contexts/ConsoleContext';
import { consoleEndpoints } from '../../data/consoleEndpoints';
import { draftFromEndpoint } from '../../utils/consoleDraft';
import { Card, EmptyState, MethodTag, Pill, StatusCode } from './ConsoleBits';
import type { EndpointDef } from '../../types/console';

const METHODS = ['GET', 'POST', 'PATCH', 'DELETE'];
const AUTH_TONE = { public: 'muted', session: 'info', partial: 'warn' } as const;

/** Every route with filters by method, tag and auth; Try loads it into the editor. */
export function EndpointsView() {
  const { setDraft } = useConsole();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [method, setMethod] = useState('');
  const [tag, setTag] = useState('');
  const [auth, setAuth] = useState('');
  const tags = useMemo(() => [...new Set(consoleEndpoints.map((e) => e.tag))].sort(), []);

  const rows = consoleEndpoints.filter(
    (e) =>
      (!q || `${e.path} ${e.summary}`.toLowerCase().includes(q.toLowerCase())) &&
      (!method || e.method === method) &&
      (!tag || e.tag === tag) &&
      (!auth || e.auth === auth),
  );
  const tryIt = (e: EndpointDef) => {
    setDraft(draftFromEndpoint(e));
    navigate('/console/editor');
  };

  return (
    <div className="mx-auto grid max-w-[1400px] gap-3 lg:grid-cols-[200px_minmax(0,1fr)]">
      <aside className="grid content-start gap-3">
        <Card title="Tags">
          <div className="p-1.5">
            {['', ...tags].map((t) => {
              const n = t
                ? consoleEndpoints.filter((e) => e.tag === t).length
                : consoleEndpoints.length;
              return (
                <button
                  key={t || 'all'}
                  onClick={() => setTag(t)}
                  aria-pressed={tag === t}
                  className={`flex h-7 w-full items-center justify-between rounded-md px-2 text-[12px] font-medium capitalize ${tag === t ? 'bg-sunken text-ink' : 'text-muted hover:text-ink'}`}
                >
                  {t || 'All endpoints'}{' '}
                  <span className="text-[11px] tabular-nums text-subtle">{n}</span>
                </button>
              );
            })}
          </div>
        </Card>
      </aside>

      <Card
        title={
          <span>
            {rows.length}{' '}
            <span className="font-normal text-muted">of {consoleEndpoints.length} endpoints</span>
          </span>
        }
        actions={
          <>
            <label className="relative">
              <SearchIcon className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-subtle" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter path or summary"
                aria-label="Filter endpoints"
                className="h-7 w-[200px] rounded-md border border-line-strong bg-white pl-7 pr-2 text-[12px] outline-none focus:border-accent"
              />
            </label>
            <span className="flex gap-0.5">
              {METHODS.map((m) => (
                <button
                  key={m}
                  onClick={() => setMethod(method === m ? '' : m)}
                  aria-pressed={method === m}
                  className={`h-7 rounded-md border px-1.5 ${method === m ? 'border-line-strong bg-sunken' : 'border-transparent hover:bg-sunken'}`}
                >
                  <MethodTag method={m} className="w-auto" />
                </button>
              ))}
            </span>
            <select
              value={auth}
              onChange={(e) => setAuth(e.target.value)}
              aria-label="Auth"
              className="h-7 rounded-md border border-line-strong bg-white px-1.5 text-[12px]"
            >
              <option value="">Any auth</option>
              <option value="public">Public</option>
              <option value="session">Session</option>
              <option value="partial">Partial (pre-MFA)</option>
            </select>
          </>
        }
      >
        {rows.length ? (
          <ul className="divide-y divide-line">
            {rows.map((e) => (
              <li
                key={e.method + e.path}
                className="grid grid-cols-1 items-center gap-x-4 gap-y-1 px-3 py-2 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto]"
              >
                <div className="flex min-w-0 items-center">
                  <MethodTag method={e.method} />
                  <span className="truncate font-mono text-[12px]">
                    {e.path.split(/(:[a-zA-Z]+)/).map((s, i) =>
                      s.startsWith(':') ? (
                        <span key={i} className="text-warn">
                          {s}
                        </span>
                      ) : (
                        s
                      ),
                    )}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[12px] text-muted">{e.summary}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    <Pill tone={AUTH_TONE[e.auth]}>{e.auth}</Pill>
                    {e.codes.map((c) => (
                      <StatusCode key={c} status={c} />
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => tryIt(e)}
                  className="inline-flex h-7 items-center gap-1 justify-self-start rounded-md border border-line px-2.5 text-[11.5px] font-medium text-muted hover:bg-sunken hover:text-ink md:justify-self-end"
                >
                  Try <ArrowRightIcon className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>No endpoints match these filters.</EmptyState>
        )}
      </Card>
    </div>
  );
}
