import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  BoxIcon,
  BracesIcon,
  ChevronRightIcon,
  CopyMinusIcon,
  FilePlusIcon,
  GitCommitHorizontalIcon,
  HashIcon,
  SquareFunctionIcon,
  VariableIcon,
} from 'lucide-react';
import { FileIcon } from './FileIcon';
import { PaneAction, PaneHeader } from './PaneHeader';
import { buildTree, runnable, type CodeSymbol, type TreeNode } from '../../utils/codeFiles';
import type { CodeFile } from '../../data/codeWorkspace';
import type { WorkspaceCommit } from '../../hooks/useCodeWorkspace';
import type { GitStatus } from '../../types/ide';

interface ExplorerViewProps {
  repo: string;
  files: CodeFile[];
  active: string;
  readOnly: boolean;
  symbols: CodeSymbol[];
  commits: WorkspaceCommit[];
  errorFiles: Set<string>;
  statusOf: (path: string) => GitStatus | undefined;
  onOpen: (path: string) => void;
  onNewFile: (dir?: string) => void;
  onRename: (from: string, to: string) => boolean;
  onDelete: (path: string) => void;
  onRun: (path: string) => void;
  onReveal: (line: number) => void;
  onSwitchRepo: () => void;
}

export const statusColor: Record<GitStatus, string> = {
  M: 'text-[var(--vs-mod)]',
  A: 'text-[var(--vs-add)]',
  D: 'text-[var(--vs-del)]',
};
const symbolIcon: Record<
  CodeSymbol['kind'],
  { icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  function: { icon: SquareFunctionIcon, color: '#B180D7' },
  class: { icon: BoxIcon, color: '#EE9D28' },
  type: { icon: BracesIcon, color: '#4EC9B0' },
  const: { icon: VariableIcon, color: '#75BEFF' },
  heading: { icon: HashIcon, color: '#75BEFF' },
};

interface MenuState {
  x: number;
  y: number;
  path: string;
  kind: 'dir' | 'file';
}

export function ExplorerView({
  repo,
  files,
  active,
  readOnly,
  symbols,
  commits,
  errorFiles,
  statusOf,
  onOpen,
  onNewFile,
  onRename,
  onDelete,
  onRun,
  onReveal,
  onSwitchRepo,
}: ExplorerViewProps) {
  const tree = useMemo(() => buildTree(files.map((f) => f.path)), [files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [sections, setSections] = useState({ files: true, outline: true, timeline: false });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  const toggleDir = (p: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  const allDirs = (nodes: TreeNode[]): string[] =>
    nodes.flatMap((n) => (n.kind === 'dir' ? [n.path, ...allDirs(n.children)] : []));
  const dirChanged = (dir: string) =>
    files.some((f) => f.path.startsWith(`${dir}/`) && statusOf(f.path));
  const dirError = (dir: string) => Array.from(errorFiles).some((f) => f.startsWith(`${dir}/`));
  const openMenu = (e: React.MouseEvent, path: string, kind: 'dir' | 'file') => {
    e.preventDefault();
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 220),
      y: Math.min(e.clientY, window.innerHeight - 220),
      path,
      kind,
    });
  };
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text);
    toast.success('Copied to clipboard', { description: text });
  };
  const commitRename = (from: string, value: string) => {
    setRenaming(null);
    const dir = from.split('/').slice(0, -1).join('/');
    const name = value.trim();
    if (!name || name === from.split('/').pop()) return;
    if (!onRename(from, dir ? `${dir}/${name}` : name))
      toast.error('A file with that name already exists or the name is invalid');
  };

  const renderNodes = (nodes: TreeNode[], depth: number): React.ReactNode =>
    nodes.map((n) => {
      if (n.kind === 'dir') {
        const open = !collapsed.has(n.path);
        const changed = dirChanged(n.path);
        const err = dirError(n.path);
        return (
          <li key={n.path} role="treeitem" aria-expanded={open}>
            <button
              onClick={() => toggleDir(n.path)}
              onContextMenu={(e) => openMenu(e, n.path, 'dir')}
              style={{ paddingLeft: 4 + depth * 12 }}
              className="flex h-[22px] w-full items-center gap-0.5 pr-3 text-left hover:bg-[var(--vs-hover)]"
            >
              <ChevronRightIcon
                className={`h-4 w-4 shrink-0 transition-transform duration-100 ${open ? 'rotate-90' : ''}`}
              />
              <span
                className={`min-w-0 flex-1 truncate ${err ? 'text-[var(--vs-err)]' : changed ? 'text-[var(--vs-mod)]' : ''}`}
              >
                {n.name}
              </span>
              {(changed || err) && (
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${err ? 'bg-[var(--vs-err)]' : 'bg-[var(--vs-mod)]'}`}
                  aria-hidden
                />
              )}
            </button>
            {open && <ul role="group">{renderNodes(n.children, depth + 1)}</ul>}
          </li>
        );
      }
      const st = statusOf(n.path);
      const err = errorFiles.has(n.path);
      const pad = { paddingLeft: 20 + depth * 12 };
      if (renaming === n.path) {
        return (
          <li key={n.path} style={pad} className="flex h-[22px] items-center gap-1.5 pr-2">
            <FileIcon path={n.path} />
            <input
              autoFocus
              defaultValue={n.name}
              onFocus={(e) =>
                e.currentTarget.setSelectionRange(
                  0,
                  n.name.lastIndexOf('.') > 0 ? n.name.lastIndexOf('.') : n.name.length,
                )
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(n.path, e.currentTarget.value);
                if (e.key === 'Escape') setRenaming(null);
              }}
              onBlur={(e) => commitRename(n.path, e.currentTarget.value)}
              aria-label={`Rename ${n.name}`}
              className="h-[20px] min-w-0 flex-1 border border-[var(--vs-accent)] bg-[var(--vs-input)] px-1 text-[13px] text-[var(--vs-fg)] outline-none"
            />
          </li>
        );
      }
      return (
        <li key={n.path} role="treeitem" aria-selected={active === n.path}>
          <button
            onClick={() => onOpen(n.path)}
            onContextMenu={(e) => openMenu(e, n.path, 'file')}
            onKeyDown={(e) => {
              if (e.key === 'F2' && !readOnly) setRenaming(n.path);
            }}
            style={pad}
            className={`flex h-[22px] w-full items-center gap-1.5 pr-3 text-left ${active === n.path ? 'bg-[var(--vs-active)]' : 'hover:bg-[var(--vs-hover)]'}`}
          >
            <FileIcon path={n.path} />
            <span
              className={`min-w-0 flex-1 truncate ${err ? 'text-[var(--vs-err)]' : st ? statusColor[st] : ''}`}
            >
              {n.name}
            </span>
            {err && <span className="text-[11px] text-[var(--vs-err)]">●</span>}
            {st && (
              <span className={`w-3 text-center text-[11px] font-semibold ${statusColor[st]}`}>
                {st === 'A' ? 'U' : st}
              </span>
            )}
          </button>
        </li>
      );
    });

  const menuItems: { label: string; run: () => void; hide?: boolean }[] = menu
    ? menu.kind === 'dir'
      ? [
          { label: 'New File…', run: () => onNewFile(`${menu.path}/`), hide: readOnly },
          {
            label: collapsed.has(menu.path) ? 'Expand' : 'Collapse',
            run: () => toggleDir(menu.path),
          },
          { label: 'Copy Path', run: () => copy(`/workspace/${repo.split('/')[1]}/${menu.path}`) },
          { label: 'Copy Relative Path', run: () => copy(menu.path) },
        ]
      : [
          { label: 'Open', run: () => onOpen(menu.path) },
          { label: 'Run File', run: () => onRun(menu.path), hide: !runnable(menu.path) },
          { label: 'Rename…', run: () => setRenaming(menu.path), hide: readOnly },
          {
            label: 'Delete',
            run: () =>
              window.confirm(
                `Delete ${menu.path}? You can restore it from Source Control until you commit.`,
              ) && onDelete(menu.path),
            hide: readOnly,
          },
          { label: 'Copy Path', run: () => copy(`/workspace/${repo.split('/')[1]}/${menu.path}`) },
          { label: 'Copy Relative Path', run: () => copy(menu.path) },
        ]
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneHeader variant="view" title="Explorer" />
      <PaneHeader
        variant="section"
        title={repo.split('/')[1]}
        open={sections.files}
        onToggle={() => setSections((s) => ({ ...s, files: !s.files }))}
        actions={
          <>
            {!readOnly && (
              <PaneAction label="New File…" onClick={() => onNewFile()}>
                <FilePlusIcon className="h-4 w-4" />
              </PaneAction>
            )}
            <PaneAction label="Switch Repository…" onClick={onSwitchRepo}>
              <GitCommitHorizontalIcon className="h-4 w-4" />
            </PaneAction>
            <PaneAction
              label="Collapse Folders"
              onClick={() => setCollapsed(new Set(allDirs(tree)))}
            >
              <CopyMinusIcon className="h-4 w-4" />
            </PaneAction>
          </>
        }
      />

      {sections.files ? (
        <ul
          role="tree"
          aria-label="Files"
          className="min-h-0 flex-1 overflow-y-auto pb-2 text-[13px] ide-scroll"
        >
          {renderNodes(tree, 0)}
        </ul>
      ) : (
        <div className="flex-1" />
      )}

      <PaneHeader
        variant="section"
        title="Outline"
        open={sections.outline}
        onToggle={() => setSections((s) => ({ ...s, outline: !s.outline }))}
      />
      {sections.outline && (
        <ul
          className="max-h-[28%] shrink-0 overflow-y-auto pb-1 text-[13px] ide-scroll"
          aria-label="Outline"
        >
          {symbols.length === 0 && (
            <li className="px-5 py-1 text-[12px] text-[var(--vs-fg-dim)]">
              No symbols found in this file.
            </li>
          )}
          {symbols.map((s) => {
            const meta = symbolIcon[s.kind];
            return (
              <li key={`${s.name}-${s.line}`}>
                <button
                  onClick={() => onReveal(s.line)}
                  className="flex h-[22px] w-full items-center gap-1.5 pl-5 pr-3 text-left hover:bg-[var(--vs-hover)]"
                >
                  <span className="flex shrink-0" style={{ color: meta.color }}>
                    <meta.icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <span className="text-[11px] text-[var(--vs-fg-dim)]">{s.line}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <PaneHeader
        variant="section"
        title="Timeline"
        open={sections.timeline}
        onToggle={() => setSections((s) => ({ ...s, timeline: !s.timeline }))}
      />
      {sections.timeline && (
        <ul className="max-h-[24%] shrink-0 overflow-y-auto pb-1 text-[13px] ide-scroll">
          {[
            ...commits.map((c) => ({
              id: c.sha,
              label: c.message,
              meta: `${c.sha} · ${c.branch}`,
            })),
            {
              id: 'a41f9c2',
              label: 'fix(billing): retry failed webhooks',
              meta: 'a41f9c2 · 3 days ago',
            },
          ].map((c) => (
            <li key={c.id} className="flex h-[22px] items-center gap-1.5 pl-5 pr-3">
              <GitCommitHorizontalIcon className="h-3.5 w-3.5 shrink-0 text-[var(--vs-fg-dim)]" />
              <span className="min-w-0 flex-1 truncate">{c.label}</span>
              <span className="shrink-0 text-[11px] text-[var(--vs-fg-dim)]">{c.meta}</span>
            </li>
          ))}
        </ul>
      )}

      {menu && (
        <ul
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
          className="fixed z-[70] min-w-[200px] rounded-md border border-[var(--vs-input-border)] bg-[var(--vs-widget)] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.36)]"
        >
          {menuItems
            .filter((m) => !m.hide)
            .map((m) => (
              <li key={m.label}>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenu(null);
                    m.run();
                  }}
                  className="w-full rounded px-3 py-[4px] text-left text-[13px] text-[var(--vs-fg)] hover:bg-[var(--vs-accent)] hover:text-[var(--vs-on-accent)]"
                >
                  {m.label}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
