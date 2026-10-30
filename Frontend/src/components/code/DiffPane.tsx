import { DiffEditor } from '@monaco-editor/react';
import { setupMonaco } from '../../utils/monacoSetup';
import { languageOf } from '../../utils/codeFiles';
import type { IdeSettings } from '../../types/ide';

interface DiffPaneProps {
  path: string;
  original: string;
  modified: string;
  settings: IdeSettings;
}

/** Working-tree diff (last commit ↔ current), like VS Code's “Open Changes”. */
export function DiffPane({ path, original, modified, settings }: DiffPaneProps) {
  return (
    <DiffEditor
      original={original}
      modified={modified}
      language={languageOf(path)}
      theme={settings.theme === 'dark' ? 'devhq-dark' : 'devhq-light'}
      beforeMount={setupMonaco}
      loading={<p className="p-4 font-mono text-[12px] text-[var(--vs-fg-dim)]">Loading diff…</p>}
      options={{
        readOnly: true,
        originalEditable: false,
        renderSideBySide: typeof window === 'undefined' || window.innerWidth >= 900,
        fontSize: settings.fontSize,
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        minimap: { enabled: false },
        automaticLayout: true,
        scrollBeyondLastLine: false,
      }}
    />
  );
}
