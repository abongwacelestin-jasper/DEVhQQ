import React from 'react';
import { roleDetails } from '../../data/team';
import type { Member } from '../../types/team';

type Tone = 'bad' | 'warn' | 'ok' | 'info';

const tones: Record<Tone | 'neutral', string> = {
  neutral: 'border-line bg-white text-ink',
  ok: 'border-ok/25 bg-ok-soft text-ok',
  bad: 'border-bad/25 bg-bad-soft text-bad',
  warn: 'border-warn/25 bg-warn-soft text-warn',
  info: 'border-info/25 bg-info-soft text-info',
};

/** Single-line pill with a colour-coded status dot. */
export function Pill({
  dot,
  tone,
  children,
}: {
  dot: string;
  tone?: Tone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-px text-[10.5px] font-medium leading-4 ${tones[tone ?? 'neutral']}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
      <span className="truncate">{children}</span>
    </span>
  );
}

export const RoleBadge = ({ m }: { m: Member }) => (
  <Pill dot={roleDetails[m.role].dot}>{m.role}</Pill>
);

export function StatusBadge({ m }: { m: Member }) {
  if (m.status === 'active') return <Pill dot="bg-ok">Active</Pill>;
  if (m.status === 'invited')
    return (
      <Pill dot="bg-info" tone="info">
        Invited
      </Pill>
    );
  return <Pill dot="bg-subtle">Deactivated</Pill>;
}

export function MfaBadge({ m }: { m: Member }) {
  if (m.status === 'invited') return <span className="text-[11px] text-subtle">Pending</span>;
  return m.mfa ? (
    <Pill dot="bg-ok" tone="ok">
      Enabled
    </Pill>
  ) : (
    <Pill dot="bg-bad" tone="bad">
      Missing
    </Pill>
  );
}

export function ProdBadge({ m }: { m: Member }) {
  return m.productionAccess ? (
    <Pill dot="bg-warn" tone="warn">
      Standing
    </Pill>
  ) : (
    <span className="text-[11px] text-subtle">None</span>
  );
}

export function WorkloadMeter({ m, wide = false }: { m: Member; wide?: boolean }) {
  const load = m.capacity ? Math.round((m.openTasks / m.capacity) * 100) : 0;
  const color = load > 100 ? 'bg-bad' : load > 80 ? 'bg-warn' : 'bg-ok';
  return (
    <span className="flex min-w-0 items-center gap-2" title={`${load}% of capacity`}>
      <span className={`h-1.5 overflow-hidden rounded-full bg-sunken ${wide ? 'flex-1' : 'w-14'}`}>
        <span
          className={`block h-full rounded-full ${color}`}
          style={{ width: `${Math.min(100, load)}%` }}
        />
      </span>
      <span
        className={`shrink-0 text-[11px] tabular-nums ${load > 100 ? 'font-semibold text-bad' : 'text-muted'}`}
      >
        {m.openTasks}/{m.capacity}
      </span>
    </span>
  );
}
