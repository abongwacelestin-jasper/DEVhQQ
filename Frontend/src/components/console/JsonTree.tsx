import { useState } from 'react';
import { ChevronRightIcon } from 'lucide-react';

/** Collapsible JSON tree. Objects/arrays deeper than `openDepth` start folded. */
export function JsonTree({
  value,
  openDepth = 2,
  className = '',
}: {
  value: unknown;
  openDepth?: number;
  className?: string;
}) {
  return (
    <div
      className={`scroll-thin overflow-auto font-mono text-[11.5px] leading-[1.65] ${className}`}
    >
      <Node value={value} depth={0} openDepth={openDepth} last />
    </div>
  );
}

function Leaf({ v }: { v: unknown }) {
  if (v === null) return <span className="text-subtle">null</span>;
  if (typeof v === 'string') return <span className="break-all text-ok">"{v}"</span>;
  if (typeof v === 'number') return <span className="text-warn">{v}</span>;
  if (typeof v === 'boolean') return <span className="text-info">{String(v)}</span>;
  return <span className="text-muted">{String(v)}</span>;
}

function Node({
  name,
  value,
  depth,
  openDepth,
  last,
}: {
  name?: string;
  value: unknown;
  depth: number;
  openDepth: number;
  last: boolean;
}) {
  const isArr = Array.isArray(value);
  const isObj = value !== null && typeof value === 'object';
  const [open, setOpen] = useState(depth < openDepth);
  const comma = last ? '' : ',';
  const label = name !== undefined && (
    <>
      <span className="text-accent">"{name}"</span>
      <span className="text-muted">: </span>
    </>
  );

  if (!isObj) {
    return (
      <div style={{ paddingLeft: depth ? 14 : 0 }}>
        {label}
        <Leaf v={value} />
        {comma}
      </div>
    );
  }

  const entries = isArr
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const [o, c] = isArr ? ['[', ']'] : ['{', '}'];
  if (!entries.length) {
    return (
      <div style={{ paddingLeft: depth ? 14 : 0 }}>
        {label}
        <span className="text-muted">{o + c}</span>
        {comma}
      </div>
    );
  }

  return (
    <div style={{ paddingLeft: depth ? 14 : 0 }}>
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        aria-expanded={open}
        className="-ml-3.5 inline-flex items-center text-left hover:bg-sunken/60"
      >
        <ChevronRightIcon
          className={`h-3 w-3 shrink-0 text-subtle transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
        />
        <span className="ml-0.5">
          {label}
          <span className="text-muted">{o}</span>
          {!open && (
            <span className="text-subtle">
              {' '}
              {entries.length}{' '}
              {isArr
                ? entries.length === 1
                  ? 'item'
                  : 'items'
                : entries.length === 1
                  ? 'key'
                  : 'keys'}{' '}
              {c}
              {comma}
            </span>
          )}
        </span>
      </button>
      {open && (
        <>
          {entries.map(([k, v], i) => (
            <Node
              key={k}
              name={isArr ? undefined : k}
              value={v}
              depth={depth + 1}
              openDepth={openDepth}
              last={i === entries.length - 1}
            />
          ))}
          <div className="text-muted">
            {c}
            {comma}
          </div>
        </>
      )}
    </div>
  );
}
