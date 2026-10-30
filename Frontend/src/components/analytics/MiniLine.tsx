import type { Tone } from '../../types/portfolio';

const stroke: Record<Tone, string> = {
  ok: '#137333',
  warn: '#8A4F00',
  bad: '#B42318',
  neutral: '#5F6573',
  info: '#0B5E99',
  accent: '#4F46E5',
};

interface MiniLineProps {
  values: number[];
  labels?: string[];
  tone?: Tone;
  height?: number;
  label: string;
}

/** Tiny line chart with a light area fill and the last point marked. */
export function MiniLine({ values, labels, tone = 'accent', height = 36, label }: MiniLineProps) {
  if (values.length === 0) return <p className="text-[11px] text-muted">No data in range</p>;
  const w = 200;
  const pad = 3;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const pts = values.map(
    (v, i) => [pad + i * step, pad + (height - pad * 2) * (1 - (v - min) / span)] as const,
  );
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${pad},${height} ${line} ${pts[pts.length - 1][0].toFixed(1)},${height}`;
  const last = pts[pts.length - 1];
  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${w} ${height}`}
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height }}
        role="img"
        aria-label={`${label}: ${values.join(', ')}`}
      >
        <polygon points={area} fill={stroke[tone]} opacity={0.08} />
        <polyline
          points={line}
          fill="none"
          stroke={stroke[tone]}
          strokeWidth={1.6}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx={last[0]} cy={last[1]} r={2.4} fill={stroke[tone]} />
      </svg>
      {labels && labels.length > 1 && (
        <figcaption className="mt-0.5 flex justify-between text-[10px] tabular-nums text-muted">
          <span>{labels[0]}</span>
          <span>{labels[labels.length - 1]}</span>
        </figcaption>
      )}
    </figure>
  );
}
