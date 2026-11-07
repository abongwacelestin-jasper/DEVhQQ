import { useCallback, useState } from 'react';
import { languageLabel, outlineOf } from '../utils/codeFiles';
import type { CodeFile } from '../data/codeWorkspace';
import type { IdeMarker } from '../types/ide';

export interface ChatRef {
  path: string;
  line: number;
  text: string;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  refs?: ChatRef[];
  action?: { label: string; run: () => void };
}

interface AssistantOptions {
  repo: string;
  file: CodeFile;
  files: CodeFile[];
  problems: IdeMarker[];
  readOnly: boolean;
  onRunFile: () => Promise<unknown>;
  onRunTests: () => Promise<{ passed: number; failed: number }>;
  onApply: (content: string) => void;
}

export const slashCommands = [
  { cmd: '/explain', hint: 'Explain the open file' },
  { cmd: '/review', hint: 'List problems in this file' },
  { cmd: '/fix', hint: 'Remove console.log & trailing spaces' },
  { cmd: '/tests', hint: 'Run all tests' },
  { cmd: '/run', hint: 'Run the open file' },
];

const stop = new Set([
  'the',
  'and',
  'for',
  'with',
  'what',
  'where',
  'does',
  'this',
  'that',
  'how',
  'why',
  'are',
  'can',
  'you',
  'show',
  'find',
  'file',
  'code',
  'used',
  'use',
]);
let nextId = 1;

/**
 * The IDE's local code helper. It is deterministic analysis of the files open in
 * this branch (outline, problems, text search) — not a model and not canned
 * answers. Every slash command performs a real action through the IDE's own
 * callbacks: `/fix` edits the buffer (undoable), `/tests` and `/run` go through
 * the code runner. Workspace-wide questions belong to Ask DevHQ (ML service).
 */
export function useWorkspaceAssistant({
  repo,
  file,
  files,
  problems,
  readOnly,
  onRunFile,
  onRunTests,
  onApply,
}: AssistantOptions) {
  const welcome = (): ChatMessage => ({
    id: nextId++,
    role: 'assistant',
    text: `Hi — I can explain, review and run code in ${repo}. Everything happens in your browser. Try /explain, /review, /fix, /tests or /run, or ask where something is used.`,
  });
  const [messages, setMessages] = useState<ChatMessage[]>(() => [welcome()]);
  const [busy, setBusy] = useState(false);
  const say = (m: Omit<ChatMessage, 'id' | 'role'>) =>
    setMessages((l) => [...l, { id: nextId++, role: 'assistant', ...m }]);

  const cleaned = (content: string) => {
    const lines = content.split('\n');
    const logs = lines.filter((l) => /^\s*console\.log\(.*\);?\s*$/.test(l)).length;
    const trailing = lines.filter((l) => /\s+$/.test(l)).length;
    const next = lines
      .filter((l) => !/^\s*console\.log\(.*\);?\s*$/.test(l))
      .map((l) => l.replace(/\s+$/, ''))
      .join('\n');
    return { next: next.endsWith('\n') ? next : `${next}\n`, logs, trailing };
  };

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      setMessages((l) => [...l, { id: nextId++, role: 'user', text }]);
      const lower = text.toLowerCase();
      const name = file.path.split('/').pop();

      if (lower.startsWith('/explain') || lower.startsWith('explain')) {
        const lines = file.content.split('\n');
        const symbols = outlineOf(file.path, file.content);
        const imports = lines
          .map((l) => l.match(/^import .* from ['"](.+)['"]/)?.[1])
          .filter((x): x is string => !!x);
        const doc = file.content.match(/\/\*\*\s*([^*]+?)\s*\*\//)?.[1];
        say({
          text: [
            `${name} is a ${languageLabel(file.path)} file with ${lines.length} lines.`,
            doc ? `Its doc comment says: “${doc}”.` : '',
            symbols.length
              ? `It declares ${symbols.length} top-level symbol${symbols.length > 1 ? 's' : ''}: ${symbols.map((s) => `${s.name} (${s.kind})`).join(', ')}.`
              : 'It has no top-level declarations.',
            imports.length
              ? `It depends on ${imports.join(', ')}.`
              : 'It doesn’t import other modules.',
          ]
            .filter(Boolean)
            .join('\n'),
          refs: symbols.slice(0, 8).map((s) => ({ path: file.path, line: s.line, text: s.name })),
        });
        return;
      }

      if (lower.startsWith('/review') || /\b(problem|error|bug|issue|review)s?\b/.test(lower)) {
        const mine = problems.filter((p) => p.file === file.path);
        const { logs } = cleaned(file.content);
        if (!mine.length) {
          say({
            text: `No problems in ${name}. Type checking, lint and the secret scan are all clean.`,
          });
          return;
        }
        say({
          text: `${mine.length} problem${mine.length > 1 ? 's' : ''} in ${name}:\n${mine
            .slice(0, 8)
            .map((p) => `• Line ${p.line}: ${p.message.split('\n')[0]}`)
            .join('\n')}`,
          refs: mine.slice(0, 8).map((p) => ({ path: p.file, line: p.line, text: p.severity })),
          action:
            logs && !readOnly
              ? {
                  label: `Remove ${logs} console.log line${logs > 1 ? 's' : ''}`,
                  run: () => onApply(cleaned(file.content).next),
                }
              : undefined,
        });
        return;
      }

      if (lower.startsWith('/fix')) {
        if (readOnly) {
          say({ text: 'Your role can’t edit code, so I can’t apply fixes here.' });
          return;
        }
        const { next, logs, trailing } = cleaned(file.content);
        if (!logs && !trailing) {
          say({ text: `${name} is already tidy — no console.log calls or trailing spaces.` });
          return;
        }
        onApply(next);
        say({
          text: `Removed ${logs} console.log line${logs === 1 ? '' : 's'} and trailing spaces on ${trailing} line${trailing === 1 ? '' : 's'} in ${name}, then formatted it. Undo with Ctrl+Z.`,
        });
        return;
      }

      if (lower.startsWith('/tests') || lower.startsWith('/test')) {
        setBusy(true);
        try {
          const r = await onRunTests();
          say({
            text: r.failed
              ? `${r.failed} test${r.failed > 1 ? 's' : ''} failed and ${r.passed} passed. Details are in the Output panel.`
              : `All ${r.passed} tests passed. Full output is in the Output panel.`,
          });
        } catch (e) {
          say({ text: `The test run failed: ${e instanceof Error ? e.message : 'no response'}.` });
        } finally {
          setBusy(false);
        }
        return;
      }

      if (lower.startsWith('/run')) {
        setBusy(true);
        try {
          await onRunFile();
          say({ text: `Ran ${name} in the sandbox — see the Output panel for the result.` });
        } catch (e) {
          say({ text: `Couldn’t run ${name}: ${e instanceof Error ? e.message : 'no response'}.` });
        } finally {
          setBusy(false);
        }
        return;
      }

      const words = Array.from(new Set(lower.match(/[a-z_$][a-z0-9_$]{2,}/g) ?? [])).filter(
        (w) => !stop.has(w),
      );
      const refs: ChatRef[] = [];
      files.forEach((f) =>
        f.content.split('\n').forEach((line, i) => {
          if (refs.length < 8 && words.some((w) => line.toLowerCase().includes(w)))
            refs.push({ path: f.path, line: i + 1, text: line.trim().slice(0, 70) });
        }),
      );
      say(
        refs.length
          ? { text: `Here’s where “${words.slice(0, 3).join('”, “')}” shows up in ${repo}:`, refs }
          : {
              text: 'I couldn’t find that in this branch. I work offline on the files here — try /explain, /review, /fix, /tests or /run.',
            },
      );
    },
    [busy, file, files, problems, readOnly, repo, onApply, onRunFile, onRunTests],
  );

  return { messages, busy, send, reset: () => setMessages([welcome()]) };
}
