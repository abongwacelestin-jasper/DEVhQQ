import { useEffect, useRef, useState } from 'react';
import { ArrowUpIcon, LoaderIcon, PlusIcon, SparklesIcon, XIcon } from 'lucide-react';
import { FileIcon } from './FileIcon';
import { PaneAction } from './PaneHeader';
import { slashCommands, useWorkspaceAssistant } from '../../hooks/useWorkspaceAssistant';
import type { CodeFile } from '../../data/codeWorkspace';
import type { IdeMarker } from '../../types/ide';

interface ChatViewProps {
  repo: string;
  file: CodeFile;
  files: CodeFile[];
  problems: IdeMarker[];
  readOnly: boolean;
  onRunFile: () => Promise<unknown>;
  onRunTests: () => Promise<{ passed: number; failed: number }>;
  onApply: (content: string) => void;
  onOpen: (path: string, line: number) => void;
  onClose: () => void;
}

export function ChatView({
  repo,
  file,
  files,
  problems,
  readOnly,
  onRunFile,
  onRunTests,
  onApply,
  onOpen,
  onClose,
}: ChatViewProps) {
  const { messages, busy, send, reset } = useWorkspaceAssistant({
    repo,
    file,
    files,
    problems,
    readOnly,
    onRunFile,
    onRunTests,
    onApply,
  });
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, busy]);

  const submit = (text = draft) => {
    if (!text.trim()) return;
    send(text);
    setDraft('');
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--vs-side)]">
      <div className="flex h-[35px] shrink-0 items-center justify-between border-b border-[var(--vs-border)] pl-3 pr-2">
        <span className="rounded-[5px] bg-[var(--vs-bubble)] px-2 py-0.5 text-[13px] text-[var(--vs-fg)]">
          Chat
        </span>
        <div className="flex items-center gap-0.5">
          <PaneAction label="New Chat" onClick={reset}>
            <PlusIcon className="h-4 w-4" />
          </PaneAction>
          <PaneAction label="Close Chat" onClick={onClose}>
            <XIcon className="h-4 w-4" />
          </PaneAction>
        </div>
      </div>
      <p className="flex shrink-0 items-center gap-1.5 px-4 py-2 text-[12px] text-[var(--vs-fg-muted)]">
        <SparklesIcon className="h-3.5 w-3.5" /> DevHQ Assistant · runs locally, code never leaves
        the browser
      </p>

      <div
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4 text-[13px] leading-relaxed ide-scroll"
        aria-live="polite"
      >
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-[var(--vs-bubble)] px-3 py-2 text-[var(--vs-fg)]">
                {m.text}
              </p>
            </div>
          ) : (
            <div key={m.id} className="space-y-2 text-[var(--vs-fg)]">
              <p className="whitespace-pre-wrap">{m.text}</p>
              {m.refs && m.refs.length > 0 && (
                <ul className="space-y-0.5">
                  {m.refs.map((r, i) => (
                    <li key={`${r.path}:${r.line}:${i}`}>
                      <button
                        onClick={() => onOpen(r.path, r.line)}
                        className="flex w-full items-center gap-1.5 rounded-[4px] px-1.5 py-0.5 text-left font-mono text-[12px] hover:bg-[var(--vs-hover)]"
                      >
                        <FileIcon path={r.path} />
                        <span className="shrink-0 text-[var(--vs-t-blue)]">
                          {r.path.split('/').pop()}:{r.line}
                        </span>
                        <span className="min-w-0 truncate text-[var(--vs-fg-muted)]">{r.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {m.action && (
                <button
                  onClick={m.action.run}
                  className="rounded-sm bg-[var(--vs-accent)] px-2.5 py-1 text-[12.5px] text-[var(--vs-on-accent)] hover:bg-[var(--vs-accent-hover)]"
                >
                  {m.action.label}
                </button>
              )}
            </div>
          ),
        )}
        {busy && (
          <p className="flex items-center gap-1.5 text-[var(--vs-fg-muted)]">
            <LoaderIcon className="h-3.5 w-3.5 animate-spin" /> Working in the sandbox…
          </p>
        )}
        <div ref={endRef} />
      </div>

      <div className="shrink-0 p-3">
        <div className="rounded-lg border border-[var(--vs-input-border)] bg-[var(--vs-input)] focus-within:border-[var(--vs-accent)]">
          <div className="flex items-center gap-1.5 px-2.5 pt-2">
            <span className="inline-flex max-w-full items-center gap-1 rounded-[4px] border border-dashed border-[var(--vs-input-border)] px-1.5 py-0.5 text-[12px] italic text-[var(--vs-fg-muted)]">
              <FileIcon path={file.path} />
              <span className="truncate">{file.path.split('/').pop()}</span>
            </span>
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            placeholder="Ask about this workspace, or type / for commands"
            aria-label="Chat message"
            className="block w-full resize-none bg-transparent px-2.5 py-2 text-[13px] text-[var(--vs-fg)] outline-none placeholder:text-[var(--vs-fg-dim)]"
          />

          <div className="flex items-center gap-1 px-2 pb-2">
            <div className="no-scrollbar flex min-w-0 flex-1 gap-1 overflow-x-auto">
              {slashCommands.map((c) => (
                <button
                  key={c.cmd}
                  onClick={() => submit(c.cmd)}
                  title={c.hint}
                  disabled={busy}
                  className="shrink-0 rounded-[4px] px-1.5 py-0.5 font-mono text-[11.5px] text-[var(--vs-fg-muted)] hover:bg-[var(--vs-hover)] hover:text-[var(--vs-fg)] disabled:opacity-50"
                >
                  {c.cmd}
                </button>
              ))}
            </div>
            <button
              onClick={() => submit()}
              disabled={!draft.trim() || busy}
              aria-label="Send"
              className="rounded-[5px] bg-[var(--vs-accent)] p-1 text-[var(--vs-on-accent)] disabled:bg-transparent disabled:text-[var(--vs-fg-dim)]"
            >
              <ArrowUpIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
