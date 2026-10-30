/**
 * Allow-list input validation.
 *
 * Every request body is parsed against an explicit schema before a handler
 * touches it. Unknown keys are rejected (not silently dropped) so clients
 * can't smuggle fields like `role: "Owner"` into an update.
 *
 * Output encoding is handled by JSON serialization; the frontend renders text
 * through React (escaped by default). Docs markdown is rendered by a
 * line-based renderer that never injects raw HTML.
 */

import { HttpError } from '../types.ts';

type Check<T> = (v: unknown, path: string) => T;

export const v = {
  string(
    opts: { min?: number; max?: number; pattern?: RegExp; trim?: boolean } = {},
  ): Check<string> {
    return (val, path) => {
      if (typeof val !== 'string') throw invalid(path, 'must be a string');
      const s = opts.trim === false ? val : val.trim();
      if (opts.min !== undefined && s.length < opts.min)
        throw invalid(path, `must be at least ${opts.min} characters`);
      if (s.length > (opts.max ?? 10_000))
        throw invalid(path, `must be at most ${opts.max ?? 10_000} characters`);
      if (opts.pattern && !opts.pattern.test(s)) throw invalid(path, 'has an invalid format');
      return s;
    };
  },
  email(): Check<string> {
    return (val, path) =>
      v
        .string({ max: 254, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/ })(val, path)
        .toLowerCase();
  },
  enumOf<T extends string>(values: readonly T[]): Check<T> {
    return (val, path) => {
      if (typeof val !== 'string' || !values.includes(val as T))
        throw invalid(path, `must be one of ${values.join(', ')}`);
      return val as T;
    };
  },
  boolean(): Check<boolean> {
    return (val, path) => {
      if (typeof val !== 'boolean') throw invalid(path, 'must be a boolean');
      return val;
    };
  },
  int(opts: { min?: number; max?: number } = {}): Check<number> {
    return (val, path) => {
      if (typeof val !== 'number' || !Number.isInteger(val))
        throw invalid(path, 'must be an integer');
      if (opts.min !== undefined && val < opts.min) throw invalid(path, `must be ≥ ${opts.min}`);
      if (opts.max !== undefined && val > opts.max) throw invalid(path, `must be ≤ ${opts.max}`);
      return val;
    };
  },
  array<T>(item: Check<T>, opts: { max?: number } = {}): Check<T[]> {
    return (val, path) => {
      if (!Array.isArray(val)) throw invalid(path, 'must be an array');
      if (val.length > (opts.max ?? 100))
        throw invalid(path, `must have at most ${opts.max ?? 100} items`);
      return val.map((x, i) => item(x, `${path}[${i}]`));
    };
  },
  optional<T>(check: Check<T>): Check<T | undefined> {
    return (val, path) => (val === undefined ? undefined : check(val, path));
  },
  object<S extends Record<string, Check<unknown>>>(
    shape: S,
  ): Check<{ [K in keyof S]: ReturnType<S[K]> }> {
    return (val, path) => {
      if (!val || typeof val !== 'object' || Array.isArray(val))
        throw invalid(path || 'body', 'must be an object');
      const extra = Object.keys(val).filter((k) => !(k in shape));
      if (extra.length) throw invalid(path || 'body', `has unknown field(s): ${extra.join(', ')}`);
      const out: Record<string, unknown> = {};
      for (const [k, check] of Object.entries(shape))
        out[k] = check((val as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
      return out as { [K in keyof S]: ReturnType<S[K]> };
    };
  },
};

export function parse<T>(check: Check<T>, input: unknown): T {
  return check(input, '');
}

function invalid(path: string, msg: string) {
  return new HttpError(422, 'validation_failed', `${path} ${msg}`);
}

/**
 * Prompt-injection hygiene for text forwarded to an LLM (assistant features).
 * This is defence-in-depth, not a guarantee: the model call must still run
 * with least-privilege tools and its output must be treated as untrusted.
 */
export function sanitizeForPrompt(input: string, maxLen = 4_000): string {
  return (
    input
      .slice(0, maxLen)
      // Stripping raw control characters and bidi overrides is the point here, so
      // no-control-regex is deliberately not applied to this one expression.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u202A-\u202E\u2066-\u2069]/g, '')
      .replace(/<\/?(system|assistant|tool|instructions?)>/gi, '') // fake role delimiters
      .replace(/```/g, 'ʼʼʼ')
  ); // stop users closing our fenced context block
}
