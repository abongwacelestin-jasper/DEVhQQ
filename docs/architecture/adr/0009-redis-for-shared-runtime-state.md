# 0009. Redis for shared runtime state

- **Status:** Accepted, implemented (rate limits, event fan-out, job leases);
  the session store interface is ready, and its wiring belongs to the data
  layer
- **Date:** 2026-11-07

## Context

Several parts of the backend hold runtime state in process memory: the
rate-limit buckets, the event bus behind `GET /api/_events`, the realtime hub
behind `GET /api/stream`, and the timers that run periodic jobs. With two
replicas, each limit would apply once per replica (twice the password and
TOTP guesses), an event published on one replica would never reach a client
connected to the other, and every job would run once per process. Railway
already provisions a Redis plugin and passes `REDIS_URL` to the backend and
the worker.

Hard rule 7 (`CONTRIBUTING.md`) requires an ADR for a new backend runtime
dependency. So far the only one is `pg`.

## Decision

Use Redis for the state that has to be shared at runtime, through the
existing seams, with the in-process behaviour unchanged whenever `REDIS_URL`
is unset.

- **Client:** `@redis/client` 5.12.1, pinned exactly. It is the client core
  of node-redis v5, maintained by Redis, and has one dependency
  (`cluster-key-slot`). The `redis` meta-package would add module clients
  (`@redis/json`, `search`, …) that we do not use. We chose it over `ioredis`
  because node-redis is the actively developed official client, and we do not
  need BullMQ (which requires `ioredis`).
- **Connection** (`Backend/lib/redis.ts`): TLS when the URL is `rediss://`
  (certificate verified); reconnect forever with capped, jittered backoff
  (50 ms to 5 s); offline queue off, so a disconnected client fails at once
  instead of stalling requests; a command timeout (`REDIS_COMMAND_TIMEOUT_MS`,
  500 ms by default); one command connection and one subscriber connection.
  `GET /api/ready` reports `redis`. `EXPECT_REPLICAS` above 1 makes Redis
  mandatory: production without `REDIS_URL` refuses to boot, an unreachable
  Redis refuses to boot, and readiness fails while Redis is down.
- **Rate limits** (`security/rateLimitRedis.ts`): `refillAndTake` ported to
  one Lua script (`EVALSHA`, with `EVAL` as the fallback), using Redis `TIME`,
  with a key expiry of a full refill plus 60 s. When Redis is down, the
  `api` limiter fails open to a local bucket and `auth`/`acct` fail closed
  with `503`. The reasons are in `docs/security/CONTROLS.md`, "When Redis is
  down".
- **Events** (`lib/redisBus.ts`): bus and realtime events go out on
  `<prefix>bus` / `<prefix>rt` in an envelope that carries the sender's
  instance id. The publisher delivers locally first and drops its own echo.
  Receivers deliver to their local subscribers only and run the unchanged
  per-subscriber checks (`security/eventPolicy.ts`, `canReadChannel`).
  `subscribe()` stays local, so side-effect listeners (notifications, token
  revocation) still run once per event. Remote events reach only
  `subscribeFanout()`. The publisher resolves an event's product before it
  forwards the event, because the receiver may not hold the record.
  Realtime ids become hybrid-logical-clock values, so `Last-Event-ID` keeps
  working across replicas.
- **Jobs** (`lib/scheduler.ts`): a lease before every run.
  `SET <prefix>lock:<key> <instance> NX PX <ttl>` gives slot-aligned jobs
  (backup, digest) one run per slot and gives each monitor one check per
  interval. Leases are never released early. If Redis cannot answer, the run
  is skipped. We chose this over BullMQ: the jobs are a handful of timers, the
  lease adds two lines of Redis traffic per run, and BullMQ would bring
  `ioredis` and a second dependency tree. `JOBS_IN_PROCESS` and
  `WORKER_JOBS` still choose which processes may run a job.
- **Sessions** (`auth/sessionStore.ts`): a `SessionStore` interface with
  memory and Redis implementations. `auth/sessions.ts` belongs to the data
  layer lane, which is moving sessions to query-on-demand Postgres. That lane
  picks the backend and does the async switch-over. Postgres is the default
  choice: sessions stay durable and auditable next to members, with no new
  dependency. Redis is the drop-in if session lookups (one per request)
  become the hot path.
- **Mail** keeps its direct, never-throw `sendMail`. Sends are not queued.

## Consequences

- One new runtime dependency (`@redis/client`, plus `cluster-key-slot`).
- Redis is inside the trust boundary. Anyone who can write to it can drain
  buckets, take leases or inject events, though injected events still pass
  the per-subscriber policy. Keep Redis on the private network with a
  password (the Railway default), or use `rediss://`.
- With more than one replica, a Redis outage refuses sign-in and
  second-factor checks and skips periodic jobs. Everything else stays up.
- Pub/sub is at-most-once. A replica that is disconnected when an event is
  published does not get it.
- More than one backend replica is still unsafe until the data layer stops
  serving collections from per-process memory. The conditions are in
  `docs/deploy/RAILWAY.md`, "Scaling".

## References

- `Backend/lib/redis.ts`, `lib/redisBoot.ts`, `lib/redisBus.ts`,
  `lib/scheduler.ts`, `security/rateLimitRedis.ts`, `auth/sessionStore.ts`
- Tests: `Backend/test/unit/redis.test.ts` (no server needed),
  `Backend/test/redis/` (`npm run test:redis`, real Redis, two API
  processes), `security-tests/checks/ratelimit-two-instances.ts`
- [ADR 0003](0003-postgres-jsonb-collections.md) (why collections are
  in memory)
