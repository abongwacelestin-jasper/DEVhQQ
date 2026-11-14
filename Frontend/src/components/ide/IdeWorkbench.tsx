import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { Monaco } from '@monaco-editor/react';
import { TitleBar } from './TitleBar';
import { ActivityBar } from './ActivityBar';
import { ExplorerView } from './ExplorerView';
import { SearchView } from './SearchView';
import { SourceControlView } from './SourceControlView';
import { RunView } from './RunView';
import { EditorArea } from './EditorArea';
import { BottomPanel } from './BottomPanel';
import { ChatView } from './ChatView';
import { StatusBar } from './StatusBar';
import { QuickOpen } from './QuickOpen';
import { Splitter } from './Splitter';
import type { MenuDef } from './MenuBar';
import { CodeEditor, type IdeEditor } from '../code/CodeEditor';
import { DiffPane } from '../code/DiffPane';
import { Terminal } from '../code/Terminal';
import { useCodeWorkspace } from '../../hooks/useCodeWorkspace';
import { useIdeLayout } from '../../hooks/useIdeLayout';
import { useIdeShortcuts } from '../../hooks/useIdeShortcuts';
import { useCodeRunner } from '../../hooks/useCodeRunner';
import { useAuth } from '../../contexts/AuthContext';
import { ideOptions } from '../../data/devtools';
import { memberById } from '../../utils/status';
import {
  formattable,
  isTest,
  languageLabel,
  languageOf,
  outlineOf,
  runnable,
} from '../../utils/codeFiles';
import type { IdeCommand, IdeMarker, OutLine, Picker } from '../../types/ide';

/** VS Code-style workbench: title bar, activity bar, side bar, editor group, panel, chat and status bar. */
export function IdeWorkbench() {
  const w = useCodeWorkspace();
  const ui = useIdeLayout();
  const navigate = useNavigate();
  const { canDo, role, session } = useAuth();
  const editorRef = useRef<IdeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const [ready, setReady] = useState(false);
  const [markers, setMarkers] = useState<IdeMarker[]>([]);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [diffTabs, setDiffTabs] = useState<string[]>([]);
  const [diff, setDiff] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const paths = useMemo(() => w.files.map((f) => f.path), [w.files]);
  const getMonaco = useCallback(() => monacoRef.current, []);
  const runner = useCodeRunner(getMonaco, paths);
  const readOnly = !canDo('code:commit');
  const home = role?.home ?? '/';
  const me = memberById(session?.memberId ?? 'm1');
  const symbols = useMemo(
    () => outlineOf(w.file.path, w.file.content),
    [w.file.path, w.file.content],
  );
  const problems: IdeMarker[] = ready
    ? markers
    : w.problems.map((p) => ({
        file: p.file,
        line: p.line,
        col: 1,
        message: `${p.rule}: ${p.preview}`,
        severity: p.severity,
        source: 'devhq',
      }));
  const errorFiles = useMemo(
    () => new Set(problems.filter((p) => p.severity === 'error').map((p) => p.file)),
    [problems],
  );
  const errors = problems.filter((p) => p.severity === 'error').length;
  const warnings = problems.filter((p) => p.severity === 'warning').length;
  const symbol = [...symbols].reverse().find((s) => s.line <= cursor.line);
  const changedPaths = new Set(w.changes.map((c) => c.path));
  const blocked = w.problems.filter((p) => p.severity === 'error' && changedPaths.has(p.file));

  const open = (path: string) => {
    setDiff(null);
    w.open(path);
    setRecent((r) => [path, ...r.filter((x) => x !== path)].slice(0, 8));
  };
  const reveal = (path: string, line = 1, col = 1) => {
    open(path);
    window.setTimeout(() => {
      const ed = editorRef.current;
      if (!ed) return;
      ed.revealLineInCenter(line);
      ed.setPosition({ lineNumber: line, column: col });
      ed.focus();
    }, 60);
  };

  const format = async (silent = false) => {
    if (!formattable.has(languageOf(w.file.path))) {
      if (!silent) toast(`No formatter available for ${languageLabel(w.file.path)}`);
      return;
    }
    await editorRef.current?.getAction('editor.action.formatDocument')?.run();
  };
  const save = async () => {
    const canFormat = ui.settings.formatOnSave && formattable.has(languageOf(w.file.path));
    if (canFormat) await format(true);
    toast.success(`Saved ${w.file.path.split('/').pop()}`, {
      description: canFormat
        ? 'Formatted on save · stored on this branch'
        : 'Stored on this branch',
    });
  };

  const runActive = () => {
    ui.showPanel('output');
    runner.runFile(w.file.path);
  };
  const runPath = (path: string) => {
    ui.showPanel('output');
    runner.runFile(path);
  };
  const runAllTests = () => {
    ui.showPanel('output');
    return runner.runTests();
  };

  const openDiff = (path: string) => {
    setDiffTabs((t) => (t.includes(path) ? t : [...t, path]));
    setDiff(path);
  };
  const closeDiff = (path: string) => {
    setDiffTabs((t) => t.filter((x) => x !== path));
    if (diff === path) setDiff(null);
  };

  const print = (l: OutLine) => w.print([l]);
  const onTerminal = (cmd: string) => {
    const node = cmd.match(/^(?:node|tsx|ts-node|run)\s+(\S+)$/);
    if (node) {
      w.print([{ text: `$ ${cmd}`, tone: 'cmd' }]);
      const f = paths.find((p) => p === node[1] || p.endsWith(`/${node[1]}`));
      if (f) runner.runFile(f, print);
      else w.print([{ text: `Error: Cannot find module '${node[1]}'`, tone: 'bad' }]);
      return;
    }
    if (/^(npm (run )?test|npx vitest( run)?|vitest( run)?)$/.test(cmd)) {
      w.print([{ text: `$ ${cmd}`, tone: 'cmd' }]);
      runner.runTests(print);
      return;
    }
    if (/^(npm run typecheck|npx tsc( --noEmit)?|tsc( --noEmit)?)$/.test(cmd)) {
      const ts = problems.filter((p) => p.source === 'typescript' || p.source === 'javascript');
      const lines: OutLine[] = ts.length
        ? ts.map((p) => ({
            text: `${p.file}(${p.line},${p.col}): ${p.severity} ${p.message.split('\n')[0]}`,
            tone: p.severity === 'error' ? 'bad' : 'warn',
          }))
        : [{ text: '✓ No type errors', tone: 'ok' }];
      w.print([{ text: `$ ${cmd}`, tone: 'cmd' }, ...lines]);
      return;
    }
    w.run(cmd);
  };

  const commit = (message: string, openPr: boolean) => {
    if (blocked.length) {
      toast.error('Commit blocked — possible secret in a changed file', {
        description: `${blocked[0].file}:${blocked[0].line} · ${blocked[0].rule}`,
      });
      reveal(blocked[0].file, blocked[0].line);
      return false;
    }
    const ok = w.commit({ message, signed: true, openPr });
    if (ok) {
      setDiffTabs([]);
      setDiff(null);
    }
    return ok;
  };

  const pickBranch = () =>
    setPicker({
      placeholder: 'Select a branch to checkout, or type a name to create one',
      items: w.branches.map((b) => ({
        id: b,
        label: b,
        description: b === w.branch ? 'current' : b === 'main' ? 'protected' : undefined,
      })),
      allowCreate: true,
      onPick: (v) => {
        if (w.branches.includes(v)) w.switchBranch(v);
        else if (w.createBranch(v)) toast.success(`Switched to a new branch '${v}'`);
        else toast.error('Invalid branch name');
      },
    });
  const pickRepo = () =>
    setPicker({
      placeholder: 'Switch repository',
      items: w.repos.map((r) => ({
        id: r,
        label: r,
        description: r === w.repo ? 'current' : undefined,
      })),
      onPick: (v) => {
        w.switchRepo(v);
        setDiffTabs([]);
        setDiff(null);
      },
    });
  const newFile = (dir?: string) =>
    setPicker({
      placeholder: 'New file path — folders are created automatically',
      initial:
        dir ??
        (w.file.path.includes('/') ? `${w.file.path.split('/').slice(0, -1).join('/')}/` : ''),
      onPick: (v) => {
        if (!w.createFile(v)) toast.error('That path is invalid or already exists');
      },
    });
  const openInIde = () =>
    setPicker({
      placeholder: 'Open this file in a desktop editor',
      items: ideOptions.map((i) => ({ id: i.id, label: i.name, description: `${i.scheme}://` })),
      onPick: (id) => {
        const i = ideOptions.find((x) => x.id === id);
        if (!i) return;
        navigator.clipboard?.writeText(
          `${i.scheme}://devhq.open?repo=${encodeURIComponent(w.repo)}&branch=${encodeURIComponent(w.branch)}&file=${encodeURIComponent(w.file.path)}`,
        );
        toast.success(`Opening in ${i.name}`, {
          description: 'Deep link copied — requires the TavetaHQ extension.',
        });
      },
    });

  const commands: IdeCommand[] = [
    {
      id: 'palette',
      label: 'Show All Commands',
      keys: 'Ctrl+Shift+P',
      run: () => ui.openQuick('>'),
    },
    { id: 'file.new', label: 'File: New File…', run: () => newFile() },
    { id: 'file.save', label: 'File: Save', keys: 'Ctrl+S', run: save },
    { id: 'go.file', label: 'Go to File…', keys: 'Ctrl+P', run: () => ui.openQuick('') },
    { id: 'go.line', label: 'Go to Line…', keys: 'Ctrl+G', run: () => ui.openQuick(':') },
    {
      id: 'go.symbol',
      label: 'Go to Symbol in Editor…',
      keys: 'Ctrl+Shift+O',
      run: () => ui.openQuick('@'),
    },
    { id: 'format', label: 'Format Document', keys: 'Shift+Alt+F', run: () => format() },
    { id: 'run.file', label: 'Run: Run Current File', keys: 'F5', run: runActive },
    { id: 'run.tests', label: 'Test: Run All Tests', run: () => void runAllTests() },
    {
      id: 'view.explorer',
      label: 'View: Show Explorer',
      keys: 'Ctrl+Shift+E',
      run: () => ui.showView('explorer'),
    },
    {
      id: 'view.search',
      label: 'View: Find in Files',
      keys: 'Ctrl+Shift+F',
      run: () => ui.showView('search'),
    },
    {
      id: 'view.scm',
      label: 'View: Show Source Control',
      keys: 'Ctrl+Shift+G',
      run: () => ui.showView('scm'),
    },
    {
      id: 'view.run',
      label: 'View: Show Run and Debug',
      keys: 'Ctrl+Shift+D',
      run: () => ui.showView('run'),
    },
    {
      id: 'view.sidebar',
      label: 'View: Toggle Primary Side Bar',
      keys: 'Ctrl+B',
      run: ui.toggleSide,
    },
    { id: 'view.panel', label: 'View: Toggle Panel', keys: 'Ctrl+J', run: ui.togglePanel },
    {
      id: 'view.terminal',
      label: 'View: Toggle Terminal',
      keys: 'Ctrl+`',
      run: () => ui.togglePanelTab('terminal'),
    },
    {
      id: 'view.problems',
      label: 'View: Show Problems',
      keys: 'Ctrl+Shift+M',
      run: () => ui.showPanel('problems'),
    },
    { id: 'view.chat', label: 'View: Toggle Chat', keys: 'Ctrl+Alt+I', run: ui.toggleChat },
    { id: 'git.branch', label: 'Git: Checkout to… / Create Branch', run: pickBranch },
    { id: 'git.commit', label: 'Git: Commit & Push', run: () => ui.showView('scm') },
    {
      id: 'git.stash',
      label: 'Git: Stash',
      run: () =>
        w.stash() ? toast.success('Changes stashed') : toast('No local changes to stash'),
    },
    {
      id: 'git.pop',
      label: 'Git: Pop Latest Stash',
      run: () =>
        w.popStash() ? toast.success('Stash applied') : toast('No stash for this branch'),
    },
    {
      id: 'git.discard',
      label: 'Git: Discard All Changes',
      run: () =>
        w.changes.length > 0 &&
        window.confirm(`Discard ${w.changes.length} change(s)? This can’t be undone.`) &&
        w.discard(),
    },
    { id: 'repo.switch', label: 'Workspace: Switch Repository…', run: pickRepo },
    { id: 'ide.open', label: 'File: Open in Desktop Editor…', run: openInIde },
    {
      id: 'pref.theme',
      label: `Preferences: Switch to ${ui.settings.theme === 'dark' ? 'Light' : 'Dark'} Modern Theme`,
      run: () => ui.setSetting('theme', ui.settings.theme === 'dark' ? 'light' : 'dark'),
    },
    {
      id: 'pref.wrap',
      label: 'View: Toggle Word Wrap',
      keys: 'Alt+Z',
      run: () => ui.setSetting('wordWrap', !ui.settings.wordWrap),
    },
    {
      id: 'pref.minimap',
      label: 'View: Toggle Minimap',
      run: () => ui.setSetting('minimap', !ui.settings.minimap),
    },
    {
      id: 'pref.fmt',
      label: `Preferences: ${ui.settings.formatOnSave ? 'Disable' : 'Enable'} Format on Save`,
      run: () => ui.setSetting('formatOnSave', !ui.settings.formatOnSave),
    },
    {
      id: 'font.up',
      label: 'View: Increase Editor Font Size',
      keys: 'Ctrl+=',
      run: () => ui.setSetting('fontSize', Math.min(22, ui.settings.fontSize + 1)),
    },
    {
      id: 'font.down',
      label: 'View: Decrease Editor Font Size',
      keys: 'Ctrl+-',
      run: () => ui.setSetting('fontSize', Math.max(10, ui.settings.fontSize - 1)),
    },
    { id: 'term.clear', label: 'Terminal: Clear', run: () => w.run('clear') },
    { id: 'back', label: 'TavetaHQ: Back to Dashboard', run: () => navigate(home) },
  ];

  const cmd = (id: string) => commands.find((c) => c.id === id) as IdeCommand;
  const editorAction = (label: string, keys: string, action: string): IdeCommand => ({
    id: `edit.${action}`,
    label,
    keys,
    run: () => {
      editorRef.current?.focus();
      editorRef.current?.trigger('menu', action, null);
    },
  });
  const menus: MenuDef[] = [
    {
      label: 'File',
      items: [
        cmd('file.new'),
        cmd('file.save'),
        'sep',
        cmd('go.file'),
        cmd('repo.switch'),
        cmd('ide.open'),
        'sep',
        cmd('back'),
      ],
    },
    {
      label: 'Edit',
      items: [
        editorAction('Undo', 'Ctrl+Z', 'undo'),
        editorAction('Redo', 'Ctrl+Y', 'redo'),
        'sep',
        editorAction('Find', 'Ctrl+F', 'actions.find'),
        editorAction('Replace', 'Ctrl+H', 'editor.action.startFindReplaceAction'),
        cmd('view.search'),
        'sep',
        editorAction('Toggle Line Comment', 'Ctrl+/', 'editor.action.commentLine'),
        cmd('format'),
      ],
    },
    {
      label: 'View',
      items: [
        cmd('palette'),
        'sep',
        cmd('view.explorer'),
        cmd('view.search'),
        cmd('view.scm'),
        cmd('view.run'),
        'sep',
        cmd('view.sidebar'),
        cmd('view.panel'),
        cmd('view.chat'),
        'sep',
        cmd('pref.wrap'),
        cmd('pref.minimap'),
        cmd('pref.theme'),
      ],
    },
    { label: 'Go', items: [cmd('go.file'), cmd('go.symbol'), cmd('go.line')] },
    { label: 'Run', items: [cmd('run.file'), cmd('run.tests')] },
    {
      label: 'Terminal',
      items: [
        {
          id: 'term.new',
          label: 'New Terminal',
          keys: 'Ctrl+`',
          run: () => ui.showPanel('terminal'),
        },
        cmd('term.clear'),
      ],
    },
  ];

  useIdeShortcuts({
    'mod+p': () => ui.openQuick(''),
    'mod+shift+p': () => ui.openQuick('>'),
    f1: () => ui.openQuick('>'),
    'mod+g': () => ui.openQuick(':'),
    'mod+shift+o': () => ui.openQuick('@'),
    'mod+b': ui.toggleSide,
    'mod+j': ui.togglePanel,
    'mod+`': () => ui.togglePanelTab('terminal'),
    'mod+shift+e': () => ui.showView('explorer'),
    'mod+shift+f': () => ui.showView('search'),
    'mod+shift+g': () => ui.showView('scm'),
    'mod+shift+d': () => ui.showView('run'),
    'mod+shift+m': () => ui.showPanel('problems'),
    'mod+alt+i': ui.toggleChat,
    'mod+s': () => void save(),
    'alt+shift+f': () => void format(),
    'alt+z': () => ui.setSetting('wordWrap', !ui.settings.wordWrap),
    'mod+=': () => ui.setSetting('fontSize', Math.min(22, ui.settings.fontSize + 1)),
    'mod+-': () => ui.setSetting('fontSize', Math.max(10, ui.settings.fontSize - 1)),
    f5: runActive,
  });

  const sideView = {
    explorer: (
      <ExplorerView
        repo={w.repo}
        files={w.files}
        active={w.active}
        readOnly={readOnly}
        symbols={symbols}
        commits={w.commits}
        errorFiles={errorFiles}
        statusOf={w.statusOf}
        onOpen={open}
        onNewFile={newFile}
        onRename={w.renameFile}
        onDelete={(p) => !w.deleteFile(p) && toast.error('A workspace needs at least one file')}
        onRun={runPath}
        onReveal={(line) => reveal(w.file.path, line)}
        onSwitchRepo={pickRepo}
      />
    ),

    search: (
      <SearchView files={w.files} readOnly={readOnly} onOpen={reveal} onReplace={w.replaceFiles} />
    ),
    scm: (
      <SourceControlView
        branch={w.branch}
        changes={w.changes}
        blocked={blocked}
        commits={w.commits}
        stashCount={w.stashes.length}
        readOnly={readOnly}
        onCommit={commit}
        onOpenDiff={openDiff}
        onOpenFile={open}
        onDiscard={w.discardFile}
        onDiscardAll={() =>
          window.confirm(`Discard all ${w.changes.length} change(s)?`) && w.discard()
        }
        onStash={() => w.stash() && toast.success('Changes stashed')}
        onPop={() =>
          w.popStash() ? toast.success('Stash applied') : toast('No stash for this branch')
        }
        onBranch={pickBranch}
      />
    ),

    run: (
      <RunView
        path={w.file.path}
        canRun={runnable(w.file.path)}
        running={runner.running}
        last={runner.last}
        tests={paths.filter(isTest)}
        onRunFile={runPath}
        onRunTests={() => void runAllTests()}
      />
    ),
  }[ui.view];

  return (
    <div
      className={`${ui.settings.theme === 'dark' ? 'ide-dark' : 'ide-light'} flex h-[100dvh] w-full flex-col overflow-hidden bg-[var(--vs-editor)] font-sans text-[13px] text-[var(--vs-fg)]`}
    >
      <TitleBar
        repo={w.repo}
        menus={menus}
        sideOpen={ui.sideOpen}
        panelOpen={ui.panelOpen}
        chatOpen={ui.chatOpen}
        onHome={() => navigate(home)}
        onQuickOpen={() => ui.openQuick('')}
        onToggleSide={ui.toggleSide}
        onTogglePanel={ui.togglePanel}
        onToggleChat={ui.toggleChat}
      />

      <div className="relative flex min-h-0 flex-1">
        <ActivityBar
          view={ui.view}
          sideOpen={ui.sideOpen}
          scmCount={w.changes.length}
          running={!!runner.running}
          settings={ui.settings}
          user={{
            name: me.name,
            email: me.email,
            initials: me.name
              .split(' ')
              .map((p) => p[0])
              .join('')
              .slice(0, 2),
            color: me.color,
          }}
          onView={ui.selectView}
          onSetting={ui.setSetting}
          onCommands={() => ui.openQuick('>')}
          onHome={() => navigate(home)}
        />

        {ui.sideOpen && (
          <>
            <aside
              style={{ width: ui.side.size }}
              className="absolute inset-y-0 left-12 z-30 flex max-w-[calc(100vw-3rem)] flex-col border-r border-[var(--vs-border)] bg-[var(--vs-side)] shadow-[8px_0_24px_rgba(0,0,0,0.3)] md:static md:z-auto md:shadow-none"
              aria-label="Primary side bar"
            >
              {sideView}
            </aside>
            <Splitter axis="x" onPointerDown={ui.side.onPointerDown} className="hidden md:block" />
          </>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          {!ui.panelMax && (
            <EditorArea
              tabs={w.tabs}
              active={w.active}
              diffTabs={diffTabs}
              diff={diff}
              symbol={symbol}
              errorFiles={errorFiles}
              canRun={runnable(w.file.path)}
              running={!!runner.running}
              statusOf={w.statusOf}
              onSelect={open}
              onClose={w.closeTab}
              onSelectDiff={setDiff}
              onCloseDiff={closeDiff}
              onRun={runActive}
              onFormat={() => void format()}
              onOpenChanges={() => openDiff(w.file.path)}
            >
              <CodeEditor
                files={w.files}
                path={w.active}
                settings={ui.settings}
                lint={w.problems}
                readOnly={readOnly}
                hidden={!!diff || w.tabs.length === 0}
                onChange={(p, v) => w.edit(v, p)}
                onReady={(editor, monaco) => {
                  editorRef.current = editor;
                  monacoRef.current = monaco;
                  setReady(true);
                }}
                onCursor={(line, col) => setCursor({ line, col })}
                onMarkers={setMarkers}
              />

              {diff && (
                <DiffPane
                  key={diff}
                  path={diff}
                  original={w.originalOf(diff)}
                  modified={w.files.find((f) => f.path === diff)?.content ?? ''}
                  settings={ui.settings}
                />
              )}
            </EditorArea>
          )}
          {ui.panelOpen && (
            <>
              {!ui.panelMax && <Splitter axis="y" onPointerDown={ui.panel.onPointerDown} />}
              <BottomPanel
                tab={ui.panelTab}
                problems={problems}
                output={runner.output}
                max={ui.panelMax}
                style={ui.panelMax ? undefined : { height: ui.panel.size }}
                terminal={
                  <Terminal
                    lines={w.term}
                    onCommand={onTerminal}
                    cwd={`~/${w.repo.split('/')[1]}`}
                    branch={w.branch}
                    files={paths}
                    branches={w.branches}
                  />
                }
                onTab={ui.setPanelTab}
                onOpenProblem={(m) => reveal(m.file, m.line, m.col)}
                onClearOutput={runner.clearOutput}
                onClearTerminal={() => w.run('clear')}
                onToggleMax={ui.toggleMax}
                onClose={ui.closePanel}
              />
            </>
          )}
        </main>

        {ui.chatOpen && (
          <>
            <Splitter axis="x" onPointerDown={ui.chat.onPointerDown} className="hidden xl:block" />
            <aside
              style={{ width: ui.chat.size }}
              className="absolute inset-y-0 right-0 z-30 max-w-full border-l border-[var(--vs-border)] shadow-[-8px_0_24px_rgba(0,0,0,0.3)] xl:static xl:z-auto xl:shadow-none"
              aria-label="Chat"
            >
              <ChatView
                repo={w.repo}
                file={w.file}
                files={w.files}
                problems={problems}
                readOnly={readOnly}
                onRunFile={async () => {
                  ui.showPanel('output');
                  await runner.runFile(w.file.path);
                }}
                onRunTests={runAllTests}
                onApply={(content) => {
                  w.edit(content);
                  window.setTimeout(() => void format(true), 80);
                }}
                onOpen={(p, line) => reveal(p, line)}
                onClose={ui.toggleChat}
              />
            </aside>
          </>
        )}
      </div>

      <StatusBar
        branch={w.branch}
        dirty={w.changes.length > 0}
        pushed={w.commits.filter((c) => c.repo === w.repo && c.branch === w.branch).length}
        errors={errors}
        warnings={warnings}
        line={cursor.line}
        col={cursor.col}
        language={languageLabel(w.file.path)}
        taskKey={w.taskKey}
        running={runner.running}
        readOnly={readOnly}
        onHome={() => navigate(home)}
        onBranch={pickBranch}
        onSync={() => toast.success(`${w.branch} is up to date with origin`)}
        onProblems={() => ui.togglePanelTab('problems')}
        onGoToLine={() => ui.openQuick(':')}
        onLanguage={() => void format()}
      />

      <QuickOpen
        open={ui.quick !== null || picker !== null}
        initial={ui.quick ?? ''}
        picker={picker}
        files={paths}
        recent={recent}
        commands={commands}
        symbols={symbols}
        lineCount={w.file.content.split('\n').length}
        onClose={() => {
          ui.closeQuick();
          setPicker(null);
        }}
        onFile={open}
        onLine={(n) => reveal(w.file.path, n)}
      />
    </div>
  );
}
