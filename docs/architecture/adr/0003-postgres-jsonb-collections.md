# 0003. PostgreSQL through JSONB collections behind the `Collection` seam

- **Status:** Accepted, implemented (Wave 4, B-DATA lane).
- **Date:** 2026-11-07 (owner decision: PostgreSQL)

## Context

Before Wave 4 every piece of state lived in process memory
(`Backend/store/db.ts`, and the session and JIT-grant maps), and a restart lost
everything except the audit JSONL file and backup snapshots. Handlers are synchronous and read from those maps
directly, and ten lanes are adding backend modules in parallel. If each lane
wrote its own SQL and its own schema migrations, the merge would be hard and
the handlers would all have to become asynchronous at once.

## Decision

1. **PostgreSQL** is the database (Wave 4 owner decision).
2. Modules persist through one seam, `Backend/store/collection.ts`:

   ```ts
   import { createCollection } from '../store/collection.ts';
   export const channels = createCollection<Channel>('channels'); // unique name, module scope
   channels.set(id, row);                   // persisted
   row.archived = true; channels.save(id);  // in-place mutation → must call save
   channels.delete(id);                     // persisted
   ```

   A `Collection<V>` *is* a `Map<string, V>`; reads stay in memory and
   synchronous. `set`, `delete` and `save` call a pluggable
   `CollectionDriver` (`write`, `remove`, `load`).
3. The default driver is in memory and does nothing, so smoke tests and a
   quick local start need no database.
4. With `DATABASE_URL`, `initPersistence()` (`Backend/db/boot.ts`) runs
   migrations (`Backend/db/migrate.ts`, optionally with a separate DDL role in
   `DATABASE_MIGRATION_URL`), installs the PostgreSQL driver with
   `setDriver()`, then `hydrateAll()` loads every registered collection
   before the server accepts traffic. Rows are stored generically in a
   `documents` table keyed by `(collection, key)` with a JSONB payload.
   Writes are queued and flushed in order. Other modules never write SQL.
5. Demo data is seeded only when `NODE_ENV !== 'production'` **and** the table
   is empty, under an advisory lock.

## Consequences

- Handlers stay synchronous; adding persistence does not ripple through every
  route.
- Forgetting `save(key)` after an in-place mutation loses the change on
  restart. Code review and the B-DATA lane's `.save()` pass over existing
  routes are the guard; there is no automatic dirty tracking.
- The whole dataset must fit in memory, and every instance holds a full copy.
  Running more than one API instance needs a change-notification scheme (the
  event bus and rate limiter are per-process today too).
- JSONB documents give no relational constraints; integrity rules stay in
  handlers. Queries other than "load everything" are not part of the seam.
- Collection names are registered once; registering a name twice throws at
  module load.

- `GET /api/ready` reports the write queue (`persistence.pending`,
  `saturated`) and turns `503` when the database is down or the queue is
  saturated.
- **One backend replica.** Because each process holds its own copy, the
  deployment runs a single backend until cross-instance invalidation exists
  ([Known limits](../../operations/known-limits.md)). Commands that write
  (`bootstrap-owner`) run with the backend stopped.

## References

- `Backend/store/collection.ts`, `Backend/store/db.ts`, `Backend/db/`
- [Storage](../../operations/storage.md)
- `docs/agents/WAVE4.md` §3 (persistence contract)
