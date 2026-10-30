import React from 'react';
import { Link } from 'react-router-dom';
import { CheckIcon } from 'lucide-react';

/** Renders the lightweight doc markdown. Checkbox lines are interactive when onToggle is provided. */
export function DocRenderer({
  body,
  onToggle,
}: {
  body: string;
  onToggle?: (lineIndex: number) => void;
}) {
  const lines = body.split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const idx = i;
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      out.push(
        <div key={idx} className="my-2 overflow-hidden rounded-md bg-[#0F1115]">
          {lang && (
            <p className="border-b border-[#ffffff1a] px-3 py-1 font-mono text-[10.5px] text-[#E5E7EB]/60">
              {lang}
            </p>
          )}
          <pre className="overflow-x-auto px-3 py-2 font-mono text-[12px] leading-relaxed text-[#E5E7EB] scroll-thin">
            {code.join('\n')}
          </pre>
        </div>,
      );
      i++;
      continue;
    }
    if (line.startsWith('# '))
      out.push(
        <h1 key={idx} className="mb-2 mt-1 text-[20px] font-semibold tracking-tight text-ink">
          {inline(line.slice(2))}
        </h1>,
      );
    else if (line.startsWith('## '))
      out.push(
        <h2
          key={idx}
          id={slug(line.slice(3))}
          className="mb-1 mt-4 scroll-mt-20 text-[14.5px] font-semibold text-ink"
        >
          {inline(line.slice(3))}
        </h2>,
      );
    else if (line.startsWith('> '))
      out.push(
        <blockquote
          key={idx}
          className="my-2 border-l-[3px] border-accent bg-accent-soft/40 px-3 py-1.5 text-[13px] text-ink"
        >
          {inline(line.slice(2))}
        </blockquote>,
      );
    else if (/^- \[( |x)\] /.test(line)) {
      const done = line[3] === 'x';
      out.push(
        <label
          key={idx}
          className={`flex items-start gap-2 py-0.5 text-[13px] ${onToggle ? 'cursor-pointer' : ''}`}
        >
          <button
            type="button"
            disabled={!onToggle}
            onClick={() => onToggle?.(idx)}
            aria-pressed={done}
            aria-label={done ? 'Mark not done' : 'Mark done'}
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${done ? 'border-ok bg-ok text-white' : 'border-line-strong bg-white'}`}
          >
            {done && <CheckIcon className="h-3 w-3" />}
          </button>
          <span className={done ? 'text-muted line-through' : 'text-ink'}>
            {inline(line.slice(6))}
          </span>
        </label>,
      );
    } else if (line.startsWith('- '))
      out.push(
        <li key={idx} className="ml-5 list-disc py-0.5 text-[13px] text-ink">
          {inline(line.slice(2))}
        </li>,
      );
    else if (line.trim() === '') out.push(<div key={idx} className="h-1.5" />);
    else
      out.push(
        <p key={idx} className="py-0.5 text-[13px] leading-relaxed text-ink">
          {inline(line)}
        </p>,
      );
    i++;
  }
  return <div className="min-w-0">{out}</div>;
}

export function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function inline(s: string) {
  return s.split(/(`[^`]+`|\b(?:RB|BL|MA)-\d+\b)/g).map((p, i) => {
    if (/^`.+`$/.test(p))
      return (
        <code key={i} className="rounded bg-sunken px-1 font-mono text-[12px] text-ink">
          {p.slice(1, -1)}
        </code>
      );
    if (/^(RB|BL|MA)-\d+$/.test(p))
      return (
        <Link
          key={i}
          to={`/tasks/${p}`}
          className="font-mono text-[12px] font-medium text-accent hover:underline"
        >
          {p}
        </Link>
      );
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}
