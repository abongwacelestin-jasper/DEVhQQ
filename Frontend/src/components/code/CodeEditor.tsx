import { useEffect, useRef, useState } from 'react';
import { Editor, type Monaco, type OnMount } from '@monaco-editor/react';
import './monacoLoader';
import { setupMonaco } from '../../utils/monacoSetup';
import { languageOf } from '../../utils/codeFiles';
import type { CodeFile } from '../../data/codeWorkspace';
import type { IdeMarker, IdeSettings, LintProblem } from '../../types/ide';

export type IdeEditor = Parameters<OnMount>[0];

interface CodeEditorProps {
  files: CodeFile[];
  path: string;
  settings: IdeSettings;
  lint: LintProblem[];
  readOnly?: boolean;
  hidden?: boolean;
  onChange: (path: string, value: string) => void;
  onReady: (editor: IdeEditor, monaco: Monaco) => void;
  onCursor: (line: number, col: number) => void;
  onMarkers: (markers: IdeMarker[]) => void;
}

const lintMessages: Record<string, string> = {
  'no-console':
    'Unexpected console.log — use console.info for intentional output, or remove before merging. (no-console)',
  'no-explicit-any': 'Avoid `any` — give this value a real type. (no-explicit-any)',
  'todo-comment': 'TODO left in code — link it to a DevHQ task. (todo-comment)',
};

const uriFor = (monaco: Monaco, path: string) => monaco.Uri.parse(`file:///${path}`);

/**
 * The few Monaco shapes this component touches, typed structurally so the
 * callbacks below never fall back to `any`.
 */
interface MonacoModel {
  uri: { scheme: string; path: string; toString(): string };
  dispose(): void;
}

interface MonacoMarker {
  resource: { scheme: string; path: string };
  startLineNumber: number;
  startColumn: number;
  message: string;
  severity: number;
  owner: string;
}

/** Monaco (the editor behind VS Code) with a model per workspace file, so imports, IntelliSense and type errors work across files. */
export function CodeEditor({
  files,
  path,
  settings,
  lint,
  readOnly = false,
  hidden = false,
  onChange,
  onReady,
  onCursor,
  onMarkers,
}: CodeEditorProps) {
  const [monaco, setMonaco] = useState<Monaco | null>(null);
  const markersRef = useRef(onMarkers);
  const cursorRef = useRef(onCursor);
  markersRef.current = onMarkers;
  cursorRef.current = onCursor;
  const active = files.find((f) => f.path === path) ?? files[0];
  const activePath = active?.path;

  useEffect(() => {
    if (!monaco) return;
    const keep = new Set(files.map((f) => uriFor(monaco, f.path).toString()));
    files.forEach((f) => {
      const u = uriFor(monaco, f.path);
      const model = monaco.editor.getModel(u);
      if (!model) monaco.editor.createModel(f.content, languageOf(f.path), u);
      else if (f.path !== activePath && model.getValue() !== f.content) model.setValue(f.content);
    });
    monaco.editor.getModels().forEach((m: MonacoModel) => {
      if (
        m.uri.scheme === 'file' &&
        !m.uri.path.startsWith('/node_modules') &&
        !keep.has(m.uri.toString()) &&
        m.uri.path !== `/${activePath}`
      )
        m.dispose();
    });
  }, [monaco, files, activePath]);

  useEffect(() => {
    if (!monaco) return;
    files.forEach((f) => {
      const model = monaco.editor.getModel(uriFor(monaco, f.path));
      if (!model) return;
      const items = lint
        .filter((p) => p.file === f.path && p.line <= model.getLineCount())
        .map((p) => ({
          startLineNumber: p.line,
          endLineNumber: p.line,
          startColumn: model.getLineFirstNonWhitespaceColumn(p.line) || 1,
          endColumn: model.getLineMaxColumn(p.line),
          message:
            p.severity === 'error'
              ? `Possible secret (${p.rule}) — commits are blocked until it’s removed.`
              : (lintMessages[p.rule] ?? p.rule),
          severity:
            p.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
          source: 'devhq',
        }));
      monaco.editor.setModelMarkers(model, 'devhq', items);
    });
  }, [monaco, files, lint]);

  useEffect(() => {
    if (!monaco) return undefined;
    const emit = () => {
      const list: IdeMarker[] = monaco.editor
        .getModelMarkers({})
        .filter(
          (m: MonacoMarker) =>
            m.resource.scheme === 'file' && !m.resource.path.startsWith('/node_modules'),
        )
        .map((m: MonacoMarker) => ({
          file: m.resource.path.slice(1),
          line: m.startLineNumber,
          col: m.startColumn,
          message: m.message,
          severity: m.severity >= 8 ? 'error' : m.severity >= 4 ? 'warning' : 'info',
          source: m.owner,
        }));
      markersRef.current(list);
    };
    emit();
    const sub = monaco.editor.onDidChangeMarkers(emit);
    return () => sub.dispose();
  }, [monaco]);

  if (!active) return null;

  return (
    <div className={hidden ? 'hidden' : 'h-full min-h-0'}>
      <Editor
        path={`file:///${active.path}`}
        value={active.content}
        language={languageOf(active.path)}
        theme={settings.theme === 'dark' ? 'devhq-dark' : 'devhq-light'}
        beforeMount={setupMonaco}
        onMount={(editor, m) => {
          editor.onDidChangeCursorPosition((e) =>
            cursorRef.current(e.position.lineNumber, e.position.column),
          );
          setMonaco(m);
          onReady(editor, m);
        }}
        onChange={(v) => {
          if (v !== undefined && v !== active.content) onChange(active.path, v);
        }}
        loading={
          <p className="p-4 font-mono text-[12px] text-[var(--vs-fg-dim)]">Loading editor…</p>
        }
        options={{
          readOnly,
          fontSize: settings.fontSize,
          fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
          fontLigatures: true,
          minimap: { enabled: settings.minimap },
          wordWrap: settings.wordWrap ? 'on' : 'off',
          tabSize: 2,
          automaticLayout: true,
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          renderLineHighlight: 'all',
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true, indentation: true },
          stickyScroll: { enabled: true },
          formatOnPaste: true,
          padding: { top: 6 },
          fixedOverflowWidgets: true,
        }}
      />
    </div>
  );
}
