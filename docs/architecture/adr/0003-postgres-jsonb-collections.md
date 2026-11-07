# 0003. PostgreSQL through JSONB collections behind the `Collection` seam

- **Status:** Accepted. The seam is implemented; the PostgreSQL driver is
  planned for Wave 4 (B-DATA lane).
- **Date:** 2026-11-07 (owner decision: PostgreSQL)

## Context

Every piece of state lives in process memory (`Backend/store/db.ts`, and the
session and JIT-grant maps). A restart loses everything except the audit JSONL
file and backup snapshots. Handlers are synchronous and read from those maps
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
4. The B-DATA lane installs the PostgreSQL driver at boot with `setDriver()`,
   runs migrations, then `hydrateAll()` loads every registered collection
   before the server accepts traffic. Rows are stored generically in one table:
   `documents(collection text, key text, data jsonb, updated_at timestamptz,
   primary key (collection, key))` (or per-collection tables, B-DATA's call).
   Writes are queued and flushed in order. Other lanes never write SQL.

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

> [!NOTE]
> **Planned: Wave 4 (B-DATA).** Not yet in the code: the driver and migration
> runner (`Backend/db/`), `DATABASE_URL` / `DATABASE_SSL`, converting
> `db.*` maps to collections, persisting sessions, sign-ins and JIT grants,
> and loading seed data **only** when `NODE_ENV !== 'production'` **and** the
> database is empty. Today `seed()` runs on every boot, in every environment;
> in production the seeded members get an unusable password hash (`!disabled`)
> but projects, tasks, deployments and incidents are still the demo set.

## References

- `Backend/store/collection.ts`, `Backend/store/db.ts`
- `docs/agents/WAVE4.md` §3 (persistence contract)
