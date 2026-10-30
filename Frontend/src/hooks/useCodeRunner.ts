import { useCallback, useState } from 'react';
import type { Monaco } from '@monaco-editor/react';
import { runInSandbox } from '../utils/codeRunner';
import { isTest, runnable } from '../utils/codeFiles';
import type { OutLine, RunResult } from '../types/ide';

export interface LastRun extends RunResult {
  label: string;
}

/** Runs workspace files and tests in the sandbox and keeps the Output panel's log. */
export function useCodeRunner(getMonaco: () => Monaco | null, paths: string[]) {
  const [output, setOutput] = useState<OutLine[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [last, setLast] = useState<LastRun | null>(null);

  const append = useCallback((l: OutLine) => setOutput((o) => [...o, l].slice(-1000)), []);

  const runFile = useCallback(
    async (path: string, sink: (l: OutLine) => void = append): Promise<RunResult | null> => {
      const monaco = getMonaco();
      if (!monaco) {
        sink({ text: 'The editor is still loading — try again in a moment.', tone: 'warn' });
        return null;
      }
      if (!runnable(path)) {
        sink({
          text: `Can’t run ${path} — only .ts and .js files run in the sandbox.`,
          tone: 'warn',
        });
        return null;
      }
      const test = isTest(path);
      setRunning(path);
      sink({ text: `▶ ${test ? 'vitest run' : 'node'} ${path}`, tone: 'cmd' });
      try {
        const r = await runInSandbox(monaco, path, paths, sink);
        const summary = test
          ? `${r.failed ? `${r.failed} failed, ` : ''}${r.passed} passed`
          : r.ok
            ? 'Exited with code 0'
            : 'Exited with code 1';
        sink({ text: `${r.ok ? '✓' : '✗'} ${summary} · ${r.ms}ms`, tone: r.ok ? 'ok' : 'bad' });
        setLast({ label: path, ...r });
        return r;
      } catch (e) {
        sink({ text: e instanceof Error ? e.message : String(e), tone: 'bad' });
        setLast({ label: path, ok: false, ms: 0, passed: 0, failed: 1 });
        return null;
      } finally {
        setRunning(null);
      }
    },
    [append, getMonaco, paths],
  );

  const runTests = useCallback(
    async (sink: (l: OutLine) => void = append) => {
      const tests = paths.filter(isTest);
      if (!tests.length) {
        sink({ text: 'No test files found (*.test.ts).', tone: 'warn' });
        return { passed: 0, failed: 0 };
      }
      let passed = 0;
      let failed = 0;
      for (const t of tests) {
        const r = await runFile(t, sink);
        passed += r?.passed ?? 0;
        failed += r ? r.failed : 1;
      }
      sink({
        text: `Test files: ${tests.length} · Tests: ${failed ? `${failed} failed, ` : ''}${passed} passed`,
        tone: failed ? 'bad' : 'ok',
      });
      setLast({ label: 'All tests', ok: failed === 0, ms: 0, passed, failed });
      return { passed, failed };
    },
    [append, paths, runFile],
  );

  return { output, clearOutput: () => setOutput([]), running, last, runFile, runTests };
}
