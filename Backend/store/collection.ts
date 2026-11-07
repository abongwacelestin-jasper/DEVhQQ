/**
 * Persistence seam shared by every backend module (Wave 4 contract).
 *
 * A Collection is a Map keyed by id, so route handlers stay synchronous and
 * read from memory. Every write goes through a pluggable driver:
 *  - `set` / `delete` are persisted automatically,
 *  - an in-place mutation (`row.status = 'done'`) must be followed by
 *    `collection.save(key)` — otherwise it is lost on restart.
 *
 * The default driver is in-memory (tests, smoke, no DATABASE_URL). The data
 * lane (B-DATA) installs the PostgreSQL driver at boot via `setDriver`, and
 * hydrates every registered collection with `hydrateAll()` before the server
 * accepts traffic. Modules never write SQL for their own collections: each
 * registered collection is persisted generically by name.
 */

export interface LoadOptions {
  /** Load only the N most recently written rows (bounded in-memory windows, e.g. sign-ins). */
  limit?: number;
}

/** Health of the persistence layer, for readiness probes and the console. */
export interface PersistenceStatus {
  mode: 'memory' | 'postgres';
  /** Distinct rows waiting to be written. */
  pending: number;
  /** True when the backlog is over the high-water mark: readiness should fail. */
  saturated: boolean;
  /** Consecutive failed flushes (0 = healthy). */
  consecutiveFailures: number;
  lastError?: string;
  lastFlushAt?: string;
}

export interface CollectionDriver {
  /** Called after a row is created, replaced or saved in place. */
  write(collection: string, key: string, value: unknown): void;
  /** Called after a row is removed. */
  remove(collection: string, key: string): void;
  /** Loads every persisted row of a collection (used once at boot). */
  load(collection: string, opts?: LoadOptions): Promise<[string, unknown][]>;
  /** Resolves once every queued write has reached durable storage. */
  flush?(timeoutMs?: number): Promise<void>;
  status?(): PersistenceStatus;
}

const memoryDriver: CollectionDriver = {
  write() {},
  remove() {},
  load: async () => [],
};

export interface CollectionOptions<V> {
  /** Hydrate at most this many rows (most recently written first). */
  hydrateLimit?: number;
  /** Runs after hydration with the loaded rows (e.g. to rebuild a derived index). */
  onHydrate?: (rows: [string, V][]) => void;
}

let driver: CollectionDriver = memoryDriver;
const registry = new Map<string, Collection<unknown>>();

export class Collection<V> extends Map<string, V> {
  readonly collectionName: string;
  /** True while hydrating, so loaded rows are not written straight back. */
  private loading = false;
  private readonly options: CollectionOptions<V>;

  constructor(name: string, options: CollectionOptions<V> = {}) {
    super();
    if (registry.has(name)) throw new Error(`Collection "${name}" registered twice`);
    this.collectionName = name;
    this.options = options;
    registry.set(name, this as Collection<unknown>);
  }

  override set(key: string, value: V): this {
    super.set(key, value);
    if (!this.loading && this.collectionName) driver.write(this.collectionName, key, value);
    return this;
  }

  override delete(key: string): boolean {
    const existed = super.delete(key);
    if (existed) driver.remove(this.collectionName, key);
    return existed;
  }

  /** Persists an in-place mutation of an existing row. No-op for unknown keys. */
  save(key: string): void {
    const value = super.get(key);
    if (value !== undefined) driver.write(this.collectionName, key, value);
  }

  /**
   * Drops a row from memory only; the persisted copy is kept. Used to bound
   * in-memory windows over append-only data (sign-in history).
   */
  evict(key: string): boolean {
    return super.delete(key);
  }

  /** Replaces in-memory contents with persisted rows. Returns the number loaded. */
  async hydrate(): Promise<number> {
    const rows = (await driver.load(this.collectionName, {
      limit: this.options.hydrateLimit,
    })) as [string, V][];
    if (rows.length) {
      this.loading = true;
      try {
        super.clear();
        for (const [k, v] of rows) super.set(k, v);
      } finally {
        this.loading = false;
      }
    }
    this.options.onHydrate?.(rows);
    return rows.length;
  }
}

/** Creates (and registers) a persisted collection. Call once per name, at module load. */
export function createCollection<V>(name: string, options?: CollectionOptions<V>): Collection<V> {
  return new Collection<V>(name, options);
}

export function setDriver(next: CollectionDriver) {
  driver = next;
}

/**
 * Awaits every queued write. Call on graceful shutdown (and in tests before
 * simulating a restart). Resolves immediately for the in-memory driver.
 */
export async function flushPending(timeoutMs?: number): Promise<void> {
  await driver.flush?.(timeoutMs);
}

export function persistenceStatus(): PersistenceStatus {
  return (
    driver.status?.() ?? { mode: 'memory', pending: 0, saturated: false, consecutiveFailures: 0 }
  );
}

export function registeredCollections(): string[] {
  return [...registry.keys()];
}

/** Hydrates every registered collection. Returns rows loaded per collection. */
export async function hydrateAll(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [name, c] of registry) out[name] = await c.hydrate();
  return out;
}
