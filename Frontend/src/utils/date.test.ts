import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NOW,
  addDays,
  daysBetween,
  endOfDay,
  formatDateTime,
  formatDay,
  formatDayHeading,
  formatTime,
  fromInputDate,
  nowISO,
  parseWhen,
  relative,
  startOfDay,
  toInputDate,
} from './date';

const at = (mo: number, d: number, h = 0, mi = 0) => new Date(2026, mo, d, h, mi);
const MIN = 60_000;

describe('NOW', () => {
  it('is the simulated workspace clock: Friday Oct 23 2026, 15:30 local', () => {
    expect(NOW.getDay()).toBe(5);
    expect(NOW).toEqual(at(9, 23, 15, 30));
  });
});

describe('day helpers', () => {
  it('startOfDay / endOfDay bracket the same calendar day', () => {
    const d = at(9, 23, 15, 30);
    expect(startOfDay(d)).toEqual(at(9, 23));
    expect(endOfDay(d)).toEqual(new Date(2026, 9, 23, 23, 59, 59, 999));
  });

  it('addDays moves by whole days in both directions', () => {
    expect(addDays(NOW, 2).getTime() - NOW.getTime()).toBe(2 * 86_400_000);
    expect(addDays(NOW, -1).getTime() - NOW.getTime()).toBe(-86_400_000);
  });

  it('daysBetween counts calendar days regardless of time of day', () => {
    expect(daysBetween(at(9, 20, 23, 59), at(9, 23, 0, 1))).toBe(3);
    expect(daysBetween(at(9, 23), at(9, 20))).toBe(-3);
    expect(daysBetween(NOW, NOW)).toBe(0);
  });

  it('toInputDate and fromInputDate round-trip every day of the year', () => {
    for (let i = 0; i < 366; i++) {
      const d = startOfDay(addDays(new Date(2026, 0, 1, 12), i));
      const s = toInputDate(d);
      expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(fromInputDate(s)).toEqual(d);
    }
  });
});

describe('formatting', () => {
  it('formats day, time and both', () => {
    expect(formatDay(at(0, 5))).toBe('Jan 5');
    expect(formatTime(at(0, 5, 7, 3))).toBe('07:03');
    expect(formatDateTime(at(11, 31, 23, 59))).toBe('Dec 31, 23:59');
  });

  it('formatDayHeading names the days around NOW', () => {
    expect(formatDayHeading(at(9, 23, 1))).toBe('Today');
    expect(formatDayHeading(at(9, 22, 23))).toBe('Yesterday');
    expect(formatDayHeading(at(9, 24, 9))).toBe('Tomorrow');
    expect(formatDayHeading(at(9, 19))).toBe('Mon, Oct 19');
  });

  it('relative() uses minutes, hours, days, then a date', () => {
    expect(relative(new Date(NOW.getTime() - 20_000))).toBe('just now');
    expect(relative(new Date(NOW.getTime() - 5 * MIN))).toBe('5m ago');
    expect(relative(new Date(NOW.getTime() - 3 * 60 * MIN))).toBe('3h ago');
    expect(relative(addDays(NOW, -2))).toBe('2d ago');
    expect(relative(addDays(NOW, -13))).toBe('13d ago');
    expect(relative(addDays(NOW, -20))).toBe(formatDay(addDays(NOW, -20)));
    expect(relative(new Date(NOW.getTime() + 5 * MIN))).toBe('in 5m');
    expect(relative(addDays(NOW, 3))).toBe('in 3d');
  });
});

describe('parseWhen', () => {
  it.each([
    ['', NOW],
    ['—', NOW],
    ['now', NOW],
    ['Now', NOW],
    ['just now', NOW],
    ['nonsense', NOW],
  ])('%j resolves to NOW', (input, expected) => {
    expect(parseWhen(input)).toEqual(expected);
  });

  it.each([
    ['12m', 12 * MIN],
    ['3h ago', 3 * 60 * MIN],
    ['2d', 2 * 1440 * MIN],
    ['1w ago', 7 * 1440 * MIN],
  ])('relative %s', (input, back) => {
    expect(NOW.getTime() - parseWhen(input).getTime()).toBe(back);
  });

  it('parses Today / Yesterday with a time', () => {
    expect(parseWhen('Today 08:02')).toEqual(at(9, 23, 8, 2));
    expect(parseWhen('Yesterday 17:00')).toEqual(at(9, 22, 17, 0));
    expect(parseWhen('Today')).toEqual(at(9, 23));
  });

  it('resolves weekday names to the most recent past occurrence (never today)', () => {
    expect(parseWhen('Mon 16:10')).toEqual(at(9, 19, 16, 10));
    expect(parseWhen('Thu')).toEqual(at(9, 22));
    expect(parseWhen('Sat')).toEqual(at(9, 17));
    expect(parseWhen('Fri 09:00')).toEqual(at(9, 16, 9, 0));
  });

  it('parses month-day forms with an optional time', () => {
    expect(parseWhen('Oct 21')).toEqual(at(9, 21));
    expect(parseWhen('Oct 21, 14:05')).toEqual(at(9, 21, 14, 5));
    expect(parseWhen('Sep 3 09:30')).toEqual(at(8, 3, 9, 30));
  });

  it('passes ISO timestamps through', () => {
    expect(parseWhen('2026-10-21T10:00:00Z').toISOString()).toBe('2026-10-21T10:00:00.000Z');
  });
});

describe('nowISO', () => {
  afterEach(() => vi.useRealTimers());

  it('pins the date to NOW and never goes earlier than 15:00 on that day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2030, 0, 1, 9, 41, 7));
    expect(new Date(nowISO())).toEqual(new Date(2026, 9, 23, 15, 41, 7));
    vi.setSystemTime(new Date(2030, 0, 1, 18, 2, 3));
    expect(new Date(nowISO())).toEqual(new Date(2026, 9, 23, 18, 2, 3));
  });
});
