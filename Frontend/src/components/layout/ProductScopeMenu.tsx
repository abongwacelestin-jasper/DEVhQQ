import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CheckIcon,
  ChevronDownIcon,
  FolderIcon,
  LayersIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react';
import { ProductMark } from '../ui/ProductMark';
import { useProductFilter } from '../../contexts/ProductFilterContext';
import { healthMeta, projectStatusMeta, toneDot } from '../../utils/status';

/** Global scope picker — product and, optionally, a project inside it. Every scoped view reads from this. */
export function ProductScopeMenu() {
  const {
    selected,
    setSelected,
    project,
    setProject,
    allowedProducts,
    allowedProjects,
    activeProject,
    activeProduct,
    clearScope,
  } = useProductFilter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const needle = q.trim().toLowerCase();
  const groups = allowedProducts
    .map((p) => ({
      p,
      items: allowedProjects.filter(
        (x) =>
          x.product === p.id && (!needle || `${x.name} ${p.name}`.toLowerCase().includes(needle)),
      ),
    }))
    .filter((g) => !needle || g.items.length > 0 || g.p.name.toLowerCase().includes(needle));

  return (
    <div className="relative shrink-0" ref={ref}>
      <div className="inline-flex h-8 items-center rounded-md border border-line bg-white text-[12px] font-medium text-ink transition-colors duration-150 hover:border-line-strong">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Scope: ${activeProject ? `${activeProduct?.name} / ${activeProject.name}` : (activeProduct?.name ?? 'All products')}`}
          className="inline-flex h-full max-w-[260px] items-center gap-1.5 pl-2 pr-1.5"
        >
          {activeProduct ? (
            <ProductMark product={activeProduct.id} size="sm" />
          ) : (
            <LayersIcon className="h-3.5 w-3.5 text-muted" />
          )}
          <span className="hidden truncate sm:inline">{activeProduct?.name ?? 'All products'}</span>
          {activeProject && (
            <>
              <span className="hidden text-line-strong sm:inline">/</span>
              <span className="truncate text-ink">{activeProject.name}</span>
            </>
          )}
          <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-subtle" />
        </button>
        {(activeProduct || activeProject) && (
          <button
            onClick={clearScope}
            aria-label="Clear scope"
            className="mr-1 rounded p-0.5 text-subtle hover:bg-sunken hover:text-ink"
          >
            <XIcon className="h-3 w-3" />
          </button>
        )}
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
            className="absolute left-0 top-10 z-40 w-[300px] origin-top-left overflow-hidden rounded-lg border border-line bg-white shadow-pop"
          >
            <label className="relative block border-b border-line">
              <span className="sr-only">Find product or project</span>
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Find a product or project…"
                className="h-9 w-full bg-transparent pl-8 pr-3 text-[12.5px] text-ink outline-none placeholder:text-subtle"
              />
            </label>
            <ul
              role="listbox"
              aria-label="Scope"
              className="max-h-[360px] overflow-y-auto p-1 scroll-thin"
            >
              {!needle && (
                <ScopeRow
                  active={selected === 'all'}
                  onClick={() => {
                    clearScope();
                    setOpen(false);
                  }}
                  icon={<LayersIcon className="h-4 w-4 text-muted" />}
                  label="All products"
                  hint="Everything you can access"
                />
              )}
              {groups.map(({ p, items }) => (
                <li key={p.id} className="mt-1">
                  <ul>
                    <ScopeRow
                      active={selected === p.id && project === 'all'}
                      onClick={() => {
                        setSelected(p.id);
                        setProject('all');
                        setOpen(false);
                      }}
                      icon={<ProductMark product={p.id} size="sm" />}
                      label={p.name}
                      trailing={
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${toneDot[healthMeta[p.health].tone]}`}
                          aria-label={healthMeta[p.health].label}
                        />
                      }
                      strong
                    />

                    {items.map((x) => (
                      <ScopeRow
                        key={x.id}
                        inset
                        active={project === x.id}
                        onClick={() => {
                          setProject(x.id);
                          setOpen(false);
                        }}
                        icon={<FolderIcon className="h-3.5 w-3.5 text-subtle" />}
                        label={x.name}
                        trailing={
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${toneDot[projectStatusMeta[x.status].tone]}`}
                            aria-label={projectStatusMeta[x.status].label}
                          />
                        }
                      />
                    ))}
                  </ul>
                </li>
              ))}
              {groups.length === 0 && (
                <li className="px-3 py-6 text-center text-[12px] text-muted">No matches.</li>
              )}
            </ul>
            <p className="border-t border-line bg-sunken/50 px-3 py-1.5 text-[11px] text-subtle">
              Scope applies across the platform. Only products you can access are listed.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ScopeRow({
  active,
  onClick,
  icon,
  label,
  hint,
  trailing,
  inset,
  strong,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  trailing?: React.ReactNode;
  inset?: boolean;
  strong?: boolean;
}) {
  return (
    <li>
      <button
        role="option"
        aria-selected={active}
        onClick={onClick}
        className={`flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-[12.5px] transition-colors duration-100 ${inset ? 'pl-7' : 'pl-2'} ${active ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-sunken'}`}
      >
        {icon}
        <span className="min-w-0 flex-1">
          <span className={`block truncate ${strong ? 'font-semibold' : ''}`}>{label}</span>
          {hint && <span className="block truncate text-[11px] text-subtle">{hint}</span>}
        </span>
        {trailing}
        {active && <CheckIcon className="h-3.5 w-3.5 text-accent" />}
      </button>
    </li>
  );
}
