import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';

export interface MultiOption<T extends string> {
  value: T;
  label: string;
  dot?: string;
  count?: number;
}

interface Props<T extends string> {
  label: string;
  options: MultiOption<T>[];
  value: T[];
  onChange: (v: T[]) => void;
  /** Extra classes for the trigger button (e.g. a taller control bar height). */
  className?: string;
}

/** Compact multi-select dropdown: shows the label, or the picked value / count when filtered. */
export function MultiSelect<T extends string>({
  label,
  options,
  value,
  onChange,
  className = 'h-7',
}: Props<T>) {
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

  const toggle = (v: T) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const summary =
    value.length === 0
      ? null
      : value.length === 1
        ? options.find((o) => o.value === value[0])?.label
        : `${value.length}`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`inline-flex w-full items-center justify-between gap-1 whitespace-nowrap rounded-md border px-2 text-[12px] font-medium transition-colors duration-150 ${className} ${value.length ? 'border-accent/40 bg-accent-soft/60 text-accent-ink' : 'border-line bg-white text-ink hover:border-line-strong'}`}
      >
        {label}
        {summary && (
          <span className="rounded bg-white/70 px-1 text-[11px] font-semibold">{summary}</span>
        )}
        <ChevronDownIcon className="h-3 w-3 text-subtle" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-multiselectable="true"
            initial={{ opacity: 0, y: -2, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -2, scale: 0.97 }}
            transition={{ duration: 0.12, ease: [0.23, 1, 0.32, 1] }}
            className="absolute left-0 top-8 z-30 w-52 origin-top-left rounded-lg border border-line bg-white p-1 shadow-pop"
          >
            {options.map((o) => {
              const on = value.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => toggle(o.value)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-ink hover:bg-sunken"
                >
                  <span
                    className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded border ${on ? 'border-ink bg-ink text-white' : 'border-line-strong'}`}
                  >
                    {on && <CheckIcon className="h-2.5 w-2.5" />}
                  </span>
                  {o.dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${o.dot}`} />}
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.count !== undefined && (
                    <span className="text-[11px] tabular-nums text-subtle">{o.count}</span>
                  )}
                </button>
              );
            })}
            {value.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="mt-0.5 w-full rounded-md border-t border-line px-2 py-1.5 text-left text-[11.5px] font-medium text-muted hover:bg-sunken hover:text-ink"
              >
                Clear {label.toLowerCase()}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
