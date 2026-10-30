/** The workspace's simulated "now": Friday Oct 23, 2026. All relative times resolve against this. */
export const NOW = new Date(2026, 9, 23, 15, 30);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_MS = 86_400_000;

export function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export function addDays(d: Date, n: number) {
  return new Date(d.getTime() + n * DAY_MS);
}

function withTime(d: Date, hhmm?: string) {
  if (!hhmm) return d;
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
}

/** Parses the loose time strings used in sample data: "now", "12m", "3h ago", "2d", "Today 08:02", "Mon 16:10", "Oct 21", "Oct 21, 14:05" or ISO. */
export function parseWhen(input: string): Date {
  const s = input.trim().replace(/\s+ago$/, '');
  if (!s || s === '—') return NOW;
  if (s === 'now' || s === 'Now' || s === 'just now') return NOW;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s);
  const rel = s.match(/^(\d+)\s*(m|h|d|w)$/);
  if (rel) {
    const n = Number(rel[1]);
    const unit = { m: 60_000, h: 3_600_000, d: DAY_MS, w: DAY_MS * 7 }[
      rel[2] as 'm' | 'h' | 'd' | 'w'
    ];
    return new Date(NOW.getTime() - n * unit);
  }
  const [word, time] = s.split(/,?\s+(?=\d{1,2}:\d{2}$)/);
  if (word === 'Today') return withTime(startOfDay(NOW), time);
  if (word === 'Yesterday') return withTime(startOfDay(addDays(NOW, -1)), time);
  const dow = DAYS.indexOf(word);
  if (dow >= 0) {
    let diff = NOW.getDay() - dow;
    if (diff <= 0) diff += 7;
    return withTime(startOfDay(addDays(NOW, -diff)), time);
  }
  const md = word.match(/^([A-Z][a-z]{2})\s+(\d{1,2})$/);
  if (md) return withTime(new Date(NOW.getFullYear(), MONTHS.indexOf(md[1]), Number(md[2])), time);
  return NOW;
}

export function formatDay(d: Date) {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function formatTime(d: Date) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatDateTime(d: Date) {
  return `${formatDay(d)}, ${formatTime(d)}`;
}

/** "Today", "Yesterday", "Mon, Oct 19" */
export function formatDayHeading(d: Date) {
  const diff = Math.round((startOfDay(NOW).getTime() - startOfDay(d).getTime()) / DAY_MS);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff === -1) return 'Tomorrow';
  return `${DAYS[d.getDay()]}, ${formatDay(d)}`;
}

export function relative(d: Date) {
  const ms = NOW.getTime() - d.getTime();
  const future = ms < 0;
  const abs = Math.abs(ms);
  const m = Math.round(abs / 60_000);
  let out: string;
  if (m < 1) return 'just now';
  if (m < 60) out = `${m}m`;
  else if (m < 60 * 24) out = `${Math.round(m / 60)}h`;
  else if (m < 60 * 24 * 14) out = `${Math.round(m / 1440)}d`;
  else return formatDay(d);
  return future ? `in ${out}` : `${out} ago`;
}

export function toInputDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fromInputDate(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function daysBetween(a: Date, b: Date) {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS);
}

/** Simulated current timestamp: workspace date + the real wall-clock time, so new records sort to the top. */
export function nowISO() {
  const real = new Date();
  return new Date(
    NOW.getFullYear(),
    NOW.getMonth(),
    NOW.getDate(),
    Math.max(real.getHours(), 15),
    real.getMinutes(),
    real.getSeconds(),
  ).toISOString();
}
