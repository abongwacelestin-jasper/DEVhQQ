# Backend persistence (PostgreSQL)

The API keeps every table in memory (`store/collection.ts`) so handlers stay
synchronous. When `DATABASE_URL` is set, a write-behind PostgreSQL driver
persists every change and the server rebuilds memory from the database at boot.
Without `DATABASE_URL` nothing is persisted (smoke tests, quick local start).

| File | Purpose |
|---|---|
| `migrations/NNN_*.sql` | Ordered schema migrations (never edit one once applied) |
| `migrate.ts` | Runner: advisory lock, `schema_migrations`, checksums. `npm run migrate` |
| `pool.ts` | `pg.Pool` factory, `DATABASE_SSL` handling |
| `driver.ts` | `CollectionDriver` → generic `documents` table (batched, ordered, retried) |
| `boot.ts` | `initPersistence()` / `closePersistence()` / `pingDatabase()` |
| `smoke-pg.ts` | `npm run smoke:pg` — restart-survival test (needs `DATABASE_URL`) |

## Boot sequence (`buildApp()` → `initPersistence`)

1. Run pending migrations (as `DATABASE_MIGRATION_URL` if set, else `DATABASE_URL`).
   If everything is applied the runner issues **no DDL**, so the runtime role can boot.
2. Install the PostgreSQL driver.
3. Under an advisory lock: `hydrateAll()`, then seed demo data **only if**
   `NODE_ENV !== 'production'` **and** `documents` is empty. The seed is
   flushed before the lock is released, so concurrent replicas never double-seed
   or hydrate a half-seeded database.

Shutdown (`SIGTERM`/`SIGINT`): the HTTP server stops accepting requests, then
`closePersistence()` flushes the write queue and closes the pool.
`flushPending()` (from `store/collection.ts`) awaits the queue on demand.

## Data model

```
documents(collection text, key text, data jsonb, updated_at timestamptz,
          primary key (collection, key))
  + GIN (data jsonb_path_ops) + (collection, updated_at desc)
audit_entries(...)   -- append-only (UPDATE/DELETE/TRUNCATE rejected by trigger)
schema_migrations(version, name, checksum, applied_at)
```

Collections persisted today: `members`, `projects`, `docs`, `tasks`,
`taskEvents`, `taskComments`, `subtasks`, `timeLogs`, `deployments`,
`incidents`, `signIns` (bounded 2000-row in-memory window, full history in the
DB), `sessions` (keyed by SHA-256 of the token's random id — no raw token or
raw id is stored), `jitGrants`. Other lanes add theirs with `createCollection`.

### Write path guarantees

- `set` / `delete` / `save(key)` enqueue and return immediately.
- At most one pending op per `(collection, key)`; newer ops replace older ones,
  and only one batch is in flight, so an older value can never overwrite a newer one.
- Values are serialised when enqueued (later un-saved mutations do not leak in).
- Batches (≤ 500 rows) commit in one transaction via parameterised `unnest`.
- Failures re-queue and retry with capped exponential backoff + jitter, logged
  as `db.persist_failed` (and `db.persist_recovered`). A row the database
  rejects for its data (SQLSTATE 22/23) is isolated and logged as
  `db.persist_dropped` rather than blocking all other writes.
- Backpressure: the backlog is bounded by the number of distinct rows. Above
  20 000 pending rows `persistenceStatus().saturated` is true and
  `db.backlog_saturated` is logged; readiness should then report 503.

**Rule for every module:** after mutating a row in place call
`collection.save(key)`, or the change is lost on restart.

### Known limits

- Single writer: memory is authoritative per process. Run **one** backend
  replica against a database (or add row-level change notification before
  scaling out). Boot is safe for concurrent replicas; steady-state writes are not.
- Hydration loads every collection into memory (except bounded windows such as
  `signIns`), which is fine at the current data size.
- Writes are acknowledged to the client before they are durable (write-behind,
  typically < 50 ms). A hard crash (`SIGKILL`, OOM) can lose that window;
  graceful shutdown cannot.

## Environment

| Var | Default | Notes |
|---|---|---|
| `DATABASE_URL` | unset → memory mode | Runtime role connection string |
| `DATABASE_MIGRATION_URL` | `DATABASE_URL` | DDL-capable role used for migrations only |
| `DATABASE_SSL` | `disable` | `disable` \| `require` \| `verify-full`; anything else fails boot |
| `DATABASE_SSL_CA` | — | Path to a PEM CA bundle for `verify-full` (managed Postgres) |
| `DATABASE_POOL_MAX` | `10` | Minimum 2 |
| `DATABASE_STATEMENT_TIMEOUT_MS` | `15000` | Runtime pool only |
| `DATABASE_CONNECT_TIMEOUT_MS` | `5000` | |

`DATABASE_SSL`:

- `disable` — plain TCP. Acceptable only on a private network (the compose
  `postgres` service is internal-only). Logs `db.tls_disabled` in production.
- `require` — TLS, certificate **not** verified (protects against passive
  sniffing only).
- `verify-full` — TLS with chain and host-name verification. Use this for any
  managed or cross-network database; set `DATABASE_SSL_CA` if the server's CA
  is not in Node's default trust store.

## Least privilege: two roles

The migration role owns the schema and runs DDL. The runtime role (the one in
`DATABASE_URL`) can only read and write rows — it cannot create, alter or drop
anything, and it cannot change or delete audit rows.

```sql
-- as a superuser / admin, once per database
CREATE ROLE devhq_migrator LOGIN PASSWORD '<from your secret store>';
CREATE ROLE devhq_app      LOGIN PASSWORD '<from your secret store>';

REVOKE ALL ON DATABASE devhq FROM PUBLIC;
GRANT CONNECT ON DATABASE devhq TO devhq_migrator, devhq_app;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO devhq_migrator;
GRANT USAGE ON SCHEMA public TO devhq_app;          -- no CREATE: no DDL

-- Everything the migrator creates is usable (not ownable) by the app:
ALTER DEFAULT PRIVILEGES FOR ROLE devhq_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO devhq_app;
ALTER DEFAULT PRIVILEGES FOR ROLE devhq_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO devhq_app;
```

Then, after the first `npm run migrate` as `devhq_migrator`, tighten the
append-only and bookkeeping tables (the trigger already blocks changes; this
removes the privilege too):

```sql
REVOKE UPDATE, DELETE, TRUNCATE ON audit_entries FROM devhq_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON schema_migrations FROM devhq_app;
```

Deploy order: `DATABASE_MIGRATION_URL=… npm run migrate` (release step), then
start the backend with `DATABASE_URL` pointing at `devhq_app`. If a migration
is pending and only the runtime role is configured, boot fails loudly
(`permission denied`) instead of running with a stale schema.

## Local run

```sh
docker run -d --name devhq-pg -p 5433:5432 -e POSTGRES_PASSWORD=devhq-local -e POSTGRES_DB=devhq postgres:17-alpine
export DATABASE_URL=postgres://postgres:devhq-local@127.0.0.1:5433/devhq
npm run migrate      # optional — boot migrates too
npm run smoke:pg     # write → restart → verify, in two fresh processes
npm run dev
```
