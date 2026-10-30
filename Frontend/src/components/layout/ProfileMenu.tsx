import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { LockIcon, LogOutIcon, RepeatIcon, ShieldCheckIcon, UserIcon } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { useAuth } from '../../contexts/AuthContext';
import { memberById } from '../../utils/status';

/** Account row at the bottom of the sidebar: role, MFA state, switch demo role, lock and sign out. */
export function ProfileMenu({ collapsed = false }: { collapsed?: boolean }) {
  const { session, role, signOut, lock } = useAuth();
  const navigate = useNavigate();
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

  if (!session || !role) return null;
  const me = memberById(session.memberId);

  const out = (to: string) => {
    setOpen(false);
    signOut();
    navigate(to, { replace: true });
  };

  return (
    <div ref={ref} className="relative shrink-0 border-t border-line">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex w-full items-center py-2.5 text-left hover:bg-sunken/60 ${collapsed ? 'justify-center px-2' : 'gap-2.5 px-3'}`}
        title={collapsed ? `${me.name} · ${role.label}` : undefined}
      >
        <Avatar id={me.id} size="sm" />
        {!collapsed && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-semibold leading-tight text-ink">
              {me.name}
            </span>
            <span className="flex items-center gap-1 truncate text-[11px] leading-tight text-muted">
              <ShieldCheckIcon className="h-3 w-3 text-ok" />
              {role.label} · MFA verified
            </span>
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
            className={`absolute bottom-full z-50 mb-1 w-56 origin-bottom-left rounded-lg border border-line bg-white p-1 shadow-pop ${collapsed ? 'left-1' : 'left-2'}`}
          >
            <div className="px-2.5 py-1.5">
              <p className="truncate text-[12.5px] font-semibold text-ink">{me.email}</p>
              <p className="text-[11px] text-muted">
                Signed in{' '}
                {session.method === 'demo' ? 'with demo access' : `with ${session.method}`}
                {session.trustedDevice ? ' · trusted device' : ''}
              </p>
            </div>
            <div className="my-1 h-px bg-line" />
            <MenuItem
              icon={UserIcon}
              label="My profile"
              onClick={() => {
                setOpen(false);
                navigate(`/team/${me.id}`);
              }}
            />
            <MenuItem
              icon={LockIcon}
              label="Lock session"
              onClick={() => {
                setOpen(false);
                lock();
              }}
            />
            <MenuItem icon={RepeatIcon} label="Switch demo role" onClick={() => out('/sign-in')} />
            <div className="my-1 h-px bg-line" />
            <MenuItem icon={LogOutIcon} label="Sign out" danger onClick={() => out('/sign-in')} />
            <p className="px-2.5 pb-1 pt-1.5 text-[10.5px] text-muted">
              Sessions are recorded in the{' '}
              <Link to="/audit" className="underline">
                audit log
              </Link>
              .
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] hover:bg-sunken ${danger ? 'text-bad' : 'text-ink'}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
