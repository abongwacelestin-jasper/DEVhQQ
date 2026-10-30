import { useState } from 'react';
import { toast } from 'sonner';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CheckIcon,
  FileSymlinkIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  ShieldAlertIcon,
  Undo2Icon,
} from 'lucide-react';
import { FileIcon } from './FileIcon';
import { PaneAction, PaneHeader } from './PaneHeader';
import { statusColor } from './ExplorerView';
import type { WorkspaceCommit } from '../../hooks/useCodeWorkspace';
import type { ChangedFile, LintProblem } from '../../types/ide';

interface SourceControlViewProps {
  branch: string;
  changes: ChangedFile[];
  blocked: LintProblem[];
  commits: WorkspaceCommit[];
  stashCount: number;
  readOnly: boolean;
  onCommit: (message: string, openPr: boolean) => boolean;
  onOpenDiff: (path: string) => void;
  onOpenFile: (path: string) => void;
  onDiscard: (path: string) => void;
  onDiscardAll: () => void;
  onStash: () => void;
  onPop: () => void;
  onBranch: () => void;
}

export function SourceControlView({
  branch,
  changes,
  blocked,
  commits,
  stashCount,
  readOnly,
  onCommit,
  onOpenDiff,
  onOpenFile,
  onDiscard,
  onDiscardAll,
  onStash,
  onPop,
  onBranch,
}: SourceControlViewProps) {
  const [message, setMessage] = useState('');
  const [openPr, setOpenPr] = useState(false);
  const [open, setOpen] = useState({ changes: true, commits: true });

  const submit = () => {
    if (!message.trim()) {
      toast.error('Enter a commit message first');
      return;
    }
    if (onCommit(message.trim(), openPr)) setMessage('');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneHeader
        variant="view"
        title="Source Control"
        actions={
          !readOnly && (
            <>
              <PaneAction label="Stash Changes" onClick={onStash} disabled={!changes.length}>
                <ArchiveIcon className="h-4 w-4" />
              </PaneAction>
              <PaneAction
                label={`Pop Stash${stashCount ? ` (${stashCount})` : ''}`}
                onClick={onPop}
                disabled={!stashCount}
              >
                <ArchiveRestoreIcon className="h-4 w-4" />
              </PaneAction>
              <PaneAction
                label="Discard All Changes"
                onClick={onDiscardAll}
                disabled={!changes.length}
              >
                <Undo2Icon className="h-4 w-4" />
              </PaneAction>
            </>
          )
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto ide-scroll">
        <div className="space-y-2 px-3 pb-3">
          <button
            onClick={onBranch}
            className="flex w-full items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-[12.5px] text-[var(--vs-fg-muted)] hover:bg-[var(--vs-hover)]"
            title="Checkout or create a branch"
          >
            <GitBranchIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{branch}</span>
            {branch === 'main' && (
              <span className="ml-auto shrink-0 rounded-sm bg-[color-mix(in_srgb,var(--vs-warn)_20%,transparent)] px-1 text-[11px] text-[var(--vs-warn)]">
                protected
              </span>
            )}
          </button>
          <textarea
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            disabled={readOnly}
            placeholder={`Message (Ctrl+Enter to commit on "${branch}")`}
            aria-label="Commit message"
            className="w-full resize-y rounded-sm border border-[var(--vs-input-border)] bg-[var(--vs-input)] px-2 py-1.5 text-[13px] text-[var(--vs-fg)] outline-none placeholder:text-[var(--vs-fg-dim)] focus:border-[var(--vs-accent)] disabled:opacity-60"
          />

          {blocked.length > 0 && (
            <p className="flex items-start gap-1.5 rounded-sm border border-[var(--vs-err)] px-2 py-1.5 text-[12px] text-[var(--vs-err)]">
              <ShieldAlertIcon className="mt-px h-3.5 w-3.5 shrink-0" />
              Commits are blocked: {blocked.length} possible secret{blocked.length > 1 ? 's' : ''}{' '}
              in changed files ({blocked[0].file}:{blocked[0].line}).
            </p>
          )}
          <button
            onClick={submit}
            disabled={!changes.length || readOnly}
            className="flex h-[28px] w-full items-center justify-center gap-1.5 rounded-sm bg-[var(--vs-accent)] text-[13px] text-[var(--vs-on-accent)] transition-colors duration-100 hover:bg-[var(--vs-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CheckIcon className="h-4 w-4" /> Commit &amp; Push
          </button>
          <label className="flex items-center gap-2 text-[12px] text-[var(--vs-fg-muted)]">
            <input
              type="checkbox"
              checked={openPr}
              onChange={(e) => setOpenPr(e.target.checked)}
              disabled={readOnly}
              className="h-3.5 w-3.5"
              style={{ accentColor: 'var(--vs-accent)' }}
            />
            Open a pull request after pushing
          </label>
          {readOnly && (
            <p className="text-[12px] text-[var(--vs-fg-dim)]">
              Your role can read code here but can’t commit.
            </p>
          )}
        </div>

        <PaneHeader
          variant="section"
          title={`Changes${changes.length ? ` · ${changes.length}` : ''}`}
          open={open.changes}
          onToggle={() => setOpen((o) => ({ ...o, changes: !o.changes }))}
        />
        {open.changes && (
          <ul className="pb-2 text-[13px]">
            {changes.length === 0 && (
              <li className="px-5 py-1 text-[12px] text-[var(--vs-fg-dim)]">
                No changes on this branch.
              </li>
            )}
            {changes.map((c) => (
              <li
                key={c.path}
                className="group flex h-[22px] items-center pr-2 hover:bg-[var(--vs-hover)]"
              >
                <button
                  onClick={() => (c.status === 'D' ? undefined : onOpenDiff(c.path))}
                  className="flex min-w-0 flex-1 items-center gap-1.5 pl-5 text-left"
                  title={`${c.path} — open changes`}
                >
                  <FileIcon path={c.path} />
                  <span className={`truncate ${c.status === 'D' ? 'line-through' : ''}`}>
                    {c.path.split('/').pop()}
                  </span>
                  <span className="min-w-0 truncate text-[12px] text-[var(--vs-fg-dim)]">
                    {c.path.split('/').slice(0, -1).join('/')}
                  </span>
                </button>
                <span className="hidden items-center gap-0.5 group-hover:flex">
                  {c.status !== 'D' && (
                    <PaneAction label="Open File" onClick={() => onOpenFile(c.path)}>
                      <FileSymlinkIcon className="h-3.5 w-3.5" />
                    </PaneAction>
                  )}
                  {!readOnly && (
                    <PaneAction
                      label="Discard Changes"
                      onClick={() =>
                        window.confirm(`Discard changes in ${c.path}?`) && onDiscard(c.path)
                      }
                    >
                      <Undo2Icon className="h-3.5 w-3.5" />
                    </PaneAction>
                  )}
                </span>
                <span
                  className={`ml-1 w-3 text-center text-[11px] font-semibold ${statusColor[c.status]}`}
                >
                  {c.status === 'A' ? 'U' : c.status}
                </span>
              </li>
            ))}
          </ul>
        )}

        <PaneHeader
          variant="section"
          title="Commits"
          open={open.commits}
          onToggle={() => setOpen((o) => ({ ...o, commits: !o.commits }))}
        />
        {open.commits && (
          <ul className="pb-2 text-[13px]">
            {commits.length === 0 && (
              <li className="px-5 py-1 text-[12px] text-[var(--vs-fg-dim)]">
                Nothing pushed from this workspace yet.
              </li>
            )}
            {commits.map((c) => (
              <li key={c.sha} className="flex items-start gap-1.5 px-5 py-1">
                <GitCommitHorizontalIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--vs-fg-dim)]" />
                <span className="min-w-0">
                  <span className="block truncate">{c.message}</span>
                  <span className="block text-[11.5px] text-[var(--vs-fg-dim)]">
                    {c.sha} · {c.branch} · {c.files} file{c.files === 1 ? '' : 's'}
                    {c.signed ? ' · signed' : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
