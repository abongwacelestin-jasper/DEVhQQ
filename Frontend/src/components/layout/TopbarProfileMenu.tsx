import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDownIcon,
  LockIcon,
  LogOutIcon,
  MoonIcon,
  RepeatIcon,
  ShieldCheckIcon,
  SunIcon,
  UserIcon,
  ArrowLeftRightIcon,
} from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { WorkspaceMark } from './WorkspaceSwitcher';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { memberById } from '../../utils/status';
import { accountEntries } from '../../data/navigation';
import type { Lang } from '../../data/translations';

const langs: { value: Lang; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'fr', label: 'FR' },
  { value: 'es', label: 'ES' },
];

/** Top-right identity anchor: account, workspace, appearance, language, session controls. */
export function TopbarProfileMenu() {
  const { session, role, signOut, lock, can } = useAuth();
  const { theme, setTheme } = useTheme();
  const { lang, setLang } = useLanguage();
  const { current } = useWorkspace();
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
  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };
  const out = () => {
    setOpen(false);
    signOut();
    navigate('/sign-in', { replace: true });
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${me.name}`}
        className="flex h-8 items-center gap-1.5 rounded-full border border-line bg-white py-0.5 pl-0.5 pr-1.5 transition-colors duration-150 hover:border-line-strong"
      >
        <span className="relative">
          <Avatar id={me.id} size="sm" />
          <span
            className="absolute -bottom-px -right-px h-2 w-2 rounded-full bg-ok ring-2 ring-white"
            aria-hidden
          />
        </span>
        <span className="hidden max-w-[96px] truncate text-[12px] font-medium text-ink xl:inline">
          {me.name.split(' ')[0]}
        </span>
        <ChevronDownIcon
          className={`h-3 w-3 text-subtle transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
            className="absolute right-0 top-10 z-50 w-[272px] origin-top-right overflow-hidden rounded-xl border border-line bg-white shadow-pop"
          >
            <div className="flex items-center gap-2.5 px-3 py-3">
              <Avatar id={me.id} size="lg" />
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-ink">{me.name}</p>
                <p className="truncate text-[11.5px] text-muted">{me.email}</p>
                <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-ok">
                  <ShieldCheckIcon className="h-3 w-3" /> {role.label} · MFA verified
                </p>
              </div>
            </div>

            <div className="border-t border-line p-1">
              <Link
                to={can('workspaces') ? '/workspaces' : '#'}
                onClick={() => setOpen(false)}
                role="menuitem"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-sunken"
              >
                <WorkspaceMark ws={current} size={20} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-ink">
                    {current.name}
                  </span>
                  <span className="block text-[10.5px] text-muted">Current workspace</span>
                </span>
                {can('workspaces') && <ArrowLeftRightIcon className="h-3.5 w-3.5 text-subtle" />}
              </Link>
            </div>

            <div className="space-y-1.5 border-t border-line px-3 py-2.5">
              <Row label="Theme">
                <Seg
                  value={theme}
                  onChange={setTheme}
                  options={[
                    { value: 'light', label: <SunIcon className="h-3.5 w-3.5" />, title: 'Light' },
                    { value: 'dark', label: <MoonIcon className="h-3.5 w-3.5" />, title: 'Dark' },
                  ]}
                />
              </Row>
              <Row label="Language">
                <Seg
                  value={lang}
                  onChange={setLang}
                  options={langs.map((l) => ({ value: l.value, label: l.label, title: l.label }))}
                />
              </Row>
            </div>

            <div className="border-t border-line p-1">
              <Item icon={UserIcon} label="My profile" onClick={() => go(`/team/${me.id}`)} />
              {accountEntries.map((e) => (
                <Item key={e.to} icon={e.icon} label={e.label} onClick={() => go(e.to)} />
              ))}
              {can('security') && (
                <Item
                  icon={ShieldCheckIcon}
                  label="Security center"
                  onClick={() => go('/security')}
                />
              )}
              <Item
                icon={LockIcon}
                label="Lock session"
                hint="Idle lock"
                onClick={() => {
                  setOpen(false);
                  lock();
                }}
              />
              <Item icon={RepeatIcon} label="Switch account" onClick={out} />
            </div>
            <div className="border-t border-line p-1">
              <Item icon={LogOutIcon} label="Sign out" danger onClick={out} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[12px] text-muted">{label}</span>
      {children}
    </div>
  );
}

function Seg<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; title: string }[];
}) {
  return (
    <div role="radiogroup" className="inline-flex rounded-md border border-line bg-sunken/50 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.title}
          onClick={() => onChange(o.value)}
          className={`grid h-6 min-w-[30px] place-items-center rounded px-1.5 text-[11px] font-semibold transition-colors duration-150 ${value === o.value ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Item({
  icon: Icon,
  label,
  hint,
  onClick,
  danger,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint?: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors duration-100 ${danger ? 'text-bad hover:bg-bad-soft' : 'text-ink hover:bg-sunken'}`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[10.5px] text-subtle">{hint}</span>}
    </button>
  );
}
