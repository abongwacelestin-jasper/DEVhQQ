import type { Incident } from '../../types/operations';
import { memberById, productById } from '../../utils/status';

interface NodeSpec {
  x: number;
  y: number;
  kind: string;
  label: string;
  w?: number;
  tone?: 'bad' | 'ink' | 'default';
}

function clip(s: string, n = 22) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function Node({ x, y, kind, label, w = 150, tone = 'default' }: NodeSpec) {
  const fill = tone === 'bad' ? '#FCEAE8' : tone === 'ink' ? '#15171C' : '#FFFFFF';
  const stroke = tone === 'bad' ? '#E8A39C' : tone === 'ink' ? '#15171C' : '#D4D4CE';
  const kindColor = tone === 'bad' ? '#C4281C' : tone === 'ink' ? '#A5B4FC' : '#8B909A';
  const labelColor = tone === 'ink' ? '#FFFFFF' : '#15171C';
  return (
    <g>
      <rect x={x - w / 2} y={y - 22} width={w} height={44} rx={10} fill={fill} stroke={stroke} />
      <text
        x={x}
        y={y - 4}
        textAnchor="middle"
        fontSize="10"
        fill={kindColor}
        fontFamily="Inter, sans-serif"
        fontWeight={500}
      >
        {kind}
      </text>
      <text
        x={x}
        y={y + 12}
        textAnchor="middle"
        fontSize="12"
        fill={labelColor}
        fontFamily="Inter, sans-serif"
        fontWeight={600}
      >
        {clip(label, Math.floor(w / 7))}
      </text>
    </g>
  );
}

export function RelationshipGraph({
  incident,
  related,
}: {
  incident: Incident;
  related: { kind: string; label: string }[];
}) {
  const center = { x: 320, y: 150 };
  const left: NodeSpec[] = [
    { x: 92, y: 70, kind: 'Product', label: productById(incident.product).name },
    { x: 92, y: 150, kind: 'Service', label: incident.service },
    { x: 92, y: 230, kind: 'Environment', label: 'production' },
  ];

  const top: NodeSpec = {
    x: 320,
    y: 36,
    kind: 'Monitor alert',
    label: incident.events[0]?.title ?? 'Alert',
  };
  const bottom: NodeSpec = {
    x: 320,
    y: 266,
    kind: 'Owner',
    label: memberById(incident.owner).name,
  };
  const span = 200;
  const right: NodeSpec[] = related.map((r, i) => ({
    x: 548,
    y: related.length === 1 ? 150 : 50 + (span / (related.length - 1)) * i,
    kind: r.kind,
    label: r.label,
  }));
  const correlated = related[0]?.kind === 'Deployment';

  return (
    <div className="overflow-x-auto scroll-thin">
      <svg
        viewBox="0 0 640 300"
        className="h-auto w-full min-w-[560px]"
        role="img"
        aria-label={`Records connected to ${incident.id}`}
      >
        <defs>
          <pattern id="dots" width="16" height="16" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#E6E6E1" />
          </pattern>
        </defs>
        <rect width="640" height="300" fill="url(#dots)" />

        {left.map((n) => (
          <path
            key={n.kind}
            d={`M${n.x + 75} ${n.y} C ${n.x + 140} ${n.y}, ${center.x - 150} ${center.y}, ${center.x - 85} ${center.y}`}
            stroke="#B9B9B2"
            strokeWidth="1.4"
            fill="none"
          />
        ))}
        <path d={`M${top.x} ${top.y + 22} V ${center.y - 22}`} stroke="#E8A39C" strokeWidth="1.4" />
        <path
          d={`M${bottom.x} ${bottom.y - 22} V ${center.y + 22}`}
          stroke="#B9B9B2"
          strokeWidth="1.4"
        />

        {right.length > 0 && (
          <>
            <path
              d={`M${center.x + 85} ${center.y} C ${center.x + 140} ${center.y}, ${right[0].x - 140} ${right[0].y}, ${right[0].x - 75} ${right[0].y}`}
              stroke={correlated ? '#9A5A06' : '#B9B9B2'}
              strokeWidth="1.4"
              strokeDasharray={correlated ? '5 4' : undefined}
              fill="none"
            />

            {correlated && (
              <g>
                <rect
                  x={404}
                  y={right[0].y + (center.y - right[0].y) / 2 - 10}
                  width={92}
                  height={18}
                  rx={9}
                  fill="#FCF1DC"
                />
                <text
                  x={450}
                  y={right[0].y + (center.y - right[0].y) / 2 + 2.5}
                  textAnchor="middle"
                  fontSize="9.5"
                  fill="#9A5A06"
                  fontFamily="Inter, sans-serif"
                  fontWeight={600}
                >
                  correlated · unproven
                </text>
              </g>
            )}
            {right.slice(1).map((n, i) => (
              <path
                key={n.kind}
                d={`M${n.x} ${right[i].y + 22} V ${n.y - 22}`}
                stroke="#B9B9B2"
                strokeWidth="1.4"
              />
            ))}
          </>
        )}

        {left.map((n) => (
          <Node key={n.kind} {...n} />
        ))}
        <Node {...top} tone="bad" />
        <Node {...bottom} />
        {right.map((n) => (
          <Node key={n.kind + n.label} {...n} />
        ))}
        <Node
          x={center.x}
          y={center.y}
          kind={`${incident.id} · ${incident.severity}`}
          label={incident.title}
          w={170}
          tone="ink"
        />
      </svg>
    </div>
  );
}
