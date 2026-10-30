import React, { useMemo } from 'react';

interface JsonViewProps {
  value: unknown;
  className?: string;
}

const TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/** Syntax-highlighted, pretty-printed JSON. */
export function JsonView({ value, className = '' }: JsonViewProps) {
  const parts = useMemo(() => {
    const text = typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? '');
    const out: React.ReactNode[] = [];
    let last = 0;
    let i = 0;
    for (const m of text.matchAll(TOKEN)) {
      const at = m.index ?? 0;
      if (at > last) out.push(text.slice(last, at));
      let cls = 'text-warn';
      if (m[1] && m[2]) cls = 'text-accent';
      else if (m[1]) cls = 'text-ok';
      else if (m[3]) cls = 'text-info';
      else if (m[0] === 'null') cls = 'text-subtle';
      out.push(
        <span key={i++} className={cls}>
          {m[1] && m[2] ? m[1] : m[0]}
        </span>,
      );
      if (m[1] && m[2]) out.push(m[2]);
      last = at + m[0].length;
    }
    out.push(text.slice(last));
    return out;
  }, [value]);

  return (
    <pre
      className={`scroll-thin overflow-auto whitespace-pre font-mono text-[11.5px] leading-[1.6] text-ink ${className}`}
    >
      {parts}
    </pre>
  );
}
