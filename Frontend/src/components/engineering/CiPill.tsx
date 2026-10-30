import type { Repository } from '../../types/engineering';

const meta: Record<
  Repository['ci'],
  { label: string; cls: string; dot: string; ring?: string; pulse?: boolean }
> = {
  passing: { label: 'CI passing', cls: 'border-ok/25 bg-ok-soft text-ok', dot: 'bg-ok' },
  running: {
    label: 'CI running',
    cls: 'border-info/25 bg-info-soft text-info',
    dot: 'bg-info',
    ring: 'bg-info/50',
    pulse: true,
  },
  failing: {
    label: 'CI failing',
    cls: 'border-bad/25 bg-bad-soft text-bad',
    dot: 'bg-bad',
    ring: 'bg-bad/40',
    pulse: true,
  },
  none: { label: 'No CI', cls: 'border-line bg-sunken text-muted', dot: 'bg-subtle' },
};

/** CI status pill; running and failing get a soft pulsing halo so they read at a glance. */
export function CiPill({ ci }: { ci: Repository['ci'] }) {
  const m = meta[ci] ?? meta.none;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${m.cls}`}
    >
      <span className="relative flex h-1.5 w-1.5">
        {m.pulse && (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full motion-reduce:animate-none ${m.ring}`}
          />
        )}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${m.dot}`} />
      </span>
      {m.label}
    </span>
  );
}
