# 0011. Move to relational PostgreSQL tables, queried on demand

- **Status:** Accepted. Phase 1 implemented (members, sessions, tasks, task
  events, task comments, notifications). Phases 2–4 proposed.
- **Date:** 2026-11-08
- **Deciders:** owner (start the full data-layer migration now), data-layer lane
- **Supersedes (in part):** [ADR 0003](0003-postgres-jsonb-collections.md),
  for the collections listed under "Phase 1". ADR 0003 still governs every
  other collection until its phase lands.

## Context

[ADR 0003](0003-postgres-jsonb-collections.md) put every collection in one
generic JSONB `documents` table behind `store/collection.ts`. Each process
loads every row into a `Map` at boot, serves reads from memory and writes
behind to PostgreSQL. That kept handlers synchronous, but it has three
consequences that block growth:

1. **One replica only.** Two processes never see each other's writes. A
   session created on replica A is unknown to replica B, a revocation on A is
   ignored by B, and B overwrites A's rows with its stale copy
   ([Known limits](../../operations/known-limits.md#run-exactly-one-backend-replica)).
2. **The dataset must fit in RAM**, once per process, and boot time grows with
   it (every row is hydrated before the first request).
3. **No relational integrity and no queries.** Every filter is a scan over a
   `Map`; constraints (unique email, a task's assignee exists) live only in
   handlers, and races between handlers are not caught.

Redis now carries the stateless shared runtime (rate limits, event fan-out,
job leases; [ADR 0009](0009-redis-for-shared-runtime-state.md)). The
remaining blocker for more than one replica is the data.

## Decision

### Target model

- **Typed tables**, one per aggregate, with real columns for everything that
  is filtered, joined, ordered or constrained, and JSONB only for nested value
  objects (a member's `profile`, `passkeys`, `backupCodes`). Every table has an
  `extra jsonb` column for fields a newer build wrote that this schema has no
  column for, so a row never loses data on a round trip through an older
  build.
- **Keys and integrity in the database**: primary keys, unique indexes
  (`members (org_id, lower(email))`, the invite-token hash), foreign keys
  (sessions, tasks, notifications → members; task events and comments → tasks,
  `ON DELETE CASCADE`).
- **An org/tenant key on every row** (`org_id`, `'default'` today), leading
  every primary key and index, so the tables can be sharded or distributed by
  organisation (Citus, or one database per tenant group) without rekeying.
- **Partitioning for append-heavy tables**: `task_events` and
  `notifications` are range-partitioned by month on their timestamp, with a
  `DEFAULT` partition so an insert never fails for want of a partition.
  `devhq_ensure_monthly_partitions()` creates months ahead; `npm run migrate`
  and boot call it through the DDL role. Messages and sign-ins get the same
  treatment when they move (phase 2/3). Old partitions can then be detached
  and archived instead of deleted row by row.
- **Insertion order is explicit** (`seq` from a sequence) wherever the old
  `Map` order was visible on the wire, so `ORDER BY due, seq` returns exactly
  what a stable sort over the `Map` did.

The phase 1 schema is `Backend/db/migrations/003_relational_core.sql`.

### Repository interface

`Backend/data/` holds one repository per aggregate, reached through a single
holder:

```ts
import { repos } from '../data/index.ts';
const m = await repos.members.get(id);        // a copy, not a shared object
m.status = 'deactivated';
await repos.members.put(m);                    // writes the changed fields only
```

- **Async, query on demand.** Nothing is cached in the process. Every call
  reads committed state, so a write through one replica is visible to the
  next request on any other replica.
- **Two implementations of every repository**: in memory (tests, smoke, local
  development without `DATABASE_URL`) and PostgreSQL. `db/boot.ts` installs
  the PostgreSQL ones. Both hand out copies, so code that mutates a row
  without writing it back fails in the tests, not only in production. A
  shared contract test (`test/unit/repositories.test.ts`) runs against both
  (`npm run test:pg` for the PostgreSQL run).
- **Field-level writes.** A repository remembers each row it hands out; `put`
  writes only the fields that changed since the read. Writers of different
  fields on different replicas never undo each other (a passkey sign-in cannot
  resurrect a member an Owner just deactivated). Writers of the same field are
  last-writer-wins.
- **Atomic read-modify-write** where a counter or a single-use secret is
  involved: `members.update(id, fn)` locks the row (`SELECT … FOR UPDATE`)
  while `fn` runs. Failed-sign-in counting and backup-code burns use it, so
  two replicas never lose an increment or accept the same code twice.
- **Allocation by the database**: a new member id is inserted and retried on
  conflict (the unique email index decides duplicates, `409`); task keys come
  from an atomic per-prefix counter (`task_key_counters`).
- **Pagination with keyset cursors.** `page()` returns `{ items, nextCursor }`
  with an opaque cursor over the sort key (`(due, seq)` for tasks, `seq` for
  members, the sortable id for notifications, which the API already exposed as
  `before`). Offset paging stays only where the public API already has it
  (`GET /api/tasks?limit&offset`), to keep wire shapes identical.

### Sessions

Sessions are stored in PostgreSQL (`sessions` table), next to the members
they belong to: durable, auditable and joined by foreign key, with no extra
component. The store implements the shared `SessionStore` contract of
`Backend/auth/sessionStore.ts` (the Redis lane's seam), plus three admin
reads the console needs (`listAll`, `count`, `deleteCreatedBefore`,
`AdminSessionStore` in `data/sessions.ts`). Revocation deletes the row, so the
next lookup on every replica fails. Records stay keyed by SHA-256 of the
token's random id; neither the token nor the raw id is stored.

If session lookups become the hot path (one indexed read per request today),
`RedisSessionStore` from the same file is the drop-in: give it the three admin
reads (SCAN over the member index) and install it as `repos.sessions`.
`auth/sessions.ts` does not change.

### Caching

**None in phase 1.** Correctness across replicas comes first and every read is
a primary-key or indexed lookup. `data/cache.ts` defines the contract for
later: a `CacheStore` (`get`, `set` with TTL, `del`), `readThrough(key, ttl,
load)` and `invalidate(keys)` after commit. Rules: the store must be shared
by every replica (Redis; the in-process `MemoryCacheStore` is for tests),
TTLs are seconds so they only bound a lost invalidation, and credentials are
never cached. Nothing calls it yet; the Redis lane can implement `CacheStore`
over `lib/redis.ts` and `setReadCache()` it at boot without touching a route.

### Consistency across replicas

- Every request reads committed state from PostgreSQL (`READ COMMITTED`).
  There is no per-process copy of migrated data to go stale.
- Uniqueness, foreign keys and allocation are enforced by the database, not by
  a prior read in the handler.
- Concurrent writers of a row merge at field level; counters and single-use
  secrets use row locks.
- Each request's writes are individual statements, not one transaction (for
  example a task and its "created" event). A crash between them leaves the
  task without that event; phase 2 wraps multi-row writes in a unit of work.
- Domain observers (a task assignment notifying the assignee) run on the
  replica that handled the write. Events fanned out from other replicas by
  Redis must not run them again; the duplicate-collapse in `notify()` (one
  unread notification per member, kind and reference) absorbs a rare race but
  is not a constraint (a unique index cannot include the partition key here).
- The realtime hub and `/api/_events` re-check a member's role and status
  from the repository on every heartbeat (15 s) and immediately when the same
  process changes the member, instead of on every event.

### Migration plan, collection by collection

Each collection moves through four steps. Phase 1 has done steps 1–3 for its
collections; step 4 is deliberately later.

1. **Dual-write.** The repositories write the table and also enqueue the same
   row into `documents` through the existing write-behind driver
   (`DATA_DUAL_WRITE`, on by default). The JSONB copy is what makes rollback
   lossless.
2. **Backfill.** `db/backfill.ts` copies `documents` rows into the tables in
   one `INSERT … SELECT` per collection, parents first, idempotently
   (`ON CONFLICT DO NOTHING`), and verifies: documents, table rows and
   `missing` (documents with no row), with revoked sessions and orphans
   (a parent that does not exist) reported separately. Boot runs it for any
   migrated table that is still empty while `documents` has rows (the first
   boot after upgrading); `npm run backfill` runs it by hand.
3. **Switch reads.** Routes read the repository; the collection is no longer
   registered, hydrated or held in memory. Backups read and restore the
   tables under the old collection names, so backups from before and after
   the switch restore the same way.
4. **Drop the JSONB copy** (later): once a release has run with the tables as
   the only reader and no rollback is planned, set `DATA_DUAL_WRITE=0`, then a
   migration deletes the collection's `documents` rows.

### Rollback

- **Before step 4:** redeploy the previous image. It hydrates from
  `documents`, which dual-write kept current (only writes still queued at the
  moment of a hard kill are lost; a graceful shutdown flushes them). The
  tables are left untouched.
- **Rolling forward again** after running the old build for a while: the old
  build wrote only to `documents`, so with the API stopped run
  `npm run backfill -- --resync` (documents win: rows upserted, rows with no
  document deleted), then deploy.
- **The schema migration** is additive (new tables, no change to `documents`
  or `audit_entries`), so the old build runs against a migrated database.
- **After step 4** rollback means restoring a backup; that is why step 4 waits.

### Phases

| Phase | Collections | Result |
|---|---|---|
| **1 (this ADR, done)** | members (with credentials), sessions, tasks, task events, task comments, notifications | These are replica-safe. The rest is still on the JSONB seam, so replicas stay at 1. |
| 2 | subtasks, time logs, projects, docs, doc versions and comments, channels, messages (partitioned), channel reads, workspaces, incidents, incident actions, deployments; a unit of work for multi-row writes | Every collection a user edits at runtime. |
| 3 | sign-ins (partitioned), JIT grants, personal access tokens, TOTP replay counters, recovery tokens, NDA signatures, resignations, engineering (repos, pulls, CI, findings, monitors and history, integrations, webhooks, GitHub deliveries/identities), files; per-process auth state (WebAuthn challenges, pending TOTP enrolments) to a shared store | No collection left in memory: more than one replica is safe; the worker's long-running mode can be enabled. |
| 4 | drop `documents` copies, retire `store/collection.ts` hydration; read cache over Redis where measurements justify it; tenant routing on `org_id` | Memory no longer grows with data; sharding becomes a deployment decision. |

## Consequences

- Handlers for the migrated data are asynchronous; helpers that touched
  `db.members` / `db.tasks` became async (`notify`, `parseMentions`,
  `currentViewer`, `verifyPat`, the ML feature builder, GitHub PR linking…).
- Every read of migrated data is a database round trip. Requests that used to
  scan a `Map` now issue one or a few indexed queries; list endpoints are
  bounded by the organisation's size (members) or filtered in SQL (tasks).
  The ML training export and the assistant's context still load all tasks
  and events of the organisation per call (phase 2 pushes them into SQL).
- The memory footprint no longer includes these collections.
- `bootstrap-owner` no longer needs the backend stopped: members are rows,
  and the unique keys decide.
- **Replicas stay at 1 until phase 3**, because the collections still on the
  seam (and the per-process WebAuthn challenges, TOTP enrolments and TOTP
  replay counters) are per-process. [Known limits](../../operations/known-limits.md#run-exactly-one-backend-replica)
  lists exactly what remains.
- Proof: `npm run smoke:pg` runs two API processes on one database and, for
  each migrated collection, writes through one and reads through the other,
  after checking the backfill restores every row and is idempotent.

## References

- `Backend/db/migrations/003_relational_core.sql`, `Backend/data/`,
  `Backend/db/backfill.ts`, `Backend/db/boot.ts`, `Backend/db/smoke-replicas.ts`
- `Backend/auth/sessionStore.ts` (shared session contract), `Backend/auth/sessions.ts`
- [ADR 0003](0003-postgres-jsonb-collections.md), [ADR 0009](0009-redis-for-shared-runtime-state.md)
- [Storage](../../operations/storage.md), [Known limits](../../operations/known-limits.md)
