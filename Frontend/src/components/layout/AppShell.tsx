import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { BottomNav } from './BottomNav';
import { CommandMenu } from './CommandMenu';
import { PageSkeleton, type SkeletonVariant } from './PageSkeleton';
import { AssistantPanel } from '../assistant/AssistantPanel';
import { CreateTaskModal } from '../work/CreateTaskModal';
import { CreateWorkspaceModal } from '../workspace/CreateWorkspaceModal';
import { DeclareIncidentModal } from '../operations/DeclareIncidentModal';
import { LockScreen } from '../auth/LockScreen';
import { IdleWarning } from '../auth/IdleWarning';
import { NoAccess } from '../../pages/NoAccess';
import { useRouteLoading } from '../../hooks/useRouteLoading';
import { useIdleLock } from '../../hooks/useIdleLock';
import { useContinuousVerification } from '../../hooks/useContinuousVerification';
import { useAssignmentNotifier } from '../../hooks/useAssignmentEmails';
import { useProductFilter } from '../../contexts/ProductFilterContext';
import { useDateRange } from '../../contexts/DateRangeContext';
import { useWorkspaceUI } from '../../contexts/WorkspaceUIContext';
import { useAuth } from '../../contexts/AuthContext';
import { areaForPath } from '../../data/roles';

function variantFor(pathname: string): SkeletonVariant {
  const [, seg, detail] = pathname.split('/');
  if (detail) return 'detail';
  if (seg === '' || seg === 'security') return 'dashboard';
  if (seg === 'projects') return 'board';
  if (seg === 'my-work' || seg === 'workspaces' || seg === 'test-queue') return 'dashboard';
  return 'table';
}

export function AppShell() {
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();
  const { selected, project } = useProductFilter();
  const { setMobileNavOpen, sidebarCollapsed } = useWorkspaceUI();
  const { preset, from } = useDateRange();
  const { can, role, session, lock } = useAuth();
  const loading = useRouteLoading(
    `${location.pathname}|${selected}|${project}|${preset}|${from.getTime()}`,
  );
  const idleWarnLeft = useIdleLock();
  useContinuousVerification();
  useAssignmentNotifier();

  useEffect(() => {
    setMobileNavOpen(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname, setMobileNavOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (location.pathname === '/' && !can('overview') && role)
    return <Navigate to={role.home} replace />;
  const allowed =
    can(areaForPath(location.pathname)) ||
    (!!session && location.pathname === `/team/${session.memberId}`);

  return (
    <div className="flex min-h-screen w-full max-w-full bg-white">
      <aside
        className={`sticky top-0 z-40 hidden h-screen shrink-0 border-r border-line bg-white transition-[width] duration-200 ease-out lg:flex ${
          sidebarCollapsed ? 'w-[56px]' : 'w-[216px]'
        }`}
      >
        <Sidebar collapsed={sidebarCollapsed} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onSearch={() => setSearchOpen(true)} />
        <main className="min-w-0 flex-1 px-3 pb-24 pt-3.5 sm:px-4 lg:px-5 lg:pb-6 lg:pt-4">
          <div className="mx-auto w-full min-w-0 max-w-[1560px]">
            {!allowed ? (
              <NoAccess />
            ) : loading ? (
              <PageSkeleton variant={variantFor(location.pathname)} />
            ) : (
              <motion.div
                key={location.pathname + selected + project + preset}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
              >
                <Outlet />
              </motion.div>
            )}
          </div>
        </main>
      </div>

      <BottomNav />
      <CommandMenu open={searchOpen} onClose={() => setSearchOpen(false)} />
      <AssistantPanel />
      <CreateTaskModal />
      <CreateWorkspaceModal />
      <DeclareIncidentModal />
      {!session?.locked && (
        <IdleWarning seconds={idleWarnLeft} onLockNow={() => lock('Locked manually')} />
      )}
      {session?.locked && <LockScreen />}
    </div>
  );
}
