import {
  CircleCheckIcon,
  CircleXIcon,
  FlaskConicalIcon,
  LoaderIcon,
  PlayIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import { FileIcon } from './FileIcon';
import { PaneAction, PaneHeader } from './PaneHeader';
import type { LastRun } from '../../hooks/useCodeRunner';

interface RunViewProps {
  path: string;
  canRun: boolean;
  running: string | null;
  last: LastRun | null;
  tests: string[];
  onRunFile: (path: string) => void;
  onRunTests: () => void;
}

export function RunView({
  path,
  canRun,
  running,
  last,
  tests,
  onRunFile,
  onRunTests,
}: RunViewProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneHeader variant="view" title="Run and Debug" />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4 text-[13px] ide-scroll">
        <div className="space-y-2">
          <button
            onClick={() => onRunFile(path)}
            disabled={!canRun || !!running}
            className="flex h-[28px] w-full items-center justify-center gap-1.5 rounded-sm bg-[var(--vs-accent)] text-[var(--vs-on-accent)] transition-colors duration-100 hover:bg-[var(--vs-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running === path ? (
              <LoaderIcon className="h-4 w-4 animate-spin" />
            ) : (
              <PlayIcon className="h-4 w-4" />
            )}{' '}
            Run {path.split('/').pop()}
          </button>
          {!canRun && (
            <p className="text-[12px] text-[var(--vs-fg-dim)]">Open a .ts or .js file to run it.</p>
          )}
          <button
            onClick={onRunTests}
            disabled={!!running || !tests.length}
            className="flex h-[28px] w-full items-center justify-center gap-1.5 rounded-sm bg-[var(--vs-bubble)] text-[var(--vs-fg)] hover:bg-[var(--vs-active)] disabled:opacity-50"
          >
            <FlaskConicalIcon className="h-4 w-4" /> Run all tests
          </button>
        </div>

        {last && (
          <p
            className={`flex items-center gap-1.5 text-[12.5px] ${last.ok ? 'text-[var(--vs-t-green)]' : 'text-[var(--vs-err)]'}`}
          >
            {last.ok ? (
              <CircleCheckIcon className="h-4 w-4 shrink-0" />
            ) : (
              <CircleXIcon className="h-4 w-4 shrink-0" />
            )}
            <span className="min-w-0 truncate">
              {last.label.split('/').pop()} ·{' '}
              {last.passed || last.failed
                ? `${last.passed} passed${last.failed ? `, ${last.failed} failed` : ''}`
                : last.ok
                  ? 'exited 0'
                  : 'exited 1'}
              {last.ms ? ` · ${last.ms}ms` : ''}
            </span>
          </p>
        )}

        <div>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.04em]">Test files</p>
          <ul>
            {tests.length === 0 && (
              <li className="text-[12px] text-[var(--vs-fg-dim)]">
                No *.test.ts files in this branch.
              </li>
            )}
            {tests.map((t) => (
              <li
                key={t}
                className="group flex h-[22px] items-center gap-1.5 rounded-sm px-1 hover:bg-[var(--vs-hover)]"
              >
                <FileIcon path={t} />
                <span className="min-w-0 flex-1 truncate">{t}</span>
                {running === t ? (
                  <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PaneAction label={`Run ${t}`} onClick={() => onRunFile(t)}>
                    <PlayIcon className="h-3.5 w-3.5 text-[var(--vs-t-green)]" />
                  </PaneAction>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-1.5 border-t border-[var(--vs-border)] pt-3 text-[12px] leading-relaxed text-[var(--vs-fg-muted)]">
          <p className="flex items-center gap-1.5 text-[var(--vs-fg)]">
            <ShieldCheckIcon className="h-3.5 w-3.5" /> Isolated sandbox
          </p>
          <p>
            TypeScript is compiled by the editor’s own compiler and runs in a separate browser
            worker: no network, no secrets, no npm packages. Each run stops after 8 seconds.
          </p>
          <p>
            Files can import each other. Tests can use <code className="font-mono">test</code>,{' '}
            <code className="font-mono">describe</code> and{' '}
            <code className="font-mono">expect</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
