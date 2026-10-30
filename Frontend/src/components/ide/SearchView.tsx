import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  CaseSensitiveIcon,
  ChevronRightIcon,
  RegexIcon,
  ReplaceAllIcon,
  WholeWordIcon,
} from 'lucide-react';
import { FileIcon } from './FileIcon';
import { PaneHeader } from './PaneHeader';
import type { CodeFile } from '../../data/codeWorkspace';

interface SearchViewProps {
  files: CodeFile[];
  readOnly: boolean;
  onOpen: (path: string, line: number, col: number) => void;
  onReplace: (edits: { path: string; content: string }[]) => void;
}

interface Hit {
  line: number;
  col: number;
  text: string;
  start: number;
  end: number;
}

const LIMIT = 2000;

/** Find (and replace) across every file in the branch, with case, whole-word and regex options. */
export function SearchView({ files, readOnly, onOpen, onReplace }: SearchViewProps) {
  const [q, setQ] = useState('');
  const [rep, setRep] = useState('');
  const [showRep, setShowRep] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [folded, setFolded] = useState<Set<string>>(new Set());

  const { re, error } = useMemo(() => {
    if (!q) return { re: null, error: '' };
    try {
      const src = useRegex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return {
        re: new RegExp(wholeWord ? `\\b${src}\\b` : src, matchCase ? 'g' : 'gi'),
        error: '',
      };
    } catch (e) {
      return { re: null, error: e instanceof Error ? e.message : 'Invalid pattern' };
    }
  }, [q, matchCase, wholeWord, useRegex]);

  const results = useMemo(() => {
    if (!re) return [];
    let total = 0;
    return files
      .map((f) => {
        const hits: Hit[] = [];
        f.content.split('\n').forEach((text, i) => {
          const r = new RegExp(re.source, re.flags);
          let m: RegExpExecArray | null;
          while ((m = r.exec(text)) && total < LIMIT) {
            hits.push({
              line: i + 1,
              col: m.index + 1,
              text,
              start: m.index,
              end: m.index + m[0].length,
            });
            total++;
            if (m[0].length === 0) r.lastIndex++;
          }
        });
        return { path: f.path, hits };
      })
      .filter((r) => r.hits.length > 0);
  }, [re, files]);

  const count = results.reduce((n, r) => n + r.hits.length, 0);

  const replaceIn = (paths: string[]) => {
    if (!re || readOnly) return;
    const edits = files
      .filter((f) => paths.includes(f.path))
      .map((f) => ({
        path: f.path,
        content: f.content.replace(new RegExp(re.source, re.flags), rep),
      }));
    const n = results.filter((r) => paths.includes(r.path)).reduce((s, r) => s + r.hits.length, 0);
    onReplace(edits);
    toast.success(
      `Replaced ${n} occurrence${n === 1 ? '' : 's'} in ${edits.length} file${edits.length === 1 ? '' : 's'}`,
    );
  };

  const opt = (
    on: boolean,
    label: string,
    onClick: () => void,
    Icon: React.ComponentType<{ className?: string }>,
  ) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={label}
      aria-label={label}
      className={`rounded-[3px] p-[2px] ${on ? 'bg-[color-mix(in_srgb,var(--vs-accent)_30%,transparent)] text-[var(--vs-fg)] outline outline-1 outline-[var(--vs-accent)]' : 'text-[var(--vs-fg-muted)] hover:bg-[var(--vs-hover)]'}`}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );

  const field =
    'h-[26px] w-full rounded-sm border border-[var(--vs-input-border)] bg-[var(--vs-input)] pl-2 text-[13px] text-[var(--vs-fg)] outline-none placeholder:text-[var(--vs-fg-dim)] focus:border-[var(--vs-accent)]';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneHeader variant="view" title="Search" />
      <div className="flex gap-1 px-2 pb-2">
        <button
          type="button"
          onClick={() => setShowRep((v) => !v)}
          aria-expanded={showRep}
          aria-label="Toggle replace"
          className="flex w-4 shrink-0 items-start justify-center rounded pt-1 text-[var(--vs-fg)] hover:bg-[var(--vs-hover)]"
        >
          <ChevronRightIcon
            className={`h-4 w-4 transition-transform duration-100 ${showRep ? 'rotate-90' : ''}`}
          />
        </button>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="relative">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search"
              aria-label="Search"
              className={`${field} pr-[76px]`}
              spellCheck={false}
            />
            <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
              {opt(matchCase, 'Match Case', () => setMatchCase((v) => !v), CaseSensitiveIcon)}
              {opt(wholeWord, 'Match Whole Word', () => setWholeWord((v) => !v), WholeWordIcon)}
              {opt(useRegex, 'Use Regular Expression', () => setUseRegex((v) => !v), RegexIcon)}
            </div>
          </div>
          {showRep && (
            <div className="flex items-center gap-1">
              <input
                value={rep}
                onChange={(e) => setRep(e.target.value)}
                placeholder="Replace"
                aria-label="Replace"
                className={field}
                spellCheck={false}
                disabled={readOnly}
              />
              <button
                type="button"
                onClick={() => replaceIn(results.map((r) => r.path))}
                disabled={!count || readOnly}
                title="Replace All"
                aria-label="Replace All"
                className="rounded p-1 text-[var(--vs-fg)] hover:bg-[var(--vs-hover)] disabled:opacity-40"
              >
                <ReplaceAllIcon className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
      {error && (
        <p className="mx-3 mb-2 rounded-sm border border-[var(--vs-err)] px-2 py-1 text-[12px] text-[var(--vs-err)]">
          {error}
        </p>
      )}
      {q && !error && (
        <p className="px-5 pb-1 text-[12px] text-[var(--vs-fg-muted)]">
          {count
            ? `${count}${count >= LIMIT ? '+' : ''} result${count === 1 ? '' : 's'} in ${results.length} file${results.length === 1 ? '' : 's'}`
            : 'No results found.'}
        </p>
      )}
      <ul className="min-h-0 flex-1 overflow-y-auto pb-2 text-[13px] ide-scroll">
        {results.map((r) => {
          const open = !folded.has(r.path);
          return (
            <li key={r.path}>
              <div className="group flex h-[22px] items-center pr-2 hover:bg-[var(--vs-hover)]">
                <button
                  onClick={() =>
                    setFolded((s) => {
                      const n = new Set(s);
                      if (n.has(r.path)) n.delete(r.path);
                      else n.add(r.path);
                      return n;
                    })
                  }
                  className="flex min-w-0 flex-1 items-center gap-1 pl-1 text-left"
                  aria-expanded={open}
                >
                  <ChevronRightIcon
                    className={`h-4 w-4 shrink-0 transition-transform duration-100 ${open ? 'rotate-90' : ''}`}
                  />
                  <FileIcon path={r.path} />
                  <span className="truncate">{r.path.split('/').pop()}</span>
                  <span className="min-w-0 truncate text-[12px] text-[var(--vs-fg-dim)]">
                    {r.path.split('/').slice(0, -1).join('/')}
                  </span>
                </button>
                {showRep && !readOnly && (
                  <button
                    onClick={() => replaceIn([r.path])}
                    title="Replace in file"
                    aria-label={`Replace in ${r.path}`}
                    className="hidden rounded p-0.5 group-hover:block hover:bg-[var(--vs-active)]"
                  >
                    <ReplaceAllIcon className="h-3.5 w-3.5" />
                  </button>
                )}
                <span className="ml-1 rounded-full bg-[var(--vs-bubble)] px-1.5 text-[11px] text-[var(--vs-fg)]">
                  {r.hits.length}
                </span>
              </div>
              {open && (
                <ul>
                  {r.hits.map((h) => {
                    const from = Math.max(0, h.start - 24);
                    return (
                      <li key={`${h.line}:${h.col}`}>
                        <button
                          onClick={() => onOpen(r.path, h.line, h.col)}
                          className="flex h-[22px] w-full items-center gap-2 pl-10 pr-3 text-left hover:bg-[var(--vs-hover)]"
                          title={`${r.path}:${h.line}`}
                        >
                          <span className="min-w-0 flex-1 truncate whitespace-pre">
                            {from > 0 && '…'}
                            {h.text.slice(from, h.start).trimStart()}
                            <span
                              className={
                                showRep && rep
                                  ? 'bg-[color-mix(in_srgb,var(--vs-del)_25%,transparent)] line-through'
                                  : 'rounded-sm bg-[var(--vs-mark)]'
                              }
                            >
                              {h.text.slice(h.start, h.end)}
                            </span>
                            {showRep && rep && (
                              <span className="bg-[color-mix(in_srgb,var(--vs-add)_25%,transparent)]">
                                {rep}
                              </span>
                            )}
                            {h.text.slice(h.end)}
                          </span>
                          <span className="shrink-0 text-[11px] text-[var(--vs-fg-dim)]">
                            {h.line}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
