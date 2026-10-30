import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from 'lucide-react';
import { FIRST_YEAR, rangePresets, useDateRange } from '../../contexts/DateRangeContext';
import { NOW, fromInputDate, toInputDate } from '../../utils/date';

type Pane = 'month' | 'presets' | 'custom';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ease = [0.23, 1, 0.32, 1] as const;

/** Global period picker: month/year browser (back to FIRST_YEAR), rolling presets, custom range. */
export function DateRangeMenu() {
  const {
    preset,
    period,
    short,
    label,
    from,
    to,
    setPreset,
    setCustom,
    setMonth,
    setYear,
    step,
    canStepForward,
  } = useDateRange();
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState<Pane>('month');
  const [viewYear, setViewYear] = useState(period?.year ?? NOW.getFullYear());
  const [f, setF] = useState(toInputDate(from));
  const [t, setT] = useState(toInputDate(to));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setViewYear(period?.year ?? NOW.getFullYear());
    setF(
      toInputDate(
        from.getFullYear() < 2001 ? new Date(NOW.getFullYear(), NOW.getMonth(), 1) : from,
      ),
    );
    setT(toInputDate(to.getFullYear() > 2099 ? NOW : to));
    const close = (e: MouseEvent) =>
      ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const nowIdx = NOW.getFullYear() * 12 + NOW.getMonth();
  const done = () => setOpen(false);

  return (
    <div className="relative flex shrink-0 items-center" ref={ref}>
      <div className="inline-flex h-8 items-stretch overflow-hidden rounded-md border border-line bg-white transition-colors duration-150 hover:border-line-strong">
        {period && (
          <button
            onClick={() => step(-1)}
            aria-label={`Previous ${period.kind}`}
            className="grid w-6 place-items-center border-r border-line text-muted hover:bg-sunken hover:text-ink"
          >
            <ChevronLeftIcon className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Date range: ${label}`}
          className="inline-flex max-w-[170px] items-center gap-1.5 px-2 text-[12px] font-medium text-ink"
        >
          <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
          <span className="truncate">
            <span className="sm:hidden">{short}</span>
            <span className="hidden sm:inline">{label}</span>
          </span>
          <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-subtle" />
        </button>
        {period && (
          <button
            onClick={() => step(1)}
            disabled={!canStepForward}
            aria-label={`Next ${period.kind}`}
            className="grid w-6 place-items-center border-l border-line text-muted hover:bg-sunken hover:text-ink disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronRightIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Choose date range"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease }}
            className="absolute right-0 top-10 z-40 w-[264px] origin-top-right rounded-lg border border-line bg-white shadow-pop sm:left-0 sm:right-auto sm:origin-top-left"
          >
            <div className="flex gap-0.5 border-b border-line p-1" role="tablist">
              {(['month', 'presets', 'custom'] as Pane[]).map((p) => (
                <button
                  key={p}
                  role="tab"
                  aria-selected={pane === p}
                  onClick={() => setPane(p)}
                  className={`h-7 flex-1 rounded-md text-[11.5px] font-medium capitalize transition-colors duration-150 ${pane === p ? 'bg-sunken text-ink' : 'text-muted hover:text-ink'}`}
                >
                  {p === 'month' ? 'Month' : p === 'presets' ? 'Quick' : 'Custom'}
                </button>
              ))}
            </div>

            {pane === 'month' && (
              <div className="p-2">
                <div className="mb-1.5 flex items-center">
                  <button
                    onClick={() => setViewYear((y) => Math.max(FIRST_YEAR, y - 1))}
                    disabled={viewYear <= FIRST_YEAR}
                    aria-label="Previous year"
                    className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink disabled:opacity-30"
                  >
                    <ChevronLeftIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => {
                      setYear(viewYear);
                      done();
                    }}
                    className={`h-7 flex-1 rounded-md text-[12.5px] font-semibold tabular-nums hover:bg-sunken ${period?.kind === 'year' && period.year === viewYear ? 'text-accent' : 'text-ink'}`}
                    title={`Whole of ${viewYear}`}
                  >
                    {viewYear}
                  </button>
                  <button
                    onClick={() => setViewYear((y) => Math.min(NOW.getFullYear(), y + 1))}
                    disabled={viewYear >= NOW.getFullYear()}
                    aria-label="Next year"
                    className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink disabled:opacity-30"
                  >
                    <ChevronRightIcon className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {MONTHS.map((m, i) => {
                    const idx = viewYear * 12 + i;
                    const future = idx > nowIdx;
                    const on =
                      period?.kind === 'month' && period.year === viewYear && period.month === i;
                    const current = idx === nowIdx;
                    return (
                      <button
                        key={m}
                        disabled={future}
                        onClick={() => {
                          setMonth(viewYear, i);
                          done();
                        }}
                        aria-pressed={on}
                        className={`relative h-8 rounded-md text-[12px] font-medium transition-colors duration-150 disabled:opacity-30 ${on ? 'bg-ink text-white' : 'text-ink hover:bg-sunken'}`}
                      >
                        {m}
                        {current && !on && (
                          <span
                            className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent"
                            aria-label="current month"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-[10.5px] text-subtle">
                  Click the year for the whole year. Records go back to {FIRST_YEAR}.
                </p>
              </div>
            )}

            {pane === 'presets' && (
              <div className="p-1">
                {rangePresets.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => {
                      setPreset(p.value);
                      done();
                    }}
                    className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[12.5px] text-ink hover:bg-sunken"
                  >
                    <span className="flex-1">{p.label}</span>
                    {preset === p.value && <CheckIcon className="h-3.5 w-3.5 text-accent" />}
                  </button>
                ))}
              </div>
            )}

            {pane === 'custom' && (
              <div className="p-2">
                <div className="grid grid-cols-2 gap-1.5">
                  <label className="text-[10.5px] text-subtle">
                    From
                    <input
                      type="date"
                      min={`${FIRST_YEAR}-01-01`}
                      value={f}
                      onChange={(e) => setF(e.target.value)}
                      className="mt-0.5 h-7 w-full min-w-0 rounded border border-line px-1.5 text-[11.5px] text-ink"
                    />
                  </label>
                  <label className="text-[10.5px] text-subtle">
                    To
                    <input
                      type="date"
                      min={`${FIRST_YEAR}-01-01`}
                      value={t}
                      onChange={(e) => setT(e.target.value)}
                      className="mt-0.5 h-7 w-full min-w-0 rounded border border-line px-1.5 text-[11.5px] text-ink"
                    />
                  </label>
                </div>
                <button
                  disabled={!f || !t}
                  onClick={() => {
                    setCustom(fromInputDate(f), fromInputDate(t));
                    done();
                  }}
                  className="mt-2 h-7 w-full rounded-md bg-ink text-[12px] font-medium text-white hover:bg-ink/90 disabled:opacity-50"
                >
                  Apply range
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
