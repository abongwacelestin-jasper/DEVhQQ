import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CircleXIcon,
  InfoIcon,
  TrashIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react';
import { FileIcon } from './FileIcon';
import { PaneAction } from './PaneHeader';
import type { IdeMarker, OutLine, PanelTab } from '../../types/ide';

interface BottomPanelProps {
  tab: PanelTab;
  problems: IdeMarker[];
  output: OutLine[];
  terminal: React.ReactNode;
  max: boolean;
  style?: React.CSSProperties;
  onTab: (t: PanelTab) => void;
  onOpenProblem: (m: IdeMarker) => void;
  onClearOutput: () => void;
  onClearTerminal: () => void;
  onToggleMax: () => void;
  onClose: () => void;
}

const tone: Record<NonNullable<OutLine['tone']>, string> = {
  ok: 'text-[var(--vs-t-green)]',
  bad: 'text-[var(--vs-t-red)]',
  warn: 'text-[var(--vs-t-yellow)]',
  muted: 'text-[var(--vs-fg-dim)]',
  cmd: 'text-[var(--vs-t-blue)]',
};

export function BottomPanel({
  tab,
  problems,
  output,
  terminal,
  max,
  style,
  onTab,
  onOpenProblem,
  onClearOutput,
  onClearTerminal,
  onToggleMax,
  onClose,
}: BottomPanelProps) {
  const [filter, setFilter] = useState('');
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const outRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (tab === 'output') outRef.current?.scrollTo({ top: outRef.current.scrollHeight });
  }, [output.length, tab]);

  const shown = problems.filter(
    (p) => !filter || `${p.file} ${p.message}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const byFile = Array.from(new Set(shown.map((p) => p.file))).map((file) => ({
    file,
    items: shown.filter((p) => p.file === file).sort((a, b) => a.line - b.line),
  }));
  const tabs: { id: PanelTab; label: string; count?: number }[] = [
    { id: 'problems', label: 'Problems', count: problems.length },
    { id: 'output', label: 'Output' },
    { id: 'terminal', label: 'Terminal' },
  ];

  return (
    <section
      style={style}
      className={`flex min-h-0 shrink-0 flex-col border-t border-[var(--vs-border)] bg-[var(--vs-panel)] ${max ? 'flex-1' : ''}`}
      aria-label="Panel"
    >
      <div className="flex h-[35px] shrink-0 items-center gap-1 px-2">
        <div role="tablist" className="flex min-w-0 items-center">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => onTab(t.id)}
              className={`relative flex h-[35px] items-center gap-1.5 px-2.5 text-[11px] uppercase tracking-[0.04em] ${tab === t.id ? 'text-[var(--vs-fg)]' : 'text-[var(--vs-fg-dim)] hover:text-[var(--vs-fg)]'}`}
            >
              {t.label}
              {t.count ? (
                <span className="rounded-full bg-[var(--vs-bubble)] px-1.5 text-[10.5px] normal-case text-[var(--vs-fg)]">
                  {t.count}
                </span>
              ) : null}
              {tab === t.id && (
                <span className="absolute inset-x-2.5 bottom-[5px] h-px bg-[var(--vs-fg)]" />
              )}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          {tab === 'problems' && (
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter (e.g. text, path)"
              aria-label="Filter problems"
              className="mr-1 hidden h-[22px] w-48 rounded-sm border border-[var(--vs-input-border)] bg-[var(--vs-input)] px-2 text-[12px] text-[var(--vs-fg)] outline-none placeholder:text-[var(--vs-fg-dim)] focus:border-[var(--vs-accent)] sm:block"
            />
          )}
          {tab === 'output' && (
            <span className="mr-2 hidden text-[12px] text-[var(--vs-fg-muted)] sm:inline">
              TavetaHQ Sandbox
            </span>
          )}
          {tab !== 'problems' && (
            <PaneAction
              label={tab === 'output' ? 'Clear Output' : 'Clear Terminal'}
              onClick={tab === 'output' ? onClearOutput : onClearTerminal}
            >
              <TrashIcon className="h-4 w-4" />
            </PaneAction>
          )}
          <PaneAction
            label={max ? 'Restore Panel Size' : 'Maximize Panel Size'}
            onClick={onToggleMax}
          >
            {max ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronUpIcon className="h-4 w-4" />}
          </PaneAction>
          <PaneAction label="Hide Panel (Ctrl+J)" onClick={onClose}>
            <XIcon className="h-4 w-4" />
          </PaneAction>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'terminal' && terminal}
        {tab === 'output' && (
          <div
            ref={outRef}
            className="h-full overflow-y-auto px-4 py-1 font-mono text-[12.5px] leading-[19px] ide-scroll"
            role="log"
            aria-live="polite"
          >
            {output.length === 0 && (
              <p className="text-[var(--vs-fg-dim)]">
                Run a file (F5) or the tests to see output here.
              </p>
            )}
            {output.map((l, i) => (
              <div
                key={i}
                className={`whitespace-pre-wrap break-words ${l.tone ? tone[l.tone] : 'text-[var(--vs-fg)]'}`}
              >
                {l.text}
              </div>
            ))}
          </div>
        )}
        {tab === 'problems' && (
          <ul className="h-full overflow-y-auto pb-2 text-[13px] ide-scroll">
            {byFile.length === 0 && (
              <li className="px-4 py-1 text-[var(--vs-fg-muted)]">
                {problems.length
                  ? 'No problems match the filter.'
                  : 'No problems have been detected in the workspace.'}
              </li>
            )}
            {byFile.map(({ file, items }) => {
              const open = !folded.has(file);
              return (
                <li key={file}>
                  <button
                    onClick={() =>
                      setFolded((s) => {
                        const n = new Set(s);
                        if (n.has(file)) n.delete(file);
                        else n.add(file);
                        return n;
                      })
                    }
                    aria-expanded={open}
                    className="flex h-[22px] w-full items-center gap-1 pl-2 pr-3 text-left hover:bg-[var(--vs-hover)]"
                  >
                    <ChevronRightIcon
                      className={`h-4 w-4 shrink-0 transition-transform duration-100 ${open ? 'rotate-90' : ''}`}
                    />
                    <FileIcon path={file} />
                    <span className="truncate">{file.split('/').pop()}</span>
                    <span className="min-w-0 truncate text-[12px] text-[var(--vs-fg-dim)]">
                      {file.split('/').slice(0, -1).join('/')}
                    </span>
                    <span className="ml-1 rounded-full bg-[var(--vs-bubble)] px-1.5 text-[11px]">
                      {items.length}
                    </span>
                  </button>
                  {open && (
                    <ul>
                      {items.map((p, i) => (
                        <li key={`${p.line}:${p.col}:${i}`}>
                          <button
                            onClick={() => onOpenProblem(p)}
                            className="flex min-h-[22px] w-full items-start gap-1.5 py-[2px] pl-9 pr-3 text-left hover:bg-[var(--vs-hover)]"
                          >
                            {p.severity === 'error' ? (
                              <CircleXIcon className="mt-[3px] h-3.5 w-3.5 shrink-0 text-[var(--vs-err)]" />
                            ) : p.severity === 'warning' ? (
                              <TriangleAlertIcon className="mt-[3px] h-3.5 w-3.5 shrink-0 text-[var(--vs-warn)]" />
                            ) : (
                              <InfoIcon className="mt-[3px] h-3.5 w-3.5 shrink-0 text-[var(--vs-info)]" />
                            )}
                            <span className="min-w-0 flex-1">{p.message.split('\n')[0]}</span>
                            <span className="shrink-0 text-[12px] text-[var(--vs-fg-dim)]">
                              {p.source === 'devhq' ? 'devhq' : 'ts'} [Ln {p.line}, Col {p.col}]
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
