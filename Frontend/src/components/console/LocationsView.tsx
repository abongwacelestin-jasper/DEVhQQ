import { useState } from 'react';
import { LoaderCircleIcon } from 'lucide-react';
import { useConsole, useConsoleData } from '../../contexts/ConsoleContext';
import { errorMessage } from '../../utils/consoleClient';
import { Card, EmptyState, Pill, ago } from './ConsoleBits';
import type { SignInRow } from '../../types/console';

interface Summary {
  total: number;
  countries: {
    countryCode: string;
    country: string;
    total: number;
    risky: number;
    cities: string[];
  }[];
}
interface Me {
  ip: string;
  city: string;
  country: string;
  network: string;
}
interface Lookup {
  ip: string;
  city: string;
  country: string;
  network: string;
  risk: { score: number; reasons: string[]; decision: string };
}
interface Member {
  id: string;
  name: string;
}

const SAMPLE_IPS = [
  ['185.220.101.4', 'Tor'],
  ['104.28.7.30', 'VPN'],
  ['52.14.3.9', 'Datacenter'],
  ['133.32.10.4', 'Tokyo'],
];
const RESULT_TONE = { success: 'ok', challenged: 'warn', failed: 'bad', blocked: 'bad' } as const;

function RiskMeter({ score }: { score: number }) {
  const tone = score >= 70 ? 'bg-bad' : score >= 40 ? 'bg-warn' : 'bg-ok';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-sunken">
        <i className={`block h-full ${tone}`} style={{ width: `${Math.max(score, 4)}%` }} />
      </span>
      <span className="font-mono text-[11px] tabular-nums">{score}</span>
    </span>
  );
}

/** Where sign-ins come from, how risky they were, and a sandbox to test the risk engine. */
export function LocationsView() {
  const { call } = useConsole();
  const [result, setResult] = useState('');
  const me = useConsoleData<Me>('/api/locations/me');
  const summary = useConsoleData<Summary>('/api/locations/summary');
  const rows = useConsoleData<SignInRow[]>(
    `/api/locations/sign-ins?limit=100${result ? `&result=${result}` : ''}`,
  );
  const team = useConsoleData<Member[]>('/api/team');
  const [ip, setIp] = useState('185.220.101.4');
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [lookupErr, setLookupErr] = useState('');
  const [busy, setBusy] = useState(false);
  const name = (id: string) => team.data?.find((m) => m.id === id)?.name ?? id;
  const max = Math.max(1, ...(summary.data?.countries.map((c) => c.total) ?? [1]));
  const risky = summary.data?.countries.reduce((n, c) => n + c.risky, 0) ?? 0;

  const assess = async (value = ip) => {
    setIp(value);
    setBusy(true);
    const r = await call('GET', `/api/locations/lookup?ip=${encodeURIComponent(value)}`);
    setBusy(false);
    if (r.status === 200) {
      setLookup(r.body as Lookup);
      setLookupErr('');
    } else setLookupErr(errorMessage(r));
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-3">
      <section className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="rounded-xl border border-line bg-white p-3.5">
          <p className="text-[11.5px] text-muted">You are connecting from</p>
          <p className="mt-1 text-[17px] font-semibold">
            {me.data ? (
              <>
                {me.data.city}
                <span className="font-normal text-muted">, {me.data.country}</span>
              </>
            ) : (
              '—'
            )}
          </p>
          {me.data && (
            <p className="mt-1 flex flex-wrap gap-1">
              <Pill>{me.data.ip}</Pill>
              <Pill>{me.data.network}</Pill>
            </p>
          )}
        </div>
        <div className="rounded-xl border border-line bg-white p-3.5">
          <p className="text-[11.5px] text-muted">Sign-ins tracked</p>
          <p className="mt-1 text-[17px] font-semibold tabular-nums">
            {summary.data?.total ?? '—'}
          </p>
          <p className="text-[11.5px] text-subtle">
            {summary.data?.countries.length ?? 0} countries ·{' '}
            <span className={risky ? 'font-medium text-warn' : ''}>{risky} flagged risky</span>
          </p>
        </div>
        <div className="rounded-xl border border-line bg-white p-3.5">
          <p className="text-[11.5px] text-muted">Risk engine sandbox</p>
          <form
            className="mt-1.5 flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void assess();
            }}
          >
            <input
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              aria-label="IP address"
              spellCheck={false}
              className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-white px-2.5 font-mono text-[12px] outline-none focus:border-accent"
            />
            <button className="inline-flex h-8 items-center gap-1 rounded-md bg-ink px-3 text-[12px] font-semibold text-canvas hover:opacity-90">
              {busy && <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />}Assess
            </button>
          </form>
          {lookup && !lookupErr ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
              <Pill
                tone={
                  lookup.risk.decision === 'block'
                    ? 'bad'
                    : lookup.risk.decision === 'challenge'
                      ? 'warn'
                      : 'ok'
                }
              >
                {lookup.risk.decision}
              </Pill>
              <RiskMeter score={lookup.risk.score} />
              <span className="text-muted">
                {lookup.city}, {lookup.country} · {lookup.network}
              </span>
              {lookup.risk.reasons.length > 0 && (
                <span className="w-full text-subtle">{lookup.risk.reasons.join(' · ')}</span>
              )}
            </div>
          ) : (
            <p className="mt-2 flex flex-wrap gap-1 text-[11px] text-subtle">
              {lookupErr ? (
                <span className="text-bad">{lookupErr}</span>
              ) : (
                SAMPLE_IPS.map(([v, l]) => (
                  <button
                    key={v}
                    onClick={() => void assess(v)}
                    className="rounded border border-line px-1.5 py-px hover:text-ink"
                  >
                    {l}
                  </button>
                ))
              )}
            </p>
          )}
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.3fr)]">
        <Card title="By country" className="self-start">
          {summary.data?.countries.length ? (
            <ul className="space-y-3 p-3">
              {summary.data.countries.map((c) => (
                <li
                  key={c.countryCode}
                  className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-2"
                >
                  <span className="mt-0.5 rounded bg-sunken py-px text-center font-mono text-[10.5px] font-semibold">
                    {c.countryCode}
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[12px] font-medium">
                      <span className="truncate">{c.country}</span>
                      {c.risky > 0 && <Pill tone="warn">{c.risky} risky</Pill>}
                    </p>
                    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-sunken">
                      <i
                        className={`block h-full ${c.risky ? 'bg-warn' : 'bg-accent'}`}
                        style={{ width: `${(c.total / max) * 100}%` }}
                      />
                    </span>
                    <p className="mt-0.5 truncate text-[10.5px] text-subtle">
                      {c.cities.join(', ')}
                    </p>
                  </div>
                  <span className="font-mono text-[12px] tabular-nums">{c.total}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>No sign-in data yet.</EmptyState>
          )}
        </Card>

        <Card
          title="Sign-in history"
          actions={
            <select
              value={result}
              onChange={(e) => setResult(e.target.value)}
              aria-label="Result"
              className="h-7 rounded-md border border-line-strong bg-white px-1.5 text-[12px]"
            >
              <option value="">Any result</option>
              {['success', 'challenged', 'failed', 'blocked'].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          }
        >
          {rows.data?.length ? (
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-[640px] text-[12px]">
                <thead className="text-left text-[11px] text-subtle">
                  <tr className="border-b border-line">
                    {['When', 'Member', 'Location', 'Network', 'Result', 'Risk', 'Signals'].map(
                      (h) => (
                        <th key={h} className="px-3 py-2 font-medium">
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.data.map((s) => (
                    <tr key={s.id} className="border-b border-line align-top last:border-0">
                      <td className="whitespace-nowrap px-3 py-1.5 text-subtle">{ago(s.at)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">{name(s.memberId)}</td>
                      <td className="px-3 py-1.5">
                        {s.location.city}, {s.location.country}
                        <span className="block font-mono text-[10.5px] text-subtle">{s.ip}</span>
                      </td>
                      <td className="px-3 py-1.5">
                        <Pill>{s.location.network}</Pill>
                      </td>
                      <td className="px-3 py-1.5">
                        <Pill tone={RESULT_TONE[s.result]}>{s.result}</Pill>
                      </td>
                      <td className="px-3 py-1.5">
                        <RiskMeter score={s.risk.score} />
                      </td>
                      <td className="max-w-[260px] px-3 py-1.5 text-[11.5px] text-muted">
                        {s.risk.reasons.join(' · ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState>No sign-ins match.</EmptyState>
          )}
        </Card>
      </div>
    </div>
  );
}
