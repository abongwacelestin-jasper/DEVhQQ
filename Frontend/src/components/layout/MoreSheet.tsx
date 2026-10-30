import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronRightIcon,
  LogOutIcon,
  RepeatIcon,
  SearchIcon,
  ShieldCheckIcon,
  XIcon,
} from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { ProductMark } from '../ui/ProductMark';
import { WorkspaceMark } from './WorkspaceSwitcher';
import { useNavEntries } from '../../hooks/useNavEntries';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useProductFilter } from '../../contexts/ProductFilterContext';
import { memberById } from '../../utils/status';

const ease = [0.23, 1, 0.32, 1] as const;

/** Compact "More" sheet for tablet and mobile: bottom sheet on phones, small centred panel on tablets. */
export function MoreSheet({
  open,
  onClose,
  returnFocus,
}: {
  open: boolean;
  onClose: () => void;
  returnFocus?: React.RefObject<HTMLButtonElement>;
}) {
  const { sections } = useNavEntries();
  const { session, role, signOut, can } = useAuth();
  const { current } = useWorkspace();
  const { allowedProducts } = useProductFilter();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!open) return;
    setQ('');
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTarget = returnFocus?.current;
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      focusTarget?.focus();
    };
  }, [open, onClose, returnFocus]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return sections;
    return sections
      .map((s) => ({
        ...s,
        items: s.items.filter((it) => `${it.label} ${it.short}`.toLowerCase().includes(n)),
      }))
      .filter((s) => s.items.length);
  }, [sections, q]);

  if (!session || !role) return null;
  const me = memberById(session.memberId);
  const isActive = (to: string) => (to === '/' ? pathname === '/' : pathname.startsWith(to));
  const leave = () => {
    onClose();
    signOut();
    navigate('/sign-in', { replace: true });
  };
  const products = can('products')
    ? allowedProducts.filter((p) => !q || p.name.toLowerCase().includes(q.trim().toLowerCase()))
    : [];

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center md:p-4 lg:hidden">
          <motion.div
            className="absolute inset-0 bg-ink/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="All sections"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.24, ease }}
            className="relative flex max-h-[78vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-pop md:max-h-[72vh] md:max-w-[420px] md:rounded-2xl"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            <span
              className="mx-auto mt-1.5 h-1 w-9 shrink-0 rounded-full bg-line-strong md:hidden"
              aria-hidden
            />

            {/* Identity row: workspace + you, one line */}
            <header className="flex items-center gap-2 px-3 pb-2 pt-2">
              <Link
                to={can('workspaces') ? '/workspaces' : '#'}
                onClick={onClose}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 hover:bg-sunken/60"
                title="Switch workspace"
              >
                <WorkspaceMark ws={current} size={26} />
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-semibold leading-4 text-ink">
                    {current.name}
                  </span>
                  <span className="flex items-center gap-1 truncate text-[10.5px] leading-4 text-muted">
                    <Avatar id={me.id} size="xs" /> {me.name.split(' ')[0]} · {role.label}
                    <ShieldCheckIcon
                      className="h-3 w-3 shrink-0 text-ok"
                      aria-label="MFA verified"
                    />
                  </span>
                </span>
                {can('workspaces') && (
                  <ChevronRightIcon className="ml-auto h-3.5 w-3.5 shrink-0 text-subtle" />
                )}
              </Link>
              <button
                onClick={onClose}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-sunken hover:text-ink"
                aria-label="Close"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </header>

            <div className="px-3 pb-2">
              <label className="relative block">
                <span className="sr-only">Find a section</span>
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Find a section"
                  className="h-8 w-full rounded-lg border border-line bg-sunken/40 pl-8 pr-2 text-[12.5px] outline-none focus:border-accent focus:bg-white"
                />
              </label>
            </div>

            <div className="scroll-thin min-h-0 flex-1 space-y-2.5 overflow-y-auto border-t border-line px-3 py-2.5">
              {filtered.map((s) => (
                <section key={s.title} aria-label={s.title}>
                  <h2 className="mb-1 px-0.5 text-[10.5px] font-semibold text-subtle">{s.title}</h2>
                  <ul className="grid grid-cols-4 gap-1">
                    {s.items.map((it) => {
                      const on = isActive(it.to);
                      return (
                        <li key={it.to}>
                          <Link
                            to={it.to}
                            onClick={onClose}
                            aria-current={on ? 'page' : undefined}
                            className={`relative flex h-[54px] flex-col items-center justify-center gap-1 rounded-lg px-1 text-center transition-colors duration-150 ${on ? 'bg-ink text-white' : 'text-ink hover:bg-sunken'}`}
                          >
                            <it.icon className="h-[17px] w-[17px]" />
                            <span className="w-full truncate text-[10.5px] font-medium leading-none">
                              {it.short}
                            </span>
                            {it.count ? (
                              <span
                                className={`absolute right-1 top-1 min-w-[14px] rounded-full px-[3px] text-center text-[9px] font-bold leading-[14px] ${it.alert ? 'bg-bad text-white' : on ? 'bg-white text-ink' : 'bg-sunken text-ink'}`}
                              >
                                {it.count}
                              </span>
                            ) : null}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
              {products.length > 0 && (
                <section aria-label="Products">
                  <h2 className="mb-1 px-0.5 text-[10.5px] font-semibold text-subtle">Products</h2>
                  <ul className="flex flex-wrap gap-1">
                    {products.map((p) => (
                      <li key={p.id}>
                        <Link
                          to={`/products/${p.id}`}
                          onClick={onClose}
                          className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2 text-[11.5px] font-medium transition-colors duration-150 ${pathname.startsWith(`/products/${p.id}`) ? 'border-ink text-ink' : 'border-line text-ink hover:bg-sunken'}`}
                        >
                          <ProductMark product={p.id} size="sm" /> {p.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {filtered.length === 0 && products.length === 0 && (
                <p className="py-6 text-center text-[12px] text-muted">No section matches “{q}”.</p>
              )}
            </div>

            <footer className="grid grid-cols-2 gap-1.5 border-t border-line px-3 py-2">
              <button
                onClick={leave}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg text-[12px] font-medium text-ink hover:bg-sunken"
              >
                <RepeatIcon className="h-3.5 w-3.5" /> Switch role
              </button>
              <button
                onClick={leave}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg text-[12px] font-semibold text-bad hover:bg-bad-soft"
              >
                <LogOutIcon className="h-3.5 w-3.5" /> Sign out
              </button>
            </footer>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
