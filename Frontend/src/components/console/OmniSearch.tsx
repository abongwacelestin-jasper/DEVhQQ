import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BookmarkIcon,
  BookmarkPlusIcon,
  FileTextIcon,
  ListTodoIcon,
  RouteIcon,
  ScrollTextIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react';
import { useConsole } from '../../contexts/ConsoleContext';
import { consoleEndpoints } from '../../data/consoleEndpoints';
import { draftFromEndpoint } from '../../utils/consoleDraft';
import { fuzzyScore } from '../../utils/fuzzy';
import { MethodTag } from './ConsoleBits';
import type { AuditRow } from '../../types/console';
import type { ServerLog } from '../../utils/consoleMockApi';

type Domain = 'all' | 'routes' | 'tasks' | 'logs' | 'audit';
interface Hit {
  id: string;
  domain: Exclude<Domain, 'all'>;
  title: string;
  sub: string;
  method?: string;
  score: number;
  run: () => void;
}
interface SavedView {
  id: string;
  name: string;
  q: string;
  domain: Domain;
}
interface TaskLite {
  key: string;
  title: string;
  status: string;
  product: string;
  assignee: string;
}

const SAVED_KEY = 'devhq.console.savedViews';
const DOMAINS: { id: Domain; label: string; icon: React.ComponentType<{ className?: string }> }[] =
  [
    { id: 'all', label: 'All', icon: SearchIcon },
    { id: 'routes', label: 'Routes', icon: RouteIcon },
    { id: 'tasks', label: 'Tasks', icon: ListTodoIcon },
    { id: 'logs', label: 'Logs', icon: FileTextIcon },
    { id: 'audit', label: 'Audit', icon: ScrollTextIcon },
  ];

const ICON: Record<Hit['domain'], React.ComponentType<{ className?: string }>> = {
  routes: RouteIcon,
  tasks: ListTodoIcon,
  logs: FileTextIcon,
  audit: ScrollTextIcon,
};

function loadSaved(): SavedView[] {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]') as SavedView[];
  } catch {
    return [];
  }
}

/** ⌘K palette across routes, tasks, server logs and audit entries, with saved views. */
export function OmniSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { call, setDraft } = useConsole();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [domain, setDomain] = useState<Domain>('all');
  const [active, setActive] = useState(0);
  const [saved, setSaved] = useState<SavedView[]>(loadSaved);
  const [data, setData] = useState<{ tasks: TaskLite[]; logs: ServerLog[]; audit: AuditRow[] }>({
    tasks: [],
    logs: [],
    audit: [],
  });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setActive(0);
    setTimeout(() => inputRef.current?.focus(), 30);
    let live = true;
    void Promise.all([
      call('GET', '/api/tasks?limit=500'),
      call('GET', '/api/system/logs?limit=300'),
      call('GET', '/api/audit?limit=300'),
    ]).then(([t, l, a]) => {
      if (!live) return;
      setData({
        tasks: t.status === 200 ? (t.body as TaskLite[]) : [],
        logs: l.status === 200 ? (l.body as ServerLog[]) : [],
        audit: a.status === 200 ? (a.body as AuditRow[]) : [],
      });
    });
    return () => {
      live = false;
    };
  }, [open, call]);

  const hits = useMemo<Hit[]>(() => {
    const out: Hit[] = [];
    const add = (h: Omit<Hit, 'score'>, text: string) => {
      const s = fuzzyScore(q, text);
      if (s !== null) out.push({ ...h, score: s });
    };
    const want = (d: Hit['domain']) => domain === 'all' || domain === d;
    if (want('routes'))
      consoleEndpoints.forEach((e) =>
        add(
          {
            id: `r:${e.method}${e.path}`,
            domain: 'routes',
            title: e.path,
            sub: e.summary,
            method: e.method,
            run: () => {
              setDraft(draftFromEndpoint(e));
              navigate('/console/editor');
            },
          },
          `${e.method} ${e.path} ${e.summary} ${e.tag}`,
        ),
      );
    if (want('tasks'))
      data.tasks.forEach((t) =>
        add(
          {
            id: `t:${t.key}`,
            domain: 'tasks',
            title: `${t.key} · ${t.title}`,
            sub: `${t.status} · ${t.product} · ${t.assignee}`,
            run: () => {
              setDraft({
                method: 'GET',
                path: `/api/tasks/${t.key}`,
                params: [],
                headers: [],
                body: '',
              });
              navigate('/console/editor');
            },
          },
          `${t.key} ${t.title} ${t.status} ${t.product}`,
        ),
      );
    if (want('logs'))
      data.logs.forEach((l) =>
        add(
          {
            id: `l:${l.seq}`,
            domain: 'logs',
            title: l.message,
            sub: `${l.level.toUpperCase()} · ${l.method} ${l.path} · ${l.requestId}`,
            run: () => navigate(`/console/logs?q=${encodeURIComponent(l.requestId)}`),
          },
          `${l.level} ${l.message} ${l.path} ${l.requestId}`,
        ),
      );
    if (want('audit'))
      data.audit.forEach((a) =>
        add(
          {
            id: `a:${a.seq}`,
            domain: 'audit',
            title: `${a.action} · ${a.target}`,
            sub: `#${a.seq} · ${a.actor} · ${a.hash.slice(0, 10)}`,
            run: () => navigate(`/console/audit?action=${encodeURIComponent(a.action)}`),
          },
          `${a.action} ${a.target} ${a.actor} ${a.hash}`,
        ),
      );
    return out.sort((a, b) => b.score - a.score).slice(0, q ? 40 : 12);
  }, [q, domain, data, setDraft, navigate]);

  useEffect(() => setActive(0), [q, domain]);

  const pick = (h: Hit) => {
    h.run();
    onClose();
  };
  const saveView = () => {
    const name = q.trim() ? `${q.trim()}${domain !== 'all' ? ` in ${domain}` : ''}` : domain;
    const next = [
      { id: crypto.randomUUID(), name, q, domain },
      ...saved.filter((s) => !(s.q === q && s.domain === domain)),
    ].slice(0, 8);
    setSaved(next);
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
  };
  const removeView = (id: string) => {
    const next = saved.filter((s) => s.id !== id);
    setSaved(next);
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(hits.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && hits[active]) {
      e.preventDefault();
      pick(hits[active]);
    } else if (e.key === 'Escape') onClose();
    else if (e.key === 'Tab') {
      e.preventDefault();
      const i = DOMAINS.findIndex((d) => d.id === domain);
      setDomain(DOMAINS[(i + (e.shiftKey ? DOMAINS.length - 1 : 1)) % DOMAINS.length].id);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-start justify-center p-3 pt-[10vh]"
          onKeyDown={onKey}
        >
          <motion.div
            className="absolute inset-0 bg-ink/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-label="Search everything"
            initial={{ opacity: 0, scale: 0.97, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
            className="relative w-full max-w-[640px] overflow-hidden rounded-xl border border-line bg-white shadow-pop"
          >
            <div className="flex items-center gap-2 border-b border-line px-3">
              <SearchIcon className="h-4 w-4 shrink-0 text-subtle" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search routes, tasks, logs, audit…"
                aria-label="Search"
                className="h-11 min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-subtle"
              />
              <button
                onClick={saveView}
                title="Save this view"
                aria-label="Save view"
                className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink"
              >
                <BookmarkPlusIcon className="h-4 w-4" />
              </button>
            </div>
            <div
              className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line px-2 py-1.5"
              role="tablist"
            >
              {DOMAINS.map((d) => (
                <button
                  key={d.id}
                  role="tab"
                  aria-selected={domain === d.id}
                  onClick={() => setDomain(d.id)}
                  className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-[11.5px] font-medium ${domain === d.id ? 'bg-ink text-canvas' : 'text-muted hover:bg-sunken hover:text-ink'}`}
                >
                  <d.icon className="h-3 w-3" /> {d.label}
                </button>
              ))}
              <span className="ml-auto hidden shrink-0 items-center text-[10.5px] text-subtle sm:flex">
                Tab to switch
              </span>
            </div>

            {!q && saved.length > 0 && (
              <div className="border-b border-line px-2 py-1.5">
                <p className="px-1 pb-1 text-[10.5px] font-semibold text-subtle">Saved views</p>
                <div className="flex flex-wrap gap-1">
                  {saved.map((s) => (
                    <span
                      key={s.id}
                      className="group inline-flex items-center rounded-md border border-line text-[11.5px]"
                    >
                      <button
                        onClick={() => {
                          setQ(s.q);
                          setDomain(s.domain);
                        }}
                        className="inline-flex items-center gap-1 py-0.5 pl-1.5 pr-1 hover:text-accent"
                      >
                        <BookmarkIcon className="h-3 w-3" />
                        {s.name}
                      </button>
                      <button
                        onClick={() => removeView(s.id)}
                        aria-label={`Remove ${s.name}`}
                        className="grid h-5 w-5 place-items-center text-subtle opacity-0 hover:text-bad group-hover:opacity-100"
                      >
                        <XIcon className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <ul className="scroll-thin max-h-[52vh] overflow-y-auto p-1" role="listbox">
              {hits.length === 0 && (
                <li className="px-3 py-8 text-center text-[12.5px] text-muted">
                  Nothing matches “{q}”.
                </li>
              )}
              {hits.map((h, i) => {
                const Icon = ICON[h.domain];
                return (
                  <li key={h.id} role="option" aria-selected={i === active}>
                    <button
                      onMouseMove={() => setActive(i)}
                      onClick={() => pick(h)}
                      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left ${i === active ? 'bg-sunken' : ''}`}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 text-subtle" />
                      {h.method && <MethodTag method={h.method} />}
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-[12.5px] text-ink ${h.domain === 'routes' ? 'font-mono' : ''}`}
                        >
                          {h.title}
                        </span>
                        <span className="block truncate text-[11px] text-subtle">{h.sub}</span>
                      </span>
                      <span className="shrink-0 text-[10.5px] capitalize text-subtle">
                        {h.domain}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
