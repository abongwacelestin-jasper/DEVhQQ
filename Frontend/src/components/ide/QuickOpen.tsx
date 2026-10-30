import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeftIcon, HashIcon, PlusIcon, TerminalSquareIcon } from 'lucide-react';
import { FileIcon } from './FileIcon';
import type { CodeSymbol } from '../../utils/codeFiles';
import type { IdeCommand, Picker } from '../../types/ide';

interface QuickOpenProps {
  open: boolean;
  initial: string;
  picker: Picker | null;
  files: string[];
  recent: string[];
  commands: IdeCommand[];
  symbols: CodeSymbol[];
  lineCount: number;
  onClose: () => void;
  onFile: (path: string) => void;
  onLine: (line: number) => void;
}

interface Row {
  id: string;
  label: string;
  detail?: string;
  right?: string;
  icon: React.ReactNode;
  run: () => void;
}

/** Fuzzy subsequence match; lower score is better, null when it doesn't match. */
function fuzzy(text: string, q: string): number | null {
  const t = text.toLowerCase();
  if (!q) return 0;
  const name = t.split('/').pop() ?? t;
  if (name.startsWith(q)) return 0;
  if (name.includes(q)) return 1;
  if (t.includes(q)) return 2;
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  return i === q.length ? 3 : null;
}

/** VS Code-style quick input: files (default), > commands, : go to line, @ symbols, or a custom picker. */
export function QuickOpen({
  open,
  initial,
  picker,
  files,
  recent,
  commands,
  symbols,
  lineCount,
  onClose,
  onFile,
  onLine,
}: QuickOpenProps) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ(picker?.initial ?? initial);
    setIdx(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open, initial, picker]);

  const rows = useMemo<Row[]>(() => {
    const done = (fn: () => void) => () => {
      onClose();
      fn();
    };
    if (picker) {
      const term = q.trim();
      if (!picker.items)
        return [
          {
            id: 'input',
            label: term || picker.placeholder,
            detail: term ? 'Press Enter to confirm' : undefined,
            icon: <CornerDownLeftIcon className="h-3.5 w-3.5" />,
            run: done(() => term && picker.onPick(term)),
          },
        ];
      const list: Row[] = picker.items
        .filter((it) => fuzzy(it.label, term.toLowerCase()) !== null)
        .map((it) => ({
          id: it.id,
          label: it.label,
          right: it.description,
          icon: <span className="w-3.5" />,
          run: done(() => picker.onPick(it.id)),
        }));
      if (picker.allowCreate && term && !picker.items.some((it) => it.label === term))
        list.push({
          id: `create:${term}`,
          label: `Create “${term}”`,
          icon: <PlusIcon className="h-3.5 w-3.5" />,
          run: done(() => picker.onPick(term)),
        });
      return list;
    }
    if (q.startsWith('>')) {
      const term = q.slice(1).trim().toLowerCase();
      return commands
        .filter((c) => !term || c.label.toLowerCase().includes(term))
        .map((c) => ({
          id: c.id,
          label: c.label,
          right: c.keys,
          icon: <TerminalSquareIcon className="h-3.5 w-3.5 opacity-70" />,
          run: done(c.run),
        }));
    }
    if (q.startsWith(':')) {
      const n = parseInt(q.slice(1), 10);
      const valid = n >= 1 && n <= lineCount;
      return [
        {
          id: 'line',
          label: valid ? `Go to line ${n}` : `Type a line number between 1 and ${lineCount}`,
          icon: <HashIcon className="h-3.5 w-3.5" />,
          run: valid ? done(() => onLine(n)) : () => undefined,
        },
      ];
    }
    if (q.startsWith('@')) {
      const term = q.slice(1).trim().toLowerCase();
      return symbols
        .filter((s) => !term || s.name.toLowerCase().includes(term))
        .map((s) => ({
          id: `${s.name}:${s.line}`,
          label: s.name,
          detail: s.kind,
          right: `Ln ${s.line}`,
          icon: <HashIcon className="h-3.5 w-3.5 opacity-70" />,
          run: done(() => onLine(s.line)),
        }));
    }
    const term = q.trim().toLowerCase();
    const ordered = term
      ? files
      : [...recent.filter((r) => files.includes(r)), ...files.filter((f) => !recent.includes(f))];
    return ordered
      .map((f) => ({ f, s: fuzzy(f, term) }))
      .filter((x): x is { f: string; s: number } => x.s !== null)
      .sort((a, b) => a.s - b.s)
      .slice(0, 50)
      .map(({ f }) => ({
        id: f,
        label: f.split('/').pop() ?? f,
        detail: f.includes('/') ? f.split('/').slice(0, -1).join('/') : undefined,
        right: !term && recent.includes(f) ? 'recently opened' : undefined,
        icon: <FileIcon path={f} />,
        run: done(() => onFile(f)),
      }));
  }, [q, picker, commands, symbols, files, recent, lineCount, onClose, onFile, onLine]);

  useEffect(() => {
    setIdx(0);
  }, [q]);

  if (!open) return null;

  const placeholder =
    picker?.placeholder ??
    'Search files by name (append : to go to line, @ for symbols, > for commands)';

  return (
    <div className="fixed inset-0 z-[60]" onMouseDown={onClose}>
      <div
        className="mx-auto mt-[38px] w-[calc(100%-1.5rem)] max-w-[620px] overflow-hidden rounded-md border border-[var(--vs-input-border)] bg-[var(--vs-widget)] shadow-[0_8px_28px_rgba(0,0,0,0.4)]"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Quick open"
      >
        <div className="p-1.5">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIdx((i) => Math.min(rows.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIdx((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                rows[idx]?.run();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder={placeholder}
            aria-label={placeholder}
            spellCheck={false}
            className="h-[26px] w-full rounded-sm border border-[var(--vs-accent)] bg-[var(--vs-input)] px-2 text-[13px] text-[var(--vs-fg)] outline-none placeholder:text-[var(--vs-fg-dim)]"
          />
        </div>
        <ul role="listbox" className="max-h-[360px] overflow-y-auto pb-1 ide-scroll">
          {rows.length === 0 && (
            <li className="px-3 py-2 text-[13px] text-[var(--vs-fg-muted)]">No matching results</li>
          )}
          {rows.map((r, i) => (
            <li key={r.id} role="option" aria-selected={i === idx}>
              <button
                onMouseMove={() => setIdx(i)}
                onClick={r.run}
                className={`flex h-[24px] w-full items-center gap-2 px-3 text-left text-[13px] ${i === idx ? 'bg-[var(--vs-active)] text-[var(--vs-fg)]' : 'text-[var(--vs-fg)]'}`}
              >
                <span className="flex w-4 shrink-0 justify-center">{r.icon}</span>
                <span className="shrink-0 truncate">{r.label}</span>
                {r.detail && (
                  <span className="min-w-0 truncate text-[12px] text-[var(--vs-fg-dim)]">
                    {r.detail}
                  </span>
                )}
                {r.right && (
                  <span className="ml-auto shrink-0 pl-3 text-[12px] text-[var(--vs-fg-dim)]">
                    {r.right}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
