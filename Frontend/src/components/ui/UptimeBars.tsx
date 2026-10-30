import type { UptimeTick } from '../../types/operations';

const color: Record<UptimeTick, string> = { up: 'bg-ok', degraded: 'bg-warn', down: 'bg-bad' };

export function UptimeBars({ ticks, label }: { ticks: UptimeTick[]; label: string }) {
  return (
    <div className="flex h-6 items-stretch gap-[2px]" role="img" aria-label={label}>
      {ticks.map((t, i) => (
        <span
          key={i}
          title={`Day ${i + 1}: ${t}`}
          className={`flex-1 rounded-[2px] ${color[t]} ${t === 'up' ? 'opacity-80' : ''}`}
        />
      ))}
    </div>
  );
}
