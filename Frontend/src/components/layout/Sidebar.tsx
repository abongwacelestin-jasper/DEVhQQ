import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { ChevronDownIcon, SearchIcon, XIcon } from 'lucide-react';
import { ProductMark } from '../ui/ProductMark';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { ProfileMenu } from './ProfileMenu';
import { useNavEntries, type CountedEntry } from '../../hooks/useNavEntries';
import { useAuth } from '../../contexts/AuthContext';
import { useProductFilter } from '../../contexts/ProductFilterContext';
import { useWorkspaceUI } from '../../contexts/WorkspaceUIContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { healthMeta, toneDot } from '../../utils/status';

interface SidebarProps {
  collapsed?: boolean;
  onClose?: () => void;
}

const KEY = 'devhq.nav.closed';

function readClosed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function Sidebar({ collapsed = false, onClose }: SidebarProps) {
  const { sections } = useNavEntries();
  const { can, role } = useAuth();
  const { allowedProducts } = useProductFilter();
  const { setSidebarCollapsed } = useWorkspaceUI();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<string[]>(readClosed);
  const inputRef = useRef<HTMLInputElement>(null);
  const term = q.trim().toLowerCase();

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(closed));
  }, [closed]);

  // "/" focuses the filter on the desktop sidebar (the mobile drawer has its own focus flow).
  useEffect(() => {
    if (onClose) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        e.key !== '/' ||
        e.metaKey ||
        e.ctrlKey ||
        el?.closest('input, textarea, select, [contenteditable="true"]')
      )
        return;
      e.preventDefault();
      setSidebarCollapsed(false);
      window.setTimeout(() => inputRef.current?.focus(), 220);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, setSidebarCollapsed]);

  const label = (i: CountedEntry) => t(`nav.${i.to}`, i.label);
  const matches = (text: string, alt = '') =>
    !term || text.toLowerCase().includes(term) || alt.toLowerCase().includes(term);

  const groups = sections
    .map((g) => ({ title: g.title, items: g.items.filter((i) => matches(label(i), i.label)) }))
    .filter((g) => g.items.length > 0);
  const firstTitle = sections[0]?.title;
  const first = groups.find((g) => g.title === firstTitle);
  const others = groups.filter((g) => g.title !== firstTitle);
  const products = can('products') ? allowedProducts.filter((p) => matches(p.name)) : [];
  const results = [
    ...groups.flatMap((g) => g.items.map((i) => i.to)),
    ...products.map((p) => `/products/${p.id}`),
  ];
  const isOpen = (title: string) => collapsed || !!term || !closed.includes(title);
  const toggle = (title: string) =>
    setClosed((c) => (c.includes(title) ? c.filter((x) => x !== title) : [...c, title]));

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `group relative flex h-8 min-w-0 items-center rounded-md text-[12.5px] font-medium transition-colors duration-150 ${
      collapsed ? 'justify-center px-0' : 'gap-2.5 px-2'
    } ${
      isActive
        ? 'bg-sunken text-ink before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-accent'
        : 'text-muted hover:bg-sunken/70 hover:text-ink'
    }`;

  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      <div
        className={`flex h-12 shrink-0 items-center border-b border-line ${collapsed ? 'justify-center px-1.5' : 'gap-1 px-2'}`}
      >
        <WorkspaceSwitcher collapsed={collapsed} />
        {onClose && (
          <button
            onClick={onClose}
            className="shrink-0 rounded-md p-1.5 text-muted hover:bg-sunken hover:text-ink"
            aria-label="Close navigation"
          >
            <XIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      {collapsed ? (
        <div className="flex justify-center pt-2.5">
          <button
            onClick={() => {
              setSidebarCollapsed(false);
              window.setTimeout(() => inputRef.current?.focus(), 220);
            }}
            className="rounded-md p-2 text-muted hover:bg-sunken hover:text-ink"
            aria-label={t('sidebar.search')}
            title={t('sidebar.search')}
          >
            <SearchIcon className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="px-2.5 pt-2.5">
          <label className="relative block">
            <span className="sr-only">{t('sidebar.filter')}</span>
            <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setQ('');
                  e.currentTarget.blur();
                } else if (e.key === 'Enter' && results[0]) {
                  navigate(results[0]);
                  setQ('');
                  onClose?.();
                }
              }}
              placeholder={t('sidebar.filter')}
              className="h-8 w-full rounded-md border border-line bg-sunken/60 pl-7 pr-7 text-[12.5px] text-ink outline-none transition-colors duration-150 placeholder:text-subtle focus:border-accent focus:bg-white"
            />

            {q ? (
              <button
                onClick={() => setQ('')}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-ink"
                aria-label="Clear filter"
              >
                <XIcon className="h-3 w-3" />
              </button>
            ) : (
              !onClose && (
                <kbd className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 rounded border border-line bg-white px-1 font-mono text-[10px] text-subtle">
                  /
                </kbd>
              )
            )}
          </label>
          {term && results.length > 0 && (
            <p className="mt-1.5 px-0.5 text-[11px] text-muted" aria-live="polite">
              {t('sidebar.results', undefined, { n: results.length })} · ↵
            </p>
          )}
        </div>
      )}

      <nav
        className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-2.5 scroll-thin ${collapsed ? 'px-2' : 'px-2.5'}`}
        aria-label="Primary"
      >
        {!collapsed && !term && role && role.key !== 'admin' && (
          <p className="mb-2 rounded-md bg-accent-soft/60 px-2 py-1.5 text-[11px] font-medium text-accent-ink">
            {t('sidebar.view', undefined, { role: role.label, n: role.areas.length })}
          </p>
        )}

        {term && results.length === 0 && (
          <p className="px-2 py-6 text-center text-[12px] text-muted">
            {t('sidebar.noResults', undefined, { q })}
          </p>
        )}

        {first && (
          <NavGroup
            items={first.items}
            collapsed={collapsed}
            linkClass={linkClass}
            label={label}
            term={term}
          />
        )}

        {products.length > 0 && (
          <>
            <GroupHeader
              title={t('group.Products')}
              collapsed={collapsed}
              open={isOpen('Products')}
              onToggle={() => toggle('Products')}
              count={products.length}
            />
            {isOpen('Products') && (
              <ul className="space-y-px">
                {products.map((p) => (
                  <li key={p.id}>
                    <NavLink
                      to={`/products/${p.id}`}
                      className={linkClass}
                      title={collapsed ? p.name : undefined}
                      onClick={() => setQ('')}
                    >
                      <ProductMark product={p.id} size="sm" />
                      {!collapsed && (
                        <span className="min-w-0 flex-1 truncate">
                          <Highlight text={p.name} term={term} />
                        </span>
                      )}
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDot[healthMeta[p.health].tone]} ${collapsed ? 'absolute right-1.5 top-1.5' : ''}`}
                        title={healthMeta[p.health].label}
                      />
                    </NavLink>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {others.map((g) => (
          <div key={g.title}>
            <GroupHeader
              title={t(`group.${g.title}`, g.title)}
              collapsed={collapsed}
              open={isOpen(g.title)}
              onToggle={() => toggle(g.title)}
              count={g.items.reduce((n, i) => n + (i.count ?? 0), 0)}
              alert={g.items.some((i) => i.alert && i.count)}
            />

            {isOpen(g.title) && (
              <NavGroup
                items={g.items}
                collapsed={collapsed}
                linkClass={linkClass}
                label={label}
                term={term}
                onPick={() => setQ('')}
              />
            )}
          </div>
        ))}
      </nav>

      <ProfileMenu collapsed={collapsed} />
    </div>
  );
}

function GroupHeader({
  title,
  collapsed,
  open,
  onToggle,
  count,
  alert,
}: {
  title: string;
  collapsed: boolean;
  open: boolean;
  onToggle: () => void;
  count: number;
  alert?: boolean;
}) {
  if (collapsed) return <div className="mx-2 my-2.5 h-px bg-line" aria-hidden />;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="mb-1 mt-4 flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-semibold text-muted transition-colors duration-150 hover:text-ink"
    >
      <span className="flex-1 truncate text-left">{title}</span>
      {!open && count > 0 && (
        <span
          className={`rounded px-1 text-[10.5px] tabular-nums ${alert ? 'bg-bad-soft text-bad' : 'bg-sunken text-ink'}`}
        >
          {count}
        </span>
      )}
      <ChevronDownIcon
        className={`h-3 w-3 shrink-0 transition-transform duration-150 ${open ? '' : '-rotate-90'}`}
      />
    </button>
  );
}

function Highlight({ text, term }: { text: string; term: string }) {
  const i = term ? text.toLowerCase().indexOf(term) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-accent-soft px-px text-ink">
        {text.slice(i, i + term.length)}
      </mark>
      {text.slice(i + term.length)}
    </>
  );
}

function NavGroup({
  items,
  collapsed,
  linkClass,
  label,
  term,
  onPick,
}: {
  items: CountedEntry[];
  collapsed: boolean;
  linkClass: (s: { isActive: boolean }) => string;
  label: (i: CountedEntry) => string;
  term: string;
  onPick?: () => void;
}) {
  return (
    <ul className="space-y-px">
      {items.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            end={item.end}
            className={linkClass}
            title={collapsed ? label(item) : undefined}
            onClick={onPick}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!collapsed && (
              <span className="min-w-0 flex-1 truncate">
                <Highlight text={label(item)} term={term} />
              </span>
            )}
            {item.count ? (
              collapsed ? (
                <span
                  className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${item.alert ? 'bg-bad' : 'bg-accent'}`}
                />
              ) : (
                <span
                  className={`shrink-0 rounded px-1.5 text-[11px] font-semibold tabular-nums ${item.alert ? 'bg-bad-soft text-bad' : 'bg-sunken text-ink group-hover:bg-white'}`}
                >
                  {item.count}
                </span>
              )
            ) : null}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}
