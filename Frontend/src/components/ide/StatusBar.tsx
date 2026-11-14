import { Link } from 'react-router-dom';
import {
  ArrowLeftRightIcon,
  BellIcon,
  BracesIcon,
  CircleXIcon,
  GitBranchIcon,
  LoaderIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from 'lucide-react';

interface StatusBarProps {
  branch: string;
  dirty: boolean;
  pushed: number;
  errors: number;
  warnings: number;
  line: number;
  col: number;
  language: string;
  taskKey?: string;
  running: string | null;
  readOnly: boolean;
  onHome: () => void;
  onBranch: () => void;
  onSync: () => void;
  onProblems: () => void;
  onGoToLine: () => void;
  onLanguage: () => void;
}

const item = 'flex h-full shrink-0 items-center gap-1 px-[7px] hover:bg-[var(--vs-hover)]';

export function StatusBar({
  branch,
  dirty,
  pushed,
  errors,
  warnings,
  line,
  col,
  language,
  taskKey,
  running,
  readOnly,
  onHome,
  onBranch,
  onSync,
  onProblems,
  onGoToLine,
  onLanguage,
}: StatusBarProps) {
  return (
    <footer className="flex h-[22px] shrink-0 select-none items-center justify-between overflow-hidden border-t border-[var(--vs-border)] bg-[var(--vs-title)] text-[12px] text-[var(--vs-fg-muted)]">
      <div className="flex h-full min-w-0 items-center">
        <button
          onClick={onHome}
          title="TavetaHQ sandbox — back to dashboard"
          className="flex h-full items-center gap-1 bg-[var(--vs-accent)] px-2.5 text-[var(--vs-on-accent)] hover:bg-[var(--vs-accent-hover)]"
        >
          <ArrowLeftRightIcon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Sandbox</span>
        </button>
        <button onClick={onBranch} className={item} title="Checkout branch">
          <GitBranchIcon className="h-3.5 w-3.5" />
          <span className="max-w-[180px] truncate">
            {branch}
            {dirty ? '*' : ''}
          </span>
        </button>
        <button onClick={onSync} className={`${item} hidden sm:flex`} title="Synchronize changes">
          <RefreshCwIcon className="h-3.5 w-3.5" />
          {pushed > 0 && <span>{pushed}↑</span>}
        </button>
        <button onClick={onProblems} className={item} title="Problems">
          <CircleXIcon className="h-3.5 w-3.5" /> {errors}
          <TriangleAlertIcon className="ml-1 h-3.5 w-3.5" /> {warnings}
        </button>
        {running && (
          <span className={`${item} text-[var(--vs-fg)]`}>
            <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
            <span className="max-w-[160px] truncate">Running {running.split('/').pop()}</span>
          </span>
        )}
        {readOnly && <span className={item}>Read-only</span>}
      </div>
      <div className="flex h-full items-center">
        {taskKey && (
          <Link
            to={`/tasks/${taskKey}`}
            className={`${item} hidden md:flex`}
            title="Linked TavetaHQ task"
          >
            {taskKey}
          </Link>
        )}
        <button onClick={onGoToLine} className={item} title="Go to Line/Column">
          Ln {line}, Col {col}
        </button>
        <span className={`${item} hidden md:flex`}>Spaces: 2</span>
        <span className={`${item} hidden lg:flex`}>UTF-8</span>
        <span className={`${item} hidden lg:flex`}>LF</span>
        <button onClick={onLanguage} className={item} title="Format document">
          <BracesIcon className="h-3.5 w-3.5" /> {language}
        </button>
        <span className={item} aria-label="No new notifications">
          <BellIcon className="h-3.5 w-3.5" />
        </span>
      </div>
    </footer>
  );
}
