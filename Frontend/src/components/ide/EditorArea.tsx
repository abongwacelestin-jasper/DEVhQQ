import React from 'react';
import { ChevronRightIcon, GitCompareIcon, PlayIcon, WandSparklesIcon, XIcon } from 'lucide-react';
import { FileIcon } from './FileIcon';
import { PaneAction } from './PaneHeader';
import { statusColor } from './ExplorerView';
import type { CodeSymbol } from '../../utils/codeFiles';
import type { GitStatus } from '../../types/ide';

interface EditorAreaProps {
  tabs: string[];
  active: string;
  diffTabs: string[];
  diff: string | null;
  symbol?: CodeSymbol;
  errorFiles: Set<string>;
  canRun: boolean;
  running: boolean;
  statusOf: (path: string) => GitStatus | undefined;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onSelectDiff: (path: string) => void;
  onCloseDiff: (path: string) => void;
  onRun: () => void;
  onFormat: () => void;
  onOpenChanges: () => void;
  children: React.ReactNode;
}

const shortcuts: [string, string][] = [
  ['Show All Commands', 'Ctrl + Shift + P'],
  ['Go to File', 'Ctrl + P'],
  ['Find in Files', 'Ctrl + Shift + F'],
  ['Run File', 'F5'],
  ['Toggle Terminal', 'Ctrl + `'],
];

/** Tab strip, breadcrumbs, editor actions and the editor itself. */
export function EditorArea({
  tabs,
  active,
  diffTabs,
  diff,
  symbol,
  errorFiles,
  canRun,
  running,
  statusOf,
  onSelect,
  onClose,
  onSelectDiff,
  onCloseDiff,
  onRun,
  onFormat,
  onOpenChanges,
  children,
}: EditorAreaProps) {
  const empty = tabs.length === 0 && !diff;
  const current = diff ?? active;
  const crumbs = current.split('/');
  const modified = !!statusOf(active) && statusOf(active) !== 'D';

  const tab = (path: string, isDiff: boolean) => {
    const selected = isDiff ? diff === path : !diff && active === path;
    const st = statusOf(path);
    const err = errorFiles.has(path);
    const name = path.split('/').pop();
    return (
      <div
        key={`${isDiff ? 'diff' : 'file'}:${path}`}
        role="tab"
        aria-selected={selected}
        tabIndex={0}
        onClick={() => (isDiff ? onSelectDiff(path) : onSelect(path))}
        onKeyDown={(e) => e.key === 'Enter' && (isDiff ? onSelectDiff(path) : onSelect(path))}
        onAuxClick={(e) => e.button === 1 && (isDiff ? onCloseDiff(path) : onClose(path))}
        title={isDiff ? `${path} (Working Tree)` : path}
        className={`group relative flex h-[35px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-[var(--vs-border)] pl-3 pr-1 text-[13px] ${
          selected
            ? 'bg-[var(--vs-editor)] text-[var(--vs-fg)] shadow-[inset_0_1px_0_var(--vs-accent)]'
            : 'bg-[var(--vs-side)] text-[var(--vs-fg-muted)] hover:text-[var(--vs-fg)]'
        }`}
      >
        {isDiff ? (
          <GitCompareIcon className="h-3.5 w-3.5 shrink-0 text-[var(--vs-t-blue)]" />
        ) : (
          <FileIcon path={path} />
        )}
        <span
          className={`whitespace-nowrap ${isDiff ? 'italic' : ''} ${err ? 'text-[var(--vs-err)]' : st ? statusColor[st] : ''}`}
        >
          {name}
          {isDiff && ' (Working Tree)'}
        </span>
        {!isDiff && st && (
          <span className={`text-[11px] ${statusColor[st]}`}>{st === 'A' ? 'U' : st}</span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (isDiff) onCloseDiff(path);
            else onClose(path);
          }}
          aria-label={`Close ${name}`}
          className={`ml-0.5 rounded-[4px] p-[2px] hover:bg-[var(--vs-hover)] ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-[var(--vs-editor)]" aria-label="Editor">
      {!empty && (
        <>
          <div className="flex h-[35px] shrink-0 items-stretch bg-[var(--vs-side)]">
            <div role="tablist" className="no-scrollbar flex min-w-0 flex-1 overflow-x-auto">
              {tabs.map((t) => tab(t, false))}
              {diffTabs.map((t) => tab(t, true))}
            </div>
            <div className="flex shrink-0 items-center gap-0.5 px-2">
              {canRun && !diff && (
                <PaneAction label="Run File (F5)" onClick={onRun} disabled={running}>
                  <PlayIcon className="h-4 w-4 text-[var(--vs-t-green)]" />
                </PaneAction>
              )}
              {modified && !diff && (
                <PaneAction label="Open Changes" onClick={onOpenChanges}>
                  <GitCompareIcon className="h-4 w-4" />
                </PaneAction>
              )}
              {!diff && (
                <PaneAction label="Format Document (Shift+Alt+F)" onClick={onFormat}>
                  <WandSparklesIcon className="h-4 w-4" />
                </PaneAction>
              )}
            </div>
          </div>
          <nav
            aria-label="Breadcrumbs"
            className="flex h-[22px] shrink-0 items-center gap-0.5 overflow-hidden px-3 text-[12.5px] text-[var(--vs-fg-muted)]"
          >
            {crumbs.map((c, i) => (
              <React.Fragment key={`${c}-${i}`}>
                {i > 0 && <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />}
                {i === crumbs.length - 1 && <FileIcon path={current} />}
                <span className="truncate">{c}</span>
              </React.Fragment>
            ))}
            {symbol && !diff && (
              <>
                <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                <span className="truncate text-[var(--vs-fg)]">{symbol.name}</span>
              </>
            )}
            {diff && (
              <span className="ml-2 shrink-0 text-[var(--vs-fg-dim)]">
                Last commit ↔ Working tree
              </span>
            )}
          </nav>
        </>
      )}
      <div className="relative min-h-0 flex-1">
        {children}
        {empty && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--vs-editor)] p-6">
            <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-2 text-[13px]">
              {shortcuts.map(([label, keys]) => (
                <React.Fragment key={label}>
                  <dt className="text-right text-[var(--vs-fg-muted)]">{label}</dt>
                  <dd className="text-[var(--vs-fg-dim)]">{keys}</dd>
                </React.Fragment>
              ))}
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}
