# Audit verification

How to confirm the audit log has not been altered, across every restart.
Background: [Audit log](../concepts/audit-log.md) and
[ADR 0008](../architecture/adr/0008-hash-chained-audit-log.md) (see the
addendum for the cross-boot design).

Since v2.1 the trail is **one chain across restarts**. Each boot reads the
durable store (`audit_entries` with PostgreSQL, else `AUDIT_LOG_FILE`) and
verifies it. It then continues the chain with a boot marker: `seq` carries
on, and `prevHash` is the last stored hash.

## Live check

```console
$ curl -s -b owner http://localhost:8080/api/audit/verify
{"ok":true,
 "live":{"ok":true},
 "store":{"kind":"postgres","ok":true,"entries":4211,"head":{"seq":4211,"hash":"…"},
          "firstBreak":null,"resumedBoots":37,"legacyBoots":2,"discontinuities":[],
          "forks":0,"legacyReordered":0},
 "continuity":{"source":"postgres","status":"resumed","storedEntries":4180,
               "resumedFrom":{"seq":4180,"hash":"…"}}}
```

`GET /api/audit/verify` needs Administration ≥ `view`. It checks:

- `live`: this boot's in-memory chain, from the stored head it resumed from.
- `store`: the durable store, re-read end to end across every boot. It must
  also still contain the last entry this process wrote, which catches a cut
  tail.
- `continuity`: how this boot started. `genesis` means an empty store (the
  first boot), `resumed` means the stored chain verified, `discontinuity`
  means it did not (see below), and `not_resumed` means no store was
  consulted (unit tests).

`ok` is `false` when either `live` or `store` is broken. `brokenAt` is then the
first broken `seq`, and `store.firstBreak` explains it:

| `reason` | Meaning |
|---|---|
| `hash_mismatch` | the entry's fields were edited |
| `unknown_parent` | its `prevHash` names no earlier entry: an entry before it is missing or was moved after it, or the tail of the previous boot was cut |
| `out_of_order` | it does not follow the entry before it in its boot, and it is not a boot marker |
| `seq_mismatch` | `seq` is not its parent's `seq + 1` |
| `duplicate` | the same entry is stored twice |
| `unexpected_genesis` | a fresh 64-zero chain appears after continuity began, without a declared discontinuity |
| `malformed` | a line or row that is not an audit entry, such as a torn last line after a crash |
| `truncated_tail` | the last entry known to have been written is gone |

The readiness probe checks the live chain on every call:

```console
$ curl -s http://localhost:8080/api/ready
{"ready":true,"database":"up",…,"auditChain":"intact"}
```

It returns `503` with `"auditChain":"broken"` when the live chain fails, so an
orchestrator stops routing traffic to that instance. A boot-time discontinuity
does **not** fail readiness, because a broken history can never be repaired
and the instance would never be ready again. It is reported by
`/api/audit/verify` (`continuity.discontinuity`, `live.discontinuity`) and as a
sensitive `audit.chain_discontinuity` entry in the trail. The backend
console's **Integrity check** calls `/api/audit/verify`.
`GET /api/security/posture` includes the live result under `resilience.audit`.

## Discontinuities

A boot never starts a fresh genesis silently. If the stored chain cannot be
read, or is already broken, the boot goes ahead, but its first entry is a
sensitive `audit.chain_discontinuity`:

```console
$ curl -s -b owner 'http://localhost:8080/api/audit?sensitive=1&action=audit.chain_discontinuity'
[{"seq":4181,"actor":"system","action":"audit.chain_discontinuity",
  "target":"postgres chain broken at seq 3920 (hash_mismatch) · continuing from seq 4180 · 9e61dfba8c57",
  "sensitive":true,…}]
```

- **Broken store:** the entry is still linked to the last readable entry, so
  everything after it stays verifiable. `target` names the first break.
- **Unreadable store:** for example, a permission error on `audit_entries`.
  The entry starts at `seq` 1 from genesis, and `target` gives the error.

Treat either case as a security incident (see the steps at the end of this
page).

## Offline verifier

`Backend/scripts/verify-audit.ts` checks a whole store end to end, across
every boot, and reports the first break. Run it from `Backend/`:

```console
$ node --experimental-strip-types scripts/verify-audit.ts .audit/audit.jsonl
ok: 1312 entries, head seq 1312 (3be1c0a95d7e); 14 linked boot(s), 3 v2.0.0 chain(s)
$ echo $?
0
```

After one line was deleted from a copy of the file:

```console
$ node --experimental-strip-types scripts/verify-audit.ts tampered.jsonl
broken: unknown_parent at line 8 (seq 9): prevHash names no earlier entry
$ echo $?
1
```

Inputs (several files are checked as one stream, in the order given):

- **The JSONL file** (`AUDIT_LOG_FILE`), as written by v2.0.0 or later.
- **A database export**, one JSON row per line, oldest first. Use `-At`, not
  `COPY`, because `COPY` escapes backslashes:

  ```bash
  psql "$DATABASE_URL" -At \
    -c "SELECT row_to_json(a) FROM audit_entries a ORDER BY id" > audit-db.jsonl
  node --experimental-strip-types scripts/verify-audit.ts audit-db.jsonl
  ```

- **The database directly**, read only, over `DATABASE_URL`:

  ```bash
  DATABASE_URL=postgres://… node --experimental-strip-types scripts/verify-audit.ts --database
  ```

- **Archived batches** from the audit bucket, in key order. Header lines are
  skipped:

  ```bash
  node --experimental-strip-types scripts/verify-audit.ts $(ls archive/audit/*/*/*/*/*.jsonl | sort)
  ```

Options and results:

| | |
|---|---|
| `--head <hash>` | a newest hash you trust from an independent copy, such as the latest archived batch's `headHash` or a previous run's head. If it is missing, the result is `truncated_tail`. |
| `--json` | print the full report |
| exit `0` | intact |
| exit `1` | broken; the first break is printed to stderr |
| exit `2` | intact, but with declared `audit.chain_discontinuity` boots to review |
| exit `64` / `66` | usage error / input unreadable |

**Data written by v2.0.0 still verifies.** v2.0.0 started a fresh genesis
chain at every boot. Those restarts are accepted and counted as
`v2.0.0 chain(s)` until the first v2.1 boot marker; after that, a fresh
genesis is a break. v2.0.0 could also store an entry a few lines ahead of the
entry it follows: a re-entrant append raced the file write, and the v2.0.0
documented script fails on those files. Before the first v2.1 marker such an
entry is accepted when its parent arrives within 1,000 records and no parent
is continued twice, and it is counted as `stored out of order`. v2.1 data
gets no such tolerance.

The first boot on v2.1 links to the last v2.0.0 entry, so the upgrade is
covered by the hashes too.

## What the hashes cannot prove

A hash chain shows that nothing *inside* it changed. It cannot show that
nothing was cut from the *newest* end while no process was running: the next
boot simply continues from the shorter chain. Independent copies cover that:

- **Database:** with PostgreSQL, every entry is also in the append-only
  `audit_entries` table. UPDATE, DELETE and TRUNCATE are rejected by
  triggers, and the runtime role can only INSERT and SELECT
  (`Backend/db/auditSink.ts`).
- **Object storage (WORM):** batches of up to 200 entries are written to
  `S3_BUCKET_AUDIT` under `audit/YYYY/MM/DD/<bootId>/<fromSeq>-<toSeq>.jsonl`,
  in a bucket with Object Lock (`COMPLIANCE` in production). Line 1 of each
  batch is a header with the sequence range, the `prevHash` it chains from and
  its `headHash`. Batch N's `headHash` is batch N+1's `prevHash`, so a missing
  or altered batch is detectable. Pass the newest `headHash` to the verifier
  as `--head` when you check the file or the database.
  `GET /api/storage/status` → `auditArchive` shows pending entries, batches
  written and the last error.

Several replicas sharing one database each continue the head they read at
boot. That shows up as `fork(s)` in the report, not as a break: each replica's
rows stay linear within its `chain_id`.

## What to do when verification fails

1. Treat it as a security incident: declare one, and keep the instance and
   the store for forensics. A restart does not hide the break: the next boot
   verifies the store again and records an `audit.chain_discontinuity`.
2. Find the altered range: run the offline verifier on the JSONL file, a
   database export and the archived batches, and compare their first breaks
   and heads. The archive in the locked bucket is the copy to trust.
3. Use the `requestId` of the surrounding entries to find the matching log
   lines (`GET /api/_logs?q=<requestId>`).
