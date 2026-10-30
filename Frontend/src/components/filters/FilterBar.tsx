import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { BookmarkIcon, CheckIcon, PlusIcon, SearchIcon, XIcon } from 'lucide-react';

export interface FilterOption {
  value: string;
  label: string;
}

export interface SelectFilter {
  key: string;
  label: string;
  options: FilterOption[];
}

export interface ToggleFilter {
  key: string;
  label: string;
}

export interface SavedView {
  label: string;
  values: Record<string, string>;
}

interface FilterBarProps {
  /** Unique id used to remember saved views per page. */
  id: string;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onApply: (values: Record<string, string>) => void;
  onReset: () => void;
  activeCount: number;
  count: number;
  noun: string;
  search?: { key: string; placeholder: string };
  selects?: SelectFilter[];
  toggles?: ToggleFilter[];
  presets?: SavedView[];
  trailing?: React.ReactNode;
}

const selectClass = (active: boolean) =>
  `h-7 min-w-0 max-w-[160px] rounded-md border px-1.5 text-[12px] transition-colors duration-150 ${
    active
      ? 'border-accent/50 bg-accent-soft/50 font-medium text-accent-ink'
      : 'border-line bg-white text-ink hover:border-line-strong'
  }`;

export function FilterBar({
  id,
  values,
  onChange,
  onApply,
  onReset,
  activeCount,
  count,
  noun,
  search,
  selects = [],
  toggles = [],
  presets = [],
  trailing,
}: FilterBarProps) {
  const storageKey = `devhq.views.${id}`;
  const [saved, setSaved] = useState<SavedView[]>(() => {
    try {
      const parsed: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]');
      return Array.isArray(parsed)
        ? (parsed.filter(
            (v) => v && typeof v.label === 'string' && v.values && typeof v.values === 'object',
          ) as SavedView[])
        : [];
    } catch {
      return [];
    }
  });
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sessionStorage.setItem(storageKey, JSON.stringify(saved));
  }, [saved, storageKey]);

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

  const views = [...presets, ...saved];
  const isCurrent = (v: SavedView) => {
    const keys = new Set([...Object.keys(v.values), ...Object.keys(values)]);
    return [...keys].every((k) => (v.values[k] ?? '') === (values[k] ?? ''));
  };

  const saveCurrent = (e: React.FormEvent) => {
    e.preventDefault();
    const label = naming.trim();
    if (!label) return;
    const snapshot = Object.fromEntries(Object.entries(values).filter(([, v]) => v));
    setSaved((l) => [...l.filter((x) => x.label !== label), { label, values: snapshot }]);
    setNaming('');
    toast.success(`View “${label}” saved`);
  };

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-white px-2 py-1.5"
      role="search"
      aria-label={`Filter ${noun}`}
    >
      {search && (
        <label className="relative min-w-0 flex-1 basis-40 sm:max-w-[240px]">
          <span className="sr-only">{search.placeholder}</span>
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            value={values[search.key] ?? ''}
            onChange={(e) => onChange(search.key, e.target.value)}
            placeholder={search.placeholder}
            className="h-7 w-full rounded-md border border-line bg-white pl-7 pr-2 text-[12px] text-ink outline-none placeholder:text-subtle focus:border-accent"
          />
        </label>
      )}
      {selects.map((s) => (
        <select
          key={s.key}
          aria-label={s.label}
          value={values[s.key] ?? ''}
          onChange={(e) => onChange(s.key, e.target.value)}
          className={selectClass(!!values[s.key])}
        >
          <option value="">{s.label}: all</option>
          {s.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ))}
      {toggles.map((t) => {
        const on = values[t.key] === '1';
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key, on ? '' : '1')}
            aria-pressed={on}
            className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[12px] font-medium transition-colors duration-150 ${
              on
                ? 'border-accent/50 bg-accent-soft/50 text-accent-ink'
                : 'border-line text-ink hover:border-line-strong'
            }`}
          >
            {on && <CheckIcon className="h-3 w-3" />}
            {t.label}
          </button>
        );
      })}
      {activeCount > 0 && (
        <button
          onClick={onReset}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-muted hover:bg-sunken hover:text-ink"
        >
          <XIcon className="h-3.5 w-3.5" /> Clear {activeCount}
        </button>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        {trailing}
        <span className="whitespace-nowrap text-[11.5px] tabular-nums text-muted">
          {count} {noun}
        </span>
        <div className="relative" ref={ref}>
          <button
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={open}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] font-medium text-ink hover:border-line-strong"
          >
            <BookmarkIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Views</span>
          </button>
          <AnimatePresence>
            {open && (
              <motion.div
                role="menu"
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
                className="absolute right-0 top-9 z-40 w-60 origin-top-right rounded-lg border border-line bg-white p-1 shadow-pop"
              >
                <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold text-muted">Saved views</p>
                {views.length === 0 && (
                  <p className="px-2 py-1.5 text-[12px] text-muted">No saved views yet.</p>
                )}
                {views.map((v) => (
                  <div key={v.label} className="group flex items-center rounded-md hover:bg-sunken">
                    <button
                      role="menuitem"
                      onClick={() => {
                        onApply(v.values);
                        setOpen(false);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-[12.5px] text-ink"
                    >
                      <span className="min-w-0 flex-1 truncate">{v.label}</span>
                      {isCurrent(v) && <CheckIcon className="h-3.5 w-3.5 text-accent" />}
                    </button>
                    {saved.some((s) => s.label === v.label) && (
                      <button
                        onClick={() => setSaved((l) => l.filter((s) => s.label !== v.label))}
                        className="mr-1 rounded p-1 text-muted opacity-0 hover:text-bad group-hover:opacity-100"
                        aria-label={`Delete view ${v.label}`}
                      >
                        <XIcon className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
                <form
                  onSubmit={saveCurrent}
                  className="mt-1 flex items-center gap-1 border-t border-line px-1 pt-1.5"
                >
                  <input
                    value={naming}
                    onChange={(e) => setNaming(e.target.value)}
                    placeholder="Save current as…"
                    aria-label="View name"
                    className="h-7 min-w-0 flex-1 rounded border border-line px-2 text-[12px] outline-none focus:border-accent"
                  />
                  <button
                    type="submit"
                    disabled={!naming.trim()}
                    className="rounded bg-ink p-1.5 text-white disabled:opacity-40"
                    aria-label="Save view"
                  >
                    <PlusIcon className="h-3.5 w-3.5" />
                  </button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
