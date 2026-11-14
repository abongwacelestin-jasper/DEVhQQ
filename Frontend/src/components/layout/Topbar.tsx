import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { BellIcon, PanelLeftIcon, PlusIcon, SearchIcon, SparklesIcon } from 'lucide-react';
import { ProductScopeMenu } from './ProductScopeMenu';
import { DateRangeMenu } from './DateRangeMenu';
import { WorkspaceMark } from './WorkspaceSwitcher';
import { useWorkspaceUI } from '../../contexts/WorkspaceUIContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useAuth } from '../../contexts/AuthContext';
import { useIncidents } from '../../contexts/IncidentContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { TopbarProfileMenu } from './TopbarProfileMenu';

const titles: Record<string, string> = {
  '': 'Overview',
  'my-work': 'My work',
  projects: 'Projects',
  tasks: 'Task',
  assignments: 'Assignments',
  activity: 'Work activity',
  workspaces: 'Workspaces',
  repositories: 'Repositories',
  'pull-requests': 'Pull requests',
  deployments: 'Deployments',
  incidents: 'Incidents',
  monitors: 'Monitors',
  team: 'Team & roles',
  security: 'Security',
  integrations: 'Integrations',
  audit: 'Audit log',
  products: 'Product',
  'test-queue': 'Test queue',
};

const scopedSegments = new Set([
  '',
  'my-work',
  'test-queue',
  'projects',
  'assignments',
  'activity',
  'repositories',
  'pull-requests',
  'deployments',
  'incidents',
  'monitors',
  'team',
  'docs',
  'code-security',
  'messages',
]);
const datedSegments = new Set([
  '',
  'my-work',
  'assigned',
  'projects',
  'tasks',
  'assignments',
  'activity',
  'test-queue',
  'repositories',
  'pull-requests',
  'code-security',
  'deployments',
  'incidents',
  'monitors',
  'team',
  'docs',
  'audit',
  'security',
  'integrations',
  'products',
]);

export function Topbar({ onSearch }: { onSearch: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    setAssistantOpen,
    sidebarCollapsed,
    setSidebarCollapsed,
    openCreateTask,
    setCreateWorkspaceOpen,
  } = useWorkspaceUI();
  const { current } = useWorkspace();
  const { can, canDo, role } = useAuth();
  const { setDeclareOpen } = useIncidents();
  const { t } = useLanguage();
  const [newOpen, setNewOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const parts = location.pathname.split('/');
  const segment = parts[1] ?? '';
  const isDetail = parts.length > 2 && parts[2] !== '';

  useEffect(() => {
    if (!newOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setNewOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [newOpen]);

  const newItems = [
    { label: 'Task', show: canDo('task:create'), action: () => openCreateTask() },
    {
      label: 'Bug report',
      show: canDo('bug:report'),
      action: () => openCreateTask({ type: 'bug', priority: 'high' }),
    },
    {
      label: 'Declare incident',
      show: canDo('incident:declare'),
      action: () => setDeclareOpen(true),
    },
    {
      label: 'Workspace',
      show: canDo('workspace:create'),
      action: () => setCreateWorkspaceOpen(true),
    },
    {
      label: 'Invite member',
      show: canDo('member:invite'),
      action: () => navigate('/team?invite=1'),
    },
    {
      label: 'API token',
      show: can('security') && canDo('member:invite'),
      action: () => navigate('/security?token=new'),
    },
    {
      label: 'Register product',
      show: canDo('workspace:create'),
      action: () =>
        toast('Product registration', {
          description: 'Connect a repository and environments to register a product.',
        }),
    },
  ].filter((i) => i.show);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
      <div className="flex h-12 min-w-0 items-center gap-1.5 px-2.5 sm:gap-2 sm:px-4 lg:px-5">
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="hidden shrink-0 rounded-md p-1.5 text-muted hover:bg-sunken hover:text-ink lg:inline-flex"
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={sidebarCollapsed}
        >
          <PanelLeftIcon className="h-4 w-4" />
        </button>
        <Link
          to={role?.home ?? '/'}
          className="shrink-0 lg:hidden"
          aria-label={`${current.name} home`}
        >
          <WorkspaceMark ws={current} size={24} />
        </Link>

        <div className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
          <span className="hidden truncate text-muted xl:inline">{current.name}</span>
          <span className="hidden text-line-strong xl:inline">/</span>
          <span className="truncate font-semibold text-ink">
            {t(`nav./${segment}`, titles[segment] ?? 'TavetaHQ')}
          </span>
          {isDetail && (
            <span className="hidden truncate font-mono text-[11.5px] text-subtle sm:inline">
              / {decodeURIComponent(parts[2]).replace('--', '/')}
            </span>
          )}
        </div>

        {scopedSegments.has(segment) && (!isDetail || segment === 'docs') && <ProductScopeMenu />}
        {datedSegments.has(segment) && <DateRangeMenu />}

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
          <button
            onClick={onSearch}
            className="hidden h-8 items-center gap-2 rounded-md border border-line bg-white px-2.5 text-[12px] text-subtle transition-colors duration-150 hover:border-line-strong md:flex md:w-40 xl:w-56"
          >
            <SearchIcon className="h-3.5 w-3.5" />
            <span className="flex-1 truncate text-left">{t('top.search')}</span>
            <kbd className="rounded border border-line bg-sunken px-1 font-mono text-[10px] text-muted">
              ⌘K
            </kbd>
          </button>
          <IconButton label="Search" onClick={onSearch} className="md:hidden">
            <SearchIcon className="h-4 w-4" />
          </IconButton>
          <button
            onClick={() => setAssistantOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-white px-2 text-[12px] font-medium text-ink transition-colors duration-150 hover:border-line-strong"
            aria-label={t('top.ask')}
          >
            <SparklesIcon className="h-3.5 w-3.5 text-accent" />
            <span className="hidden xl:inline">{t('top.ask')}</span>
          </button>
          <Link
            to="/my-work"
            className="relative hidden rounded-md p-2 text-muted hover:bg-sunken hover:text-ink sm:block"
            aria-label={t('top.notifications')}
          >
            <BellIcon className="h-4 w-4" />
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-bad ring-2 ring-white" />
          </Link>
          <div className={`relative hidden ${newItems.length ? 'lg:block' : ''}`} ref={menuRef}>
            <button
              onClick={() => setNewOpen((v) => !v)}
              aria-expanded={newOpen}
              aria-haspopup="menu"
              className="inline-flex h-8 items-center gap-1 rounded-md bg-ink px-2.5 text-[12px] font-medium text-white transition-colors duration-150 hover:bg-ink/90"
            >
              <PlusIcon className="h-3.5 w-3.5" /> {t('top.new')}
            </button>
            <AnimatePresence>
              {newOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
                  className="absolute right-0 top-10 z-40 w-48 origin-top-right rounded-lg border border-line bg-white p-1 shadow-pop"
                  role="menu"
                >
                  {newItems.map((item) => (
                    <button
                      key={item.label}
                      role="menuitem"
                      onClick={() => {
                        item.action();
                        setNewOpen(false);
                      }}
                      className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-sunken"
                    >
                      {item.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <span className="mx-0.5 hidden h-5 w-px bg-line sm:block" aria-hidden />
          <TopbarProfileMenu />
        </div>
      </div>
    </header>
  );
}

function IconButton({
  label,
  onClick,
  className = '',
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`rounded-md p-2 text-muted hover:bg-sunken hover:text-ink ${className}`}
    >
      {children}
    </button>
  );
}
