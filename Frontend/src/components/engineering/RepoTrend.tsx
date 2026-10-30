/**
 * Smooth commit-activity trend. Drawn in a fixed viewBox and scaled to its container,
 * so it never overflows the card; the end-point marker is HTML so it stays round.
 */
export function RepoTrend({
  points,
  label,
  tone = 'accent',
}: {
  points: number[];
  label: string;
  tone?: 'accent' | 'bad';
}) {
  const W = 200;
  const H = 48;
  const PAD = 5;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const xy = points.map(
    (p, i) =>
      [
        (i / Math.max(1, points.length - 1)) * W,
        H - PAD - ((p - min) / range) * (H - PAD * 2),
      ] as const,
  );

  // Catmull-Rom → cubic Bézier for a smooth curve through every point.
  let d = `M${xy[0][0]},${xy[0][1]}`;
  for (let i = 0; i < xy.length - 1; i++) {
    const p0 = xy[i - 1] ?? xy[i];
    const p1 = xy[i];
    const p2 = xy[i + 1];
    const p3 = xy[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${Math.min(H, Math.max(0, c1[1])).toFixed(1)} ${c2[0].toFixed(1)},${Math.min(H, Math.max(0, c2[1])).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  const area = `${d} L${W},${H} L0,${H} Z`;
  const [lx, ly] = xy[xy.length - 1];
  const stroke = tone === 'bad' ? 'rgb(var(--c-bad))' : 'rgb(var(--c-accent))';

  return (
    <div className="relative h-12 w-full" role="img" aria-label={label}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full overflow-visible"
        aria-hidden="true"
      >
        <path d={area} fill={stroke} opacity={0.08} />
        <path
          d={d}
          fill="none"
          stroke={stroke}
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
        style={{ left: `${(lx / W) * 100}%`, top: `${(ly / H) * 100}%`, background: stroke }}
      />
    </div>
  );
}
