import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { CheckIcon, ChevronsUpDownIcon, PlusIcon, SettingsIcon } from 'lucide-react';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useWorkspaceUI } from '../../contexts/WorkspaceUIContext';
import type { Workspace } from '../../types/workspace';

export function WorkspaceMark({ ws, size = 24 }: { ws: Workspace; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-md font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: ws.color, fontSize: size * 0.42 }}
      aria-hidden
    >
      {ws.name
        .split(' ')
        .map((w) => w[0])
        .slice(0, 2)
        .join('')}
    </span>
  );
}

export function WorkspaceSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { workspaces, current, switchTo } = useWorkspace();
  const { setCreateWorkspaceOpen } = useWorkspaceUI();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) =>
      ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="relative min-w-0 flex-1" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex w-full min-w-0 items-center rounded-md py-1 text-left transition-colors duration-150 hover:bg-sunken ${collapsed ? 'justify-center px-0' : 'gap-2 px-1.5'}`}
        title={collapsed ? current.name : undefined}
      >
        <WorkspaceMark ws={current} />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-semibold leading-tight text-ink">
                {current.name}
              </span>
              <span className="block truncate text-[11px] leading-tight text-muted">
                {current.members} members · {current.role}
              </span>
            </span>
            <ChevronsUpDownIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
          </>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
            className="absolute left-0 top-10 z-50 w-64 origin-top-left rounded-lg border border-line bg-white p-1 shadow-pop"
          >
            <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold text-muted">Workspaces</p>
            {workspaces.map((w) => (
              <button
                key={w.id}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  if (w.id !== current.id) {
                    switchTo(w.id);
                    toast.success(`Switched to ${w.name}`, {
                      description: `You’re ${w.role === 'Owner' ? 'an' : 'a'} ${w.role} here. Sample data is shared across demo workspaces.`,
                    });
                  }
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-sunken"
              >
                <WorkspaceMark ws={w} size={22} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-ink">
                    {w.name}
                  </span>
                  <span className="block truncate text-[11px] text-muted">
                    {w.products} products · {w.members} members
                  </span>
                </span>
                {w.id === current.id && <CheckIcon className="h-3.5 w-3.5 text-accent" />}
              </button>
            ))}
            <div className="mt-1 border-t border-line pt-1">
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  setCreateWorkspaceOpen(true);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-ink hover:bg-sunken"
              >
                <PlusIcon className="h-3.5 w-3.5 text-muted" /> Create workspace
              </button>
              <Link
                to="/workspaces"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-ink hover:bg-sunken"
              >
                <SettingsIcon className="h-3.5 w-3.5 text-muted" /> Manage workspaces
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
