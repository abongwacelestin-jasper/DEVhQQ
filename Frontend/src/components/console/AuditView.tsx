import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCwIcon, ShieldAlertIcon, ShieldCheckIcon } from 'lucide-react';
import { useConsoleData } from '../../contexts/ConsoleContext';
import { Card, CopyButton, EmptyState, Pill, ago } from './ConsoleBits';
import type { AuditRow, GeoLocation } from '../../types/console';

interface Verify {
  ok: boolean;
  entries: number;
  head?: string;
  brokenAt?: number;
}
interface SessionRow {
  id: string;
  memberId: string;
  startedAt: string;
  lastSeen: string;
  ip: string;
  method: string;
  location: GeoLocation;
  current: boolean;
}
interface Member {
  id: string;
  name: string;
  role: string;
}

/** Hash-chained audit trail beside the live sessions it records. */
export function AuditView() {
  const [params] = useSearchParams();
  const [action, setAction] = useState(() => params.get('action') ?? '');
  const [sensitive, setSensitive] = useState(false);
  const audit = useConsoleData<AuditRow[]>(
    `/api/audit?limit=200${sensitive ? '&sensitive=1' : ''}${action ? `&action=${encodeURIComponent(action)}` : ''}`,
  );
  const verify = useConsoleData<Verify>('/api/audit/verify');
  const sessions = useConsoleData<SessionRow[]>('/api/locations/sessions');
  const team = useConsoleData<Member[]>('/api/team');
  const name = (id: string) => team.data?.find((m) => m.id === id)?.name ?? id;
  const v = verify.data;

  return (
    <div className="mx-auto grid max-w-[1500px] gap-3 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-3">
        <div
          className={`flex flex-wrap items-center gap-2.5 rounded-xl border px-3.5 py-2.5 ${v && !v.ok ? 'border-bad/40 bg-bad-soft' : 'border-line bg-white'}`}
        >
          {v && !v.ok ? (
            <ShieldAlertIcon className="h-4 w-4 text-bad" />
          ) : (
            <ShieldCheckIcon className="h-4 w-4 text-ok" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-semibold">
              {!v
                ? 'Verifying chain…'
                : v.ok
                  ? 'Hash chain intact'
                  : `Chain broken at entry #${v.brokenAt}`}
            </p>
            <p className="truncate text-[11.5px] text-muted">
              {v?.ok
                ? `${v.entries} entries · each links to the previous one, so any edit or deletion is detectable`
                : 'Investigate immediately — history may have been altered'}
            </p>
          </div>
          <button
            onClick={() => void verify.reload()}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[11.5px] font-medium text-muted hover:bg-sunken hover:text-ink"
          >
            <RefreshCwIcon className="h-3.5 w-3.5" /> Re-verify
          </button>
        </div>

        <Card
          title="Audit trail"
          actions={
            <>
              <input
                value={action}
                onChange={(e) => setAction(e.target.value)}
                placeholder="Action prefix, e.g. auth."
                aria-label="Action prefix"
                className="h-7 w-[180px] rounded-md border border-line-strong bg-white px-2 font-mono text-[11.5px] outline-none focus:border-accent"
              />
              <label className="flex items-center gap-1.5 text-[11.5px] text-muted">
                <input
                  type="checkbox"
                  checked={sensitive}
                  onChange={(e) => setSensitive(e.target.checked)}
                />{' '}
                Sensitive only
              </label>
            </>
          }
        >
          {audit.data?.length ? (
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-[620px] text-[12px]">
                <thead className="text-left text-[11px] text-subtle">
                  <tr className="border-b border-line">
                    {['#', 'When', 'Actor', 'Action', 'Target', 'Hash'].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {audit.data.map((e) => (
                    <tr key={e.seq} className="border-b border-line last:border-0">
                      <td className="px-3 py-1.5 font-mono text-subtle">{e.seq}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-subtle">{ago(e.at)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">{name(e.actor)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">
                        <span className="font-mono text-[11.5px]">{e.action}</span>{' '}
                        {e.sensitive && <Pill tone="warn">sensitive</Pill>}
                      </td>
                      <td className="max-w-[280px] truncate px-3 py-1.5 text-muted">{e.target}</td>
                      <td className="px-3 py-1.5">
                        <CopyButton
                          text={e.hash}
                          label={e.hash.slice(0, 8)}
                          className="h-6 font-mono"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState>No entries match.</EmptyState>
          )}
        </Card>
      </div>

      <Card
        title={
          <span>
            Live sessions{' '}
            <span className="font-normal text-subtle">{sessions.data?.length ?? 0}</span>
          </span>
        }
        className="self-start"
        actions={
          <button
            onClick={() => void sessions.reload()}
            aria-label="Refresh sessions"
            className="grid h-7 w-7 place-items-center rounded-md text-subtle hover:bg-sunken hover:text-ink"
          >
            <RefreshCwIcon className="h-3.5 w-3.5" />
          </button>
        }
      >
        {sessions.data?.length ? (
          <ul className="divide-y divide-line">
            {sessions.data.map((s) => (
              <li key={s.id} className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                    {name(s.memberId)}
                  </p>
                  {s.current && <Pill tone="info">this console</Pill>}
                  <Pill>{s.method}</Pill>
                </div>
                <p className="mt-0.5 text-[11.5px] text-muted">
                  {s.location.city}, {s.location.country} ·{' '}
                  <span className="font-mono">{s.ip}</span>
                </p>
                <p className="text-[11px] text-subtle">
                  Started {ago(s.startedAt)} · last seen {ago(s.lastSeen)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>No live sessions.</EmptyState>
        )}
      </Card>
    </div>
  );
}
