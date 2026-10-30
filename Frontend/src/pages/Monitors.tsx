import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { ProductMark } from '../components/ui/ProductMark';
import { StatusBadge } from '../components/ui/StatusBadge';
import { UptimeBars } from '../components/ui/UptimeBars';
import { Sparkline } from '../components/ui/Sparkline';
import { useProductFilter } from '../contexts/ProductFilterContext';
import { monitors, servers } from '../data/operations';
import { products } from '../data/portfolio';
import type { UptimeTick } from '../types/operations';
import type { Tone } from '../types/portfolio';

const tickMeta: Record<UptimeTick, { label: string; tone: Tone }> = {
  up: { label: 'Up', tone: 'ok' },
  degraded: { label: 'Degraded', tone: 'warn' },
  down: { label: 'Down', tone: 'bad' },
};

function Meter({ label, value }: { label: string; value?: number }) {
  if (value === undefined) return <span className="text-xs text-subtle">—</span>;
  const tone = value >= 80 ? 'bg-bad' : value >= 65 ? 'bg-warn' : 'bg-ok';
  return (
    <div className="w-full min-w-[80px]">
      <div className="flex justify-between text-[11px]">
        <span className="text-subtle">{label}</span>
        <span className="tabular-nums text-ink">{value}%</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-sunken">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export function Monitors() {
  const { matches } = useProductFilter();
  const rows = monitors.filter((m) => matches(m.product));
  const hosts = servers.filter((s) => s.products.some(matches));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Monitors"
        description="External uptime checks and host metrics where providers expose them. A successful deploy doesn’t mean a healthy service."
      />

      <div className="flex flex-col gap-px overflow-hidden rounded-xl border border-line bg-line sm:flex-row">
        {products
          .filter((p) => matches(p.id))
          .map((p) => (
            <div key={p.id} className="flex flex-1 items-center gap-3 bg-surface px-4 py-3.5">
              <ProductMark product={p.id} size="lg" />
              <div>
                <p className="text-xs text-muted">{p.name} · 30d uptime</p>
                <p
                  className={`text-2xl font-semibold tabular-nums tracking-tight ${p.uptime < 99.5 ? 'text-bad' : 'text-ink'}`}
                >
                  {p.uptime}%
                </p>
              </div>
            </div>
          ))}
      </div>

      <Panel title="Uptime checks" meta={<span>Checked every 60s from 3 regions</span>}>
        <ul className="divide-y divide-line">
          {rows.map((m) => (
            <li
              key={m.id}
              className="grid items-center gap-3 px-4 py-3.5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_120px_70px]"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <ProductMark product={m.product} size="sm" />
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <span className="truncate">{m.name}</span>
                    <StatusBadge {...tickMeta[m.status]} dot />
                  </p>
                  <p className="truncate font-mono text-[11px] text-subtle">
                    {m.kind} · {m.target}
                  </p>
                </div>
              </div>
              <div>
                <UptimeBars ticks={m.ticks} label={`${m.name} last 30 days`} />
                <div className="mt-1 flex justify-between text-[10px] text-subtle">
                  <span>30 days ago</span>
                  <span>Today</span>
                </div>
              </div>
              <div className="h-8">
                {m.kind === 'Cron' ? (
                  <p className="text-xs text-muted">Last run 2m ago</p>
                ) : (
                  <Sparkline
                    points={m.latency}
                    height={32}
                    stroke={m.status === 'up' ? '#4F46E5' : '#9A5A06'}
                    fill={m.status === 'up' ? '#EEEEFD' : '#FCF1DC'}
                    label={`Latency ${m.responseMs}ms`}
                  />
                )}
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold tabular-nums text-ink">{m.uptime}%</p>
                {m.kind !== 'Cron' && (
                  <p className="text-[11px] tabular-nums text-subtle">{m.responseMs}ms</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Servers" meta={<span>{hosts.length} hosts</span>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-subtle">
                <th className="px-4 py-2 font-medium">Host</th>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium">Products</th>
                <th className="px-3 py-2 font-medium">CPU</th>
                <th className="px-3 py-2 font-medium">Memory</th>
                <th className="px-4 py-2 font-medium">Disk</th>
              </tr>
            </thead>
            <tbody>
              {hosts.map((s) => (
                <tr key={s.name} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-mono text-xs font-medium text-ink">{s.name}</td>
                  <td className="px-3 py-3 text-xs text-muted">
                    {s.provider} · {s.region}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex gap-1">
                      {s.products.map((p) => (
                        <ProductMark key={p} product={p} size="sm" />
                      ))}
                    </div>
                  </td>
                  {s.cpu === undefined ? (
                    <td colSpan={3} className="px-4 py-3 text-xs text-subtle">
                      Provider doesn’t expose host metrics — showing uptime only.
                    </td>
                  ) : (
                    <>
                      <td className="px-3 py-3">
                        <Meter label="CPU" value={s.cpu} />
                      </td>
                      <td className="px-3 py-3">
                        <Meter label="Mem" value={s.memory} />
                      </td>
                      <td className="px-4 py-3">
                        <Meter label="Disk" value={s.disk} />
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
