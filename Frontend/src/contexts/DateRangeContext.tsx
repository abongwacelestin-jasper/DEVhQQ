import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { NOW, addDays, endOfDay, formatDay, startOfDay } from '../utils/date';

export type RangePreset =
  'month' | 'today' | '7d' | '30d' | '90d' | 'year' | 'next14' | 'all' | 'custom';

export const rangePresets: {
  value: Exclude<RangePreset, 'custom'>;
  label: string;
  short: string;
}[] = [
  { value: 'month', label: 'This month', short: 'This month' },
  { value: 'today', label: 'Today', short: 'Today' },
  { value: '7d', label: 'Last 7 days', short: '7d' },
  { value: '30d', label: 'Last 30 days', short: '30d' },
  { value: '90d', label: 'Last 90 days', short: '90d' },
  { value: 'year', label: 'This year', short: 'This year' },
  { value: 'next14', label: 'Next 14 days', short: 'Next 14d' },
  { value: 'all', label: 'All time', short: 'All time' },
];

/** A whole calendar period the range is pinned to, so it can be stepped back and forward. */
export type Period =
  { kind: 'month'; year: number; month: number } | { kind: 'year'; year: number };

interface DateRangeValue {
  preset: RangePreset;
  period: Period | null;
  from: Date;
  to: Date;
  label: string;
  short: string;
  setPreset: (p: Exclude<RangePreset, 'custom'>) => void;
  setCustom: (from: Date, to: Date) => void;
  setMonth: (year: number, month: number) => void;
  setYear: (year: number) => void;
  /** Step a month/year period by ±1. No-op for rolling ranges. */
  step: (dir: -1 | 1) => void;
  canStepForward: boolean;
  inRange: (d: Date) => boolean;
}

const DateRangeContext = createContext<DateRangeValue | null>(null);
const KEY = 'devhq.dateRange';
/** Earliest year records can be browsed back to. */
export const FIRST_YEAR = 2019;

const monthBounds = (y: number, m: number): [Date, Date] => [
  new Date(y, m, 1),
  endOfDay(new Date(y, m + 1, 0)),
];
const yearBounds = (y: number): [Date, Date] => [new Date(y, 0, 1), endOfDay(new Date(y, 11, 31))];
const monthName = (y: number, m: number, style: 'long' | 'short' = 'long') =>
  new Date(y, m, 1).toLocaleDateString('en-US', { month: style, year: 'numeric' });

function boundsFor(p: Exclude<RangePreset, 'custom'>): [Date, Date] {
  const today = startOfDay(NOW);
  switch (p) {
    case 'month':
      return monthBounds(NOW.getFullYear(), NOW.getMonth());
    case 'today':
      return [today, endOfDay(NOW)];
    case '7d':
      return [addDays(today, -6), endOfDay(NOW)];
    case '30d':
      return [addDays(today, -29), endOfDay(NOW)];
    case '90d':
      return [addDays(today, -89), endOfDay(NOW)];
    case 'year':
      return yearBounds(NOW.getFullYear());
    case 'next14':
      return [today, endOfDay(addDays(NOW, 14))];
    case 'all':
      return [new Date(2000, 0, 1), new Date(2100, 0, 1)];
  }
}

interface Stored {
  preset: RangePreset;
  from: number;
  to: number;
  period: Period | null;
}

function initial(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Stored;
  } catch {
    /* ignore */
  }
  const [f, t] = boundsFor('month');
  return {
    preset: 'month',
    from: +f,
    to: +t,
    period: { kind: 'month', year: NOW.getFullYear(), month: NOW.getMonth() },
  };
}

export function DateRangeProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Stored>(initial);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);

  const setMonth = useCallback((year: number, month: number) => {
    const [f, t] = monthBounds(year, month);
    const isNow = year === NOW.getFullYear() && month === NOW.getMonth();
    setState({
      preset: isNow ? 'month' : 'custom',
      from: +f,
      to: +t,
      period: { kind: 'month', year, month },
    });
  }, []);

  const setYear = useCallback((year: number) => {
    const [f, t] = yearBounds(year);
    setState({
      preset: year === NOW.getFullYear() ? 'year' : 'custom',
      from: +f,
      to: +t,
      period: { kind: 'year', year },
    });
  }, []);

  const setPreset = useCallback(
    (p: Exclude<RangePreset, 'custom'>) => {
      if (p === 'month') return setMonth(NOW.getFullYear(), NOW.getMonth());
      if (p === 'year') return setYear(NOW.getFullYear());
      const [f, t] = boundsFor(p);
      setState({ preset: p, from: +f, to: +t, period: null });
    },
    [setMonth, setYear],
  );

  const setCustom = useCallback((f: Date, t: Date) => {
    const [a, b] = f <= t ? [startOfDay(f), endOfDay(t)] : [startOfDay(t), endOfDay(f)];
    setState({ preset: 'custom', from: +a, to: +b, period: null });
  }, []);

  const { period } = state;
  const canStepForward =
    !!period &&
    (period.kind === 'year'
      ? period.year < NOW.getFullYear()
      : period.year * 12 + period.month < NOW.getFullYear() * 12 + NOW.getMonth());

  const step = useCallback(
    (dir: -1 | 1) => {
      if (!period) return;
      if (period.kind === 'year') return setYear(Math.max(FIRST_YEAR, period.year + dir));
      const idx = period.year * 12 + period.month + dir;
      const y = Math.floor(idx / 12);
      if (y < FIRST_YEAR) return;
      setMonth(y, idx % 12);
    },
    [period, setMonth, setYear],
  );

  const from = useMemo(() => new Date(state.from), [state.from]);
  const to = useMemo(() => new Date(state.to), [state.to]);
  const inRange = useCallback((d: Date) => d >= from && d <= to, [from, to]);

  const value = useMemo<DateRangeValue>(() => {
    let label: string;
    let short: string;
    if (period?.kind === 'month') {
      label = monthName(period.year, period.month);
      short = monthName(period.year, period.month, 'short');
    } else if (period?.kind === 'year') {
      label = short = String(period.year);
    } else {
      const meta = rangePresets.find((r) => r.value === state.preset);
      const custom = `${formatDay(from)} – ${formatDay(to)}`;
      label = meta?.label ?? custom;
      short = meta?.short ?? custom;
    }
    return {
      preset: state.preset,
      period,
      from,
      to,
      label,
      short,
      setPreset,
      setCustom,
      setMonth,
      setYear,
      step,
      canStepForward,
      inRange,
    };
  }, [
    state.preset,
    period,
    from,
    to,
    setPreset,
    setCustom,
    setMonth,
    setYear,
    step,
    canStepForward,
    inRange,
  ]);

  return <DateRangeContext.Provider value={value}>{children}</DateRangeContext.Provider>;
}

export function useDateRange() {
  const ctx = useContext(DateRangeContext);
  if (!ctx) throw new Error('useDateRange must be used inside DateRangeProvider');
  return ctx;
}
