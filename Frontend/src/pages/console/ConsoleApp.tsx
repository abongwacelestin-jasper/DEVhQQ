import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  ActivityIcon,
  BookOpenIcon,
  BugIcon,
  DatabaseIcon,
  FileTextIcon,
  GlobeIcon,
  LayoutDashboardIcon,
  ListTreeIcon,
  LogOutIcon,
  MonitorIcon,
  ScrollTextIcon,
  SearchIcon,
  SendIcon,
  ServerIcon,
} from 'lucide-react';
import { ErrorsView } from '../../components/console/ErrorsView';
import { OmniSearch } from '../../components/console/OmniSearch';
import { PresenceBar } from '../../components/console/PresenceBar';
import { usePresence } from '../../hooks/usePresence';
import { ConsoleProvider, useConsole } from '../../contexts/ConsoleContext';
import { DevHQLogo } from '../../components/ui/DevHQLogo';
import { ThemeToggle } from '../../components/layout/ThemeToggle';
import { ConsoleLogin } from './ConsoleLogin';
import { OverviewView } from '../../components/console/OverviewView';
import { RequestEditor } from '../../components/console/RequestEditor';
import { EndpointsView } from '../../components/console/EndpointsView';
import { QueryView } from '../../components/console/QueryView';
import { LocationsView } from '../../components/console/LocationsView';
import { AuditView } from '../../components/console/AuditView';
import { StatusCodesView } from '../../components/console/StatusCodesView';
import { LogsView } from '../../components/console/LogsView';
import { LiveEventsView } from '../../components/console/LiveEventsView';

const nav = [
  { to: '', label: 'Overview', icon: LayoutDashboardIcon, group: 'Run' },
  { to: 'editor', label: 'Workbench', icon: SendIcon, group: 'Run' },
  { to: 'endpoints', label: 'Endpoints', icon: ListTreeIcon, group: 'Run' },
  { to: 'query', label: 'Query runner', icon: DatabaseIcon, group: 'Run' },
  { to: 'events', label: 'Live events', icon: ActivityIcon, group: 'Observe' },
  { to: 'errors', label: 'Errors', icon: BugIcon, group: 'Observe' },
  { to: 'logs', label: 'Server logs', icon: FileTextIcon, group: 'Observe' },
  { to: 'audit', label: 'Audit trail', icon: ScrollTextIcon, group: 'Observe' },
  { to: 'locations', label: 'Locations', icon: GlobeIcon, group: 'Observe' },
  { to: 'codes', label: 'Status codes', icon: BookOpenIcon, group: 'Reference' },
];

/** Standalone operator console for the backend, at /console. */
export function ConsoleApp() {
  return (
    <ConsoleProvider>
      <ConsoleGate />
    </ConsoleProvider>
  );
}

function ConsoleGate() {
  const { session } = useConsole();
  return session ? <ConsoleShell /> : <ConsoleLogin />;
}

function ConsoleShell() {
  const { session, signOut, mode, baseUrl, draft } = useConsole();
  const { pathname } = useLocation();
  const current =
    nav.find((n) =>
      n.to ? pathname.startsWith(`/console/${n.to}`) : pathname.replace(/\/$/, '') === '/console',
    ) ?? nav[0];
  const m = session!.member;
  const [searchOpen, setSearchOpen] = useState(false);
  const peers = usePresence(
    { id: m.id, name: m.name },
    current.label,
    current.to === 'editor' ? `${draft.method} ${draft.path}` : undefined,
    mode === 'preview',
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-screen w-full bg-canvas text-ink">
      <aside
        className="hidden w-[220px] shrink-0 flex-col border-r border-line bg-white md:flex"
        aria-label="Console navigation"
      >
        <div className="flex h-12 items-center gap-2 border-b border-line px-4">
          <DevHQLogo size={20} />
          <span className="text-[13px] font-semibold">DevHQ</span>
          <span className="text-[12px] text-subtle">console</span>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          {['Run', 'Observe', 'Reference'].map((g) => (
            <div key={g} className="mb-2">
              <p className="px-2 pb-1 pt-2 text-[10.5px] font-semibold text-subtle">{g}</p>
              {nav
                .filter((n) => n.group === g)
                .map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to ? `/console/${n.to}` : '/console'}
                    end={!n.to}
                    className={({ isActive }) =>
                      `flex h-8 items-center gap-2.5 rounded-md px-2 text-[12.5px] font-medium transition-colors duration-150 ${isActive ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:bg-sunken hover:text-ink'}`
                    }
                  >
                    <n.icon className="h-4 w-4" /> {n.label}
                  </NavLink>
                ))}
            </div>
          ))}
        </nav>
        <div className="flex items-center gap-2.5 border-t border-line px-3 py-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-[10.5px] font-semibold text-accent-ink">
            {m.name
              .split(' ')
              .map((x) => x[0])
              .join('')
              .slice(0, 2)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold">{m.name}</p>
            <p className="truncate text-[11px] text-subtle">{m.role}</p>
          </div>
          <button
            onClick={() => void signOut()}
            aria-label="Sign out"
            className="grid h-7 w-7 place-items-center rounded-md text-subtle hover:bg-sunken hover:text-ink"
          >
            <LogOutIcon className="h-4 w-4" />
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-white px-4">
          <span className="md:hidden">
            <DevHQLogo size={20} />
          </span>
          <h1 className="truncate text-[13.5px] font-semibold">{current.label}</h1>
          <button
            onClick={() => setSearchOpen(true)}
            className="ml-auto inline-flex h-8 items-center gap-2 rounded-md border border-line bg-canvas px-2 text-[12px] text-subtle hover:border-line-strong hover:text-ink sm:w-56 lg:w-72"
          >
            <SearchIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden truncate sm:inline">Search routes, tasks, logs…</span>
            <kbd className="ml-auto hidden rounded border border-line px-1 font-sans text-[10px] sm:inline">
              ⌘K
            </kbd>
          </button>
          <PresenceBar peers={peers} />
          <span className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[11px] text-muted">
            {mode === 'preview' ? (
              <MonitorIcon className="h-3.5 w-3.5" />
            ) : (
              <ServerIcon className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">
              {mode === 'preview' ? 'Preview server' : baseUrl.replace(/^https?:\/\//, '')}
            </span>
            <span className="h-1.5 w-1.5 rounded-full bg-ok" />
          </span>
          <ThemeToggle />
          <button
            onClick={() => void signOut()}
            aria-label="Sign out"
            className="grid h-8 w-8 place-items-center rounded-md text-subtle hover:bg-sunken hover:text-ink md:hidden"
          >
            <LogOutIcon className="h-4 w-4" />
          </button>
        </header>

        {/* Mobile nav */}
        <nav
          className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-white px-2 py-1.5 md:hidden"
          aria-label="Console sections"
        >
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to ? `/console/${n.to}` : '/console'}
              end={!n.to}
              className={({ isActive }) =>
                `flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium ${isActive ? 'bg-accent-soft text-accent-ink' : 'text-muted'}`
              }
            >
              <n.icon className="h-3.5 w-3.5" /> {n.label}
            </NavLink>
          ))}
        </nav>

        <main className="scroll-thin min-h-0 flex-1 overflow-auto p-3 sm:p-4">
          <Routes>
            <Route index element={<OverviewView />} />
            <Route path="editor" element={<RequestEditor />} />
            <Route path="endpoints" element={<EndpointsView />} />
            <Route path="query" element={<QueryView />} />
            <Route path="locations" element={<LocationsView />} />
            <Route path="audit" element={<AuditView />} />
            <Route path="logs" element={<LogsView />} />
            <Route path="errors" element={<ErrorsView />} />
            <Route path="events" element={<LiveEventsView />} />
            <Route path="codes" element={<StatusCodesView />} />
            <Route path="*" element={<Navigate to="/console" replace />} />
          </Routes>
        </main>
      </div>
      <OmniSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
