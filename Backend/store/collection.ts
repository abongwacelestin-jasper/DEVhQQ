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

export interface CollectionDriver {
  /** Called after a row is created, replaced or saved in place. */
  write(collection: string, key: string, value: unknown): void;
  /** Called after a row is removed. */
  remove(collection: string, key: string): void;
  /** Loads every persisted row of a collection (used once at boot). */
  load(collection: string): Promise<[string, unknown][]>;
}

const memoryDriver: CollectionDriver = {
  write() {},
  remove() {},
  load: async () => [],
};

let driver: CollectionDriver = memoryDriver;
const registry = new Map<string, Collection<unknown>>();

export class Collection<V> extends Map<string, V> {
  readonly collectionName: string;
  /** True while hydrating, so loaded rows are not written straight back. */
  private loading = false;

  constructor(name: string) {
    super();
    if (registry.has(name)) throw new Error(`Collection "${name}" registered twice`);
    this.collectionName = name;
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

  /** Replaces in-memory contents with persisted rows. Returns the number loaded. */
  async hydrate(): Promise<number> {
    const rows = await driver.load(this.collectionName);
    if (!rows.length) return 0;
    this.loading = true;
    try {
      super.clear();
      for (const [k, v] of rows) super.set(k, v as V);
    } finally {
      this.loading = false;
    }
    return rows.length;
  }
}

/** Creates (and registers) a persisted collection. Call once per name, at module load. */
export function createCollection<V>(name: string): Collection<V> {
  return new Collection<V>(name);
}

export function setDriver(next: CollectionDriver) {
  driver = next;
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
