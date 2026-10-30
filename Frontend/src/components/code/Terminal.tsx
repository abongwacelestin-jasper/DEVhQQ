import { useEffect, useRef, useState } from 'react';
import type { TermLine } from '../../types/ide';

interface TerminalProps {
  lines: TermLine[];
  onCommand: (cmd: string) => void;
  cwd: string;
  branch: string;
  /** File paths used for Tab completion after file commands. */
  files?: string[];
  branches?: string[];
}

const toneCls: Record<NonNullable<TermLine['tone']>, string> = {
  ok: 'text-[var(--vs-t-green)]',
  bad: 'text-[var(--vs-t-red)]',
  warn: 'text-[var(--vs-t-yellow)]',
  muted: 'text-[var(--vs-fg-dim)]',
  cmd: 'text-[var(--vs-t-blue)]',
};
const commands = [
  'help',
  'node',
  'ls',
  'cat',
  'code',
  'touch',
  'rm',
  'mv',
  'grep',
  'wc',
  'pwd',
  'git status',
  'git diff',
  'git log',
  'git branch',
  'git checkout',
  'git stash',
  'git stash pop',
  'git stash list',
  'npm test',
  'npm run lint',
  'npx tsc --noEmit',
  'scan',
  'whoami',
  'date',
  'echo',
  'history',
  'clear',
];

/** Sandboxed terminal: built-in commands plus real `node <file>` and `npm test` runs in an isolated worker. */
export function Terminal({
  lines,
  onCommand,
  cwd,
  branch,
  files = [],
  branches = [],
}: TerminalProps) {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [pos, setPos] = useState(-1);
  const [hint, setHint] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lines.length, hint.length]);

  const submit = (cmd: string) => {
    const c = cmd.trim();
    setInput('');
    setHint([]);
    setPos(-1);
    if (!c) return;
    setHistory((h) => [c, ...h.filter((x) => x !== c)].slice(0, 50));
    onCommand(c);
  };

  const complete = () => {
    const parts = input.split(' ');
    const last = parts[parts.length - 1];
    const head = parts.slice(0, -1).join(' ');
    if (
      parts.length === 1 ||
      (parts[0] === 'git' && parts.length === 2) ||
      (parts[0] === 'npm' && parts.length <= 3)
    ) {
      const pool = commands.filter((c) => c.startsWith(input));
      if (pool.length === 1) setInput(`${pool[0]} `);
      else setHint(pool.slice(0, 10));
      return;
    }
    const pool = (head.startsWith('git checkout') ? branches : files).filter(
      (f) => f.startsWith(last) || (f.split('/').pop() ?? '').startsWith(last),
    );
    if (pool.length === 1) {
      setInput(`${head} ${pool[0]}`);
      setHint([]);
    } else setHint(pool.slice(0, 10));
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-[var(--vs-panel)] font-mono text-[12.5px] leading-[19px] text-[var(--vs-fg)]"
      onClick={() => {
        if (!window.getSelection()?.toString()) inputRef.current?.focus();
      }}
    >
      <div
        className="min-h-0 flex-1 overflow-y-auto px-4 py-2 ide-scroll"
        role="log"
        aria-live="polite"
      >
        {lines.map((l) => (
          <div
            key={l.id}
            className={`whitespace-pre-wrap break-words ${l.tone ? toneCls[l.tone] : ''}`}
          >
            {l.text}
          </div>
        ))}
        {hint.length > 0 && <div className="text-[var(--vs-fg-dim)]">{hint.join('    ')}</div>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className="flex items-center gap-2"
        >
          <span className="shrink-0">
            <span className="text-[var(--vs-t-green)]">{cwd}</span>{' '}
            <span className="text-[var(--vs-t-blue)]">({branch})</span>{' '}
            <span className="text-[var(--vs-fg-dim)]">$</span>
          </span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setHint([]);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                e.preventDefault();
                complete();
              } else if (e.key === 'l' && e.ctrlKey) {
                e.preventDefault();
                onCommand('clear');
              } else if (e.key === 'c' && e.ctrlKey && !window.getSelection()?.toString()) {
                e.preventDefault();
                setInput('');
                setHint(['^C']);
              } else if (e.key === 'ArrowUp' && history.length) {
                e.preventDefault();
                const n = Math.min(history.length - 1, pos + 1);
                setPos(n);
                setInput(history[n]);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                const n = Math.max(-1, pos - 1);
                setPos(n);
                setInput(n >= 0 ? history[n] : '');
              }
            }}
            spellCheck={false}
            autoComplete="off"
            aria-label="Terminal command"
            className="min-w-0 flex-1 bg-transparent text-[var(--vs-fg)] caret-[var(--vs-fg)] outline-none"
          />
        </form>
        <div ref={endRef} />
      </div>
    </div>
  );
}
