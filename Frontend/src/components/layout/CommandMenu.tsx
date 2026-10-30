import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  ArrowRightIcon,
  BotIcon,
  ClockIcon,
  CornerDownLeftIcon,
  FileTextIcon,
  FolderKanbanIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  LinkIcon,
  PanelLeftIcon,
  PlusIcon,
  RocketIcon,
  SearchIcon,
  TerminalSquareIcon,
  TriangleAlertIcon,
  UserIcon,
  ZapIcon,
} from 'lucide-react';
import { useWork } from '../../contexts/WorkContext';
import { useDocs } from '../../contexts/DocsContext';
import { pullRequests, repositories } from '../../data/engineering';
import { deployments } from '../../data/operations';
import { useIncidents } from '../../contexts/IncidentContext';
import { useAuth } from '../../contexts/AuthContext';
import { members } from '../../data/team';
import { useWorkspaceUI } from '../../contexts/WorkspaceUIContext';
import { useNavEntries } from '../../hooks/useNavEntries';
import { repoSlug } from '../../utils/slug';

interface CommandMenuProps {
  open: boolean;
  onClose: () => void;
}

interface ResultItem {
  id: string;
  group: string;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void;
  keywords?: string;
}

type Mode = 'all' | 'commands' | 'people' | 'tasks' | 'docs';
const modes: { id: Mode; label: string; prefix: string }[] = [
  { id: 'all', label: 'Everything', prefix: '' },
  { id: 'commands', label: 'Commands', prefix: '>' },
  { id: 'tasks', label: 'Tasks', prefix: '#' },
  { id: 'people', label: 'People', prefix: '@' },
  { id: 'docs', label: 'Docs', prefix: '/' },
];

const RECENT = 'devhq.cmdk-recent';

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}

/** ⌘K palette: search every record, jump to any page, or run a command. Prefixes > # @ / narrow the scope. */
export function CommandMenu({ open, onClose }: CommandMenuProps) {
  const navigate = useNavigate();
  const { openTask, openCreateTask, setAssistantOpen, sidebarCollapsed, setSidebarCollapsed } =
    useWorkspaceUI();
  const { tasks } = useWork();
  const { docs } = useDocs();
  const { incidents, setDeclareOpen } = useIncidents();
  const { can, canDo, canSeeProduct } = useAuth();
  const { flat } = useNavEntries();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>(readRecent);

  const prefixMode = modes.find((m) => m.prefix && query.startsWith(m.prefix));
  const mode: Mode = prefixMode?.id ?? 'all';
  const term = (prefixMode ? query.slice(1) : query).trim().toLowerCase();

  const all = useMemo<ResultItem[]>(
    () => [
      {
        id: 'cmd-new-task',
        group: 'Commands',
        label: 'Create task',
        hint: 'C',
        icon: PlusIcon,
        run: () => openCreateTask(),
      },
      {
        id: 'cmd-assistant',
        group: 'Commands',
        label: 'Ask the assistant',
        hint: '',
        icon: BotIcon,
        run: () => setAssistantOpen(true),
      },
      {
        id: 'cmd-sidebar',
        group: 'Commands',
        label: sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar',
        hint: '',
        icon: PanelLeftIcon,
        run: () => setSidebarCollapsed(!sidebarCollapsed),
      },
      {
        id: 'cmd-copy',
        group: 'Commands',
        label: 'Copy link to this page',
        hint: '',
        icon: LinkIcon,
        run: () => {
          navigator.clipboard?.writeText(window.location.href);
          toast.success('Link copied');
        },
      },
      ...(can('code')
        ? [
            {
              id: 'cmd-code',
              group: 'Commands',
              label: 'Open code workspace',
              hint: '',
              icon: TerminalSquareIcon,
              run: () => navigate('/code'),
            },
          ]
        : []),
      ...(canDo('incident:declare')
        ? [
            {
              id: 'cmd-incident',
              group: 'Commands',
              label: 'Declare an incident',
              hint: '',
              icon: ZapIcon,
              run: () => setDeclareOpen(true),
            },
          ]
        : []),
      ...flat.map((n) => ({
        id: `page${n.to}`,
        group: 'Pages',
        label: n.label,
        hint: n.count ? String(n.count) : '',
        icon: n.icon,
        run: () => navigate(n.to),
      })),
      ...(can('projects') || can('my-work')
        ? tasks
            .filter((t) => canSeeProduct(t.product))
            .map((t) => ({
              id: t.key,
              group: 'Tasks',
              label: t.title,
              hint: t.key,
              icon: FolderKanbanIcon,
              run: () => openTask(t.key),
            }))
        : []),
      ...docs
        .filter((d) => canSeeProduct(d.product))
        .map((d) => ({
          id: d.id,
          group: 'Docs',
          label: d.title,
          hint: d.kind,
          icon: FileTextIcon,
          run: () => navigate(`/docs/${d.id}`),
          keywords: d.body.slice(0, 400),
        })),
      ...(can('pull-requests')
        ? pullRequests
            .filter((p) => canSeeProduct(p.product))
            .map((p) => ({
              id: `pr${p.number}`,
              group: 'Pull requests',
              label: p.title,
              hint: `#${p.number}`,
              icon: GitPullRequestIcon,
              run: () => navigate(`/pull-requests/${p.number}`),
            }))
        : []),
      ...(can('repositories')
        ? repositories
            .filter((r) => canSeeProduct(r.product))
            .map((r) => ({
              id: `repo${r.name}`,
              group: 'Repositories',
              label: r.name,
              hint: r.language,
              icon: GitBranchIcon,
              run: () => navigate(`/repositories/${repoSlug(r.name)}`),
            }))
        : []),
      ...(can('incidents')
        ? incidents
            .filter((i) => canSeeProduct(i.product))
            .map((i) => ({
              id: i.id,
              group: 'Incidents',
              label: i.title,
              hint: i.id,
              icon: TriangleAlertIcon,
              run: () => navigate(`/incidents/${i.id}`),
            }))
        : []),
      ...(can('deployments')
        ? deployments
            .filter((d) => canSeeProduct(d.product))
            .map((d) => ({
              id: d.id,
              group: 'Deployments',
              label: d.message,
              hint: d.sha,
              icon: RocketIcon,
              run: () => navigate(`/deployments/${d.id}`),
            }))
        : []),
      ...(can('team')
        ? members.map((m) => ({
            id: m.id,
            group: 'People',
            label: m.name,
            hint: m.role,
            icon: UserIcon,
            run: () => navigate(`/team/${m.id}`),
            keywords: m.email,
          }))
        : []),
    ],

    [
      navigate,
      openTask,
      openCreateTask,
      setAssistantOpen,
      setDeclareOpen,
      sidebarCollapsed,
      setSidebarCollapsed,
      tasks,
      docs,
      incidents,
      can,
      canDo,
      canSeeProduct,
      flat,
    ],
  );

  const results = useMemo(() => {
    const scope = all.filter(
      (r) =>
        mode === 'all' ||
        (mode === 'commands' && r.group === 'Commands') ||
        (mode === 'people' && r.group === 'People') ||
        (mode === 'tasks' && r.group === 'Tasks') ||
        (mode === 'docs' && r.group === 'Docs'),
    );
    if (!term) {
      if (mode !== 'all') return scope.slice(0, 12);
      const rec = recent
        .map((id) => all.find((r) => r.id === id))
        .filter((r): r is ResultItem => !!r)
        .map((r) => ({ ...r, group: 'Recent' }));
      return [
        ...rec,
        ...all.filter((r) => r.group === 'Commands'),
        ...all.filter((r) => r.group === 'Pages').slice(0, 6),
      ];
    }
    const score = (r: ResultItem) => {
      const l = r.label.toLowerCase();
      if (l.startsWith(term) || r.hint.toLowerCase() === term) return 0;
      if (l.includes(term) || r.hint.toLowerCase().includes(term)) return 1;
      return 2;
    };
    return scope
      .filter((r) => `${r.label} ${r.hint} ${r.keywords ?? ''}`.toLowerCase().includes(term))
      .sort((a, b) => score(a) - score(b))
      .slice(0, 14);
  }, [all, term, mode, recent]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setRecent(readRecent());
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const select = (r: ResultItem) => {
    const id = r.id;
    const next = [id, ...recent.filter((x) => x !== id)].slice(0, 5);
    localStorage.setItem(RECENT, JSON.stringify(next));
    r.run();
    onClose();
  };

  const setMode = (m: Mode) => {
    const p = modes.find((x) => x.id === m)!.prefix;
    setQuery(p + (prefixMode ? query.slice(1) : query));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      select(results[active]);
    } else if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const i = modes.findIndex((m) => m.id === mode);
      setMode(modes[(i + (e.shiftKey ? modes.length - 1 : 1)) % modes.length].id);
    } else if (e.key === 'Backspace' && prefixMode && query.length === 1) {
      e.preventDefault();
      setQuery('');
    }
  };

  let lastGroup = '';

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[10vh]">
          <motion.div
            className="absolute inset-0 bg-ink/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-label="Command menu"
            initial={{ opacity: 0, scale: 0.97, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -6 }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            className="relative w-full max-w-2xl overflow-hidden rounded-xl border border-line bg-surface shadow-pop"
          >
            <div className="flex items-center gap-2.5 border-b border-line px-4">
              <SearchIcon className="h-4 w-4 text-subtle" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKey}
                placeholder="Search or type > for commands, # tasks, @ people, / docs"
                className="h-12 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-subtle"
                aria-label="Search query"
                role="combobox"
                aria-expanded
                aria-controls="cmdk-list"
              />

              <kbd className="rounded border border-line bg-sunken px-1.5 font-mono text-[10px] text-subtle">
                Esc
              </kbd>
            </div>
            <div
              role="tablist"
              aria-label="Scope"
              className="flex gap-1 overflow-x-auto border-b border-line px-3 py-1.5 scroll-thin"
            >
              {modes.map((m) => (
                <button
                  key={m.id}
                  role="tab"
                  aria-selected={mode === m.id}
                  onClick={() => setMode(m.id)}
                  className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-[11.5px] font-medium transition-colors duration-150 ${mode === m.id ? 'bg-ink text-white' : 'text-muted hover:bg-sunken hover:text-ink'}`}
                >
                  {m.prefix && <span className="font-mono opacity-70">{m.prefix}</span>}
                  {m.label}
                </button>
              ))}
            </div>
            <ul
              id="cmdk-list"
              className="max-h-[400px] overflow-y-auto p-1.5 scroll-thin"
              role="listbox"
            >
              {results.length === 0 && (
                <li className="px-3 py-10 text-center text-[13px] text-muted">
                  Nothing matches “{term}”.
                </li>
              )}
              {results.map((r, i) => {
                const header = r.group !== lastGroup ? r.group : null;
                lastGroup = r.group;
                return (
                  <React.Fragment key={`${r.group}-${r.id}`}>
                    {header && (
                      <li
                        role="presentation"
                        className="px-3 pb-1 pt-2 text-[11px] font-semibold text-muted first:pt-1"
                      >
                        {header}
                      </li>
                    )}
                    <li role="option" aria-selected={i === active}>
                      <button
                        onMouseMove={() => setActive(i)}
                        onClick={() => select(r)}
                        className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[13px] ${i === active ? 'bg-sunken' : ''}`}
                      >
                        {r.group === 'Recent' ? (
                          <ClockIcon className="h-4 w-4 shrink-0 text-subtle" />
                        ) : (
                          <r.icon className="h-4 w-4 shrink-0 text-subtle" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-ink">{r.label}</span>
                        {r.hint && (
                          <span className="shrink-0 font-mono text-[11.5px] text-subtle">
                            {r.hint}
                          </span>
                        )}
                        {i === active && (
                          <ArrowRightIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
                        )}
                      </button>
                    </li>
                  </React.Fragment>
                );
              })}
            </ul>
            <footer className="hidden items-center gap-4 border-t border-line bg-sunken/50 px-4 py-1.5 text-[11px] text-muted sm:flex">
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-line bg-white px-1 font-mono">↑↓</kbd>{' '}
                navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-line bg-white px-1">
                  <CornerDownLeftIcon className="h-2.5 w-2.5" />
                </kbd>{' '}
                open
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-line bg-white px-1 font-mono">Tab</kbd> switch
                scope
              </span>
              <span className="ml-auto">
                {results.length} result{results.length === 1 ? '' : 's'}
              </span>
            </footer>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
