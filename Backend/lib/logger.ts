/**
 * Structured JSON logger.
 *
 * One JSON object per line, ready for any log pipeline. Secrets are redacted
 * by key name before anything is written, so a careless `logger.info(body)`
 * can't leak a password or token into log storage.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = order[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? 20;
const SECRET_KEYS = /pass(word)?|secret|token|authorization|cookie|signature|code|totp/i;

/** Ring buffer so the console can show recent logs without a log backend. */
const recent: Record<string, unknown>[] = [];
const MAX_RECENT = 500;

function redact(v: unknown, depth = 0): unknown {
  if (depth > 4 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>).map(([k, val]) => [
      k,
      SECRET_KEYS.test(k) ? '[redacted]' : redact(val, depth + 1),
    ]),
  );
}

function write(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (order[level] < threshold) return;
  const line = {
    t: new Date().toISOString(),
    level,
    msg,
    ...(redact(fields) as Record<string, unknown>),
  };
  recent.push(line);
  if (recent.length > MAX_RECENT) recent.shift();
  const out = JSON.stringify(line);
  if (level === 'error' || level === 'warn') process.stderr.write(out + '\n');
  else process.stdout.write(out + '\n');
}

export const logger = {
  debug: (m: string, f?: Record<string, unknown>) => write('debug', m, f),
  info: (m: string, f?: Record<string, unknown>) => write('info', m, f),
  warn: (m: string, f?: Record<string, unknown>) => write('warn', m, f),
  error: (m: string, f?: Record<string, unknown>) => write('error', m, f),
  recent: (opts: { level?: Level; limit?: number } = {}) =>
    recent
      .filter((l) => !opts.level || order[l.level as Level] >= order[opts.level])
      .slice(-(opts.limit ?? 200))
      .reverse(),
};
