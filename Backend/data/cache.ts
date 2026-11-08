/**
 * Read cache contract for the repositories (ADR 0011, "Caching").
 *
 * Phase 1 ships with **no cache**: every read goes to PostgreSQL, so every
 * replica sees every committed write immediately. The interface exists so a
 * shared cache (Redis, owned by the Redis lane in lib/redis.ts) can be slotted
 * in later without touching a route:
 *
 *   import { setReadCache } from './data/cache.ts';
 *   setReadCache(redisCacheStore);   // implements CacheStore
 *
 * Rules for any implementation:
 *  - It must be shared by every replica (a per-process cache would serve
 *    another replica's stale rows), so the in-process `MemoryCacheStore`
 *    here is for tests and single-process development only.
 *  - Entries are short-lived (seconds). Writers delete the key after the
 *    database commit (`invalidate`), so the TTL only bounds the damage of a
 *    lost invalidation.
 *  - Values are JSON. Secrets are never cached: the repositories only cache
 *    projections without credentials (see data/members.ts → `cachedName`).
 */

export interface CacheStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  del(keys: string[]): Promise<void>;
}

export const noCache: CacheStore = {
  get: async () => undefined,
  set: async () => {},
  del: async () => {},
};

/** Single-process TTL cache (tests, local development). Not safe across replicas. */
export class MemoryCacheStore implements CacheStore {
  private readonly rows = new Map<string, { value: string; expires: number }>();

  async get(key: string) {
    const r = this.rows.get(key);
    if (!r) return undefined;
    if (r.expires <= Date.now()) {
      this.rows.delete(key);
      return undefined;
    }
    return r.value;
  }

  async set(key: string, value: string, ttlMs: number) {
    this.rows.set(key, { value, expires: Date.now() + ttlMs });
  }

  async del(keys: string[]) {
    for (const k of keys) this.rows.delete(k);
  }
}

let cache: CacheStore = noCache;

export function setReadCache(next: CacheStore) {
  cache = next;
}

export function readCache(): CacheStore {
  return cache;
}

/**
 * Read-through: returns the cached JSON value or loads, stores and returns it.
 * A cache failure never fails the read; it falls back to the loader.
 */
export async function readThrough<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T | undefined>,
): Promise<T | undefined> {
  const c = cache;
  if (c !== noCache) {
    try {
      const hit = await c.get(key);
      if (hit !== undefined) return JSON.parse(hit) as T;
    } catch {
      // fall back to the database
    }
  }
  const value = await load();
  if (value !== undefined && c !== noCache)
    await c.set(key, JSON.stringify(value), ttlMs).catch(() => undefined);
  return value;
}

/** Drops keys after a committed write. Best effort: the TTL bounds a lost invalidation. */
export async function invalidate(keys: string[]) {
  if (cache === noCache || keys.length === 0) return;
  await cache.del(keys).catch(() => undefined);
}
