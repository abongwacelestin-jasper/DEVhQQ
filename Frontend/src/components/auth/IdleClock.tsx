interface IdleClockProps {
  /** When the user stopped interacting (lock time minus the idle policy). */
  idleSince: number;
  /** When the screen locked. */
  lockedAt: number;
  now: number;
  size?: number;
}

const C = 120;

function polar(deg: number, r: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)] as const;
}

/** SVG arc on the dial from `startDeg`, sweeping `sweep` degrees clockwise (capped just under a full turn). */
function arc(startDeg: number, sweep: number, r: number) {
  const s = Math.min(Math.max(sweep, 0), 359.99);
  const [x1, y1] = polar(startDeg, r);
  const [x2, y2] = polar(startDeg + s, r);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${s > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

const minuteDeg = (t: number) => {
  const d = new Date(t);
  return ((d.getMinutes() + d.getSeconds() / 60) / 60) * 360;
};

/**
 * Analog clock that shades the minute ring from the moment you went idle: amber for the idle
 * grace period, then a red zone that keeps growing while the screen stays locked. Each full lap
 * (60 min) is counted in the centre.
 */
export function IdleClock({ idleSince, lockedAt, now, size = 240 }: IdleClockProps) {
  const d = new Date(now);
  const hourDeg = ((d.getHours() % 12) + d.getMinutes() / 60) * 30;
  const minDeg = minuteDeg(now);
  const secDeg = d.getSeconds() * 6;

  const startDeg = minuteDeg(idleSince);
  const graceSweep = ((lockedAt - idleSince) / 3_600_000) * 360;
  const totalSweep = ((now - idleSince) / 3_600_000) * 360;
  const laps = Math.floor((now - idleSince) / 3_600_000);
  const redStart = startDeg + Math.min(graceSweep, 360);
  const redSweep = laps > 0 ? 360 : totalSweep - graceSweep;
  const lockedMin = (now - lockedAt) / 60_000;
  // Red intensifies the longer the lock lasts: 0.55 → 1 over 30 minutes.
  const heat = Math.min(1, 0.55 + (lockedMin / 30) * 0.45);

  return (
    <svg
      viewBox="0 0 240 240"
      width={size}
      height={size}
      role="img"
      aria-label={`Idle for ${Math.floor((now - idleSince) / 60000)} minutes`}
      className="drop-shadow-[0_8px_30px_rgba(0,0,0,0.45)]"
    >
      <circle
        cx={C}
        cy={C}
        r="116"
        fill="rgba(15,17,26,0.72)"
        stroke="rgba(255,255,255,0.12)"
        strokeWidth="1"
      />
      {/* Zone track */}
      <circle cx={C} cy={C} r="104" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="10" />
      {laps === 0 && (
        <path
          d={arc(startDeg, graceSweep, 104)}
          fill="none"
          stroke="#F59E0B"
          strokeOpacity="0.85"
          strokeWidth="10"
          strokeLinecap="butt"
        />
      )}
      {redSweep > 0 && (
        <path
          d={laps > 0 ? arc(0, 360, 104) : arc(redStart, redSweep, 104)}
          fill="none"
          stroke="#EF4444"
          strokeOpacity={heat}
          strokeWidth="10"
          strokeLinecap="butt"
        />
      )}
      {/* Start-of-idle marker */}
      {laps === 0 &&
        (() => {
          const [x1, y1] = polar(startDeg, 96);
          const [x2, y2] = polar(startDeg, 112);
          return (
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#fff"
              strokeWidth="2"
              strokeLinecap="round"
            />
          );
        })()}
      {/* Ticks */}
      {Array.from({ length: 60 }, (_, i) => {
        const major = i % 5 === 0;
        const [x1, y1] = polar(i * 6, major ? 84 : 88);
        const [x2, y2] = polar(i * 6, 92);
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="#fff"
            strokeOpacity={major ? 0.7 : 0.22}
            strokeWidth={major ? 2 : 1}
            strokeLinecap="round"
          />
        );
      })}
      {/* Hands */}
      {(() => {
        const [hx, hy] = polar(hourDeg, 48);
        const [mx, my] = polar(minDeg, 72);
        const [sx, sy] = polar(secDeg, 80);
        const [tx, ty] = polar(secDeg + 180, 14);
        return (
          <g strokeLinecap="round">
            <line x1={C} y1={C} x2={hx} y2={hy} stroke="#fff" strokeWidth="5" />
            <line x1={C} y1={C} x2={mx} y2={my} stroke="#fff" strokeWidth="3.5" />
            <line x1={tx} y1={ty} x2={sx} y2={sy} stroke="#EF4444" strokeWidth="1.5" />
            <circle cx={C} cy={C} r="4.5" fill="#EF4444" />
            <circle cx={C} cy={C} r="1.8" fill="#fff" />
          </g>
        );
      })()}
      {laps > 0 && (
        <text x={C} y={C + 40} textAnchor="middle" fill="#FCA5A5" fontSize="11" fontWeight="600">
          {laps}h+ idle
        </text>
      )}
    </svg>
  );
}
