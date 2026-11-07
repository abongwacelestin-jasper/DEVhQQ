# 0008. Hash-chained, append-only audit log

- **Status:** Accepted, implemented; database mirror and write-once archive
  added in Wave 4 (B-DATA, STORAGE); one chain across restarts added in v2.1
  (see the addendum, which supersedes the "starts empty on every boot"
  consequence below).
- **Date:** 2026-10-30 (recorded 2026-11-07)

## Context

DevHQ's controls (two-person approval, JIT access, role changes, step-up) are
only as good as the record of their use. An attacker or insider with server
access will try to remove the evidence. A plain log table can be edited
without trace.

## Decision

Every state change appends an entry to one audit log
(`Backend/audit/auditLog.ts`):

- Entries are `{seq, at, actor, action, target, sensitive, requestId?,
  prevHash, hash}`. `hash` is SHA-256 over a fixed-order JSON array of all
  other fields including `prevHash`; the first entry's `prevHash` is 64 zeros.
  Editing, inserting or deleting any entry breaks every hash after it.
- `audit.verify()` recomputes the chain and returns `{ok: true}` or
  `{ok: false, brokenAt: seq}`. It backs the readiness probe
  (`GET /api/ready` answers `503` when the chain is broken). Since v2.1
  `GET /api/audit/verify` uses `audit.verifyAll()`, which also re-reads the
  durable store (see the addendum).
- Each entry is also appended to a JSONL file opened in append mode
  (`AUDIT_LOG_FILE`, default `./.audit/audit.jsonl`) and published on the event
  bus (`/api/_events`, event type `audit`).
- `sensitive: true` marks security-relevant entries (authentication events,
  role and access changes, production deploys, deletions, SEV1 incidents) so
  they can be filtered (`GET /api/audit?sensitive=1`).
- The rule for contributors: **every state-changing handler calls
  `audit.append`**. See [Backend/README.md](../../../Backend/README.md).

## Consequences

- Tampering with the in-memory chain is detectable; verification is cheap
  enough to run on every readiness probe.
- The chain proves integrity, not completeness at the end: truncating the
  newest entries leaves a valid shorter chain. Off-host, write-once copies are
  what defend against that.
- *(v2.0.0, superseded by the addendum.)* The in-memory chain started empty on
  every boot (the JSONL file was not read back), so `seq` restarted at 1 and
  `verify()` covered only the current process lifetime, with one chain per
  process lifetime in the JSONL file.
- Task comments, subtasks and time logs are recorded as task events
  (`db.taskEvents`) rather than audit entries; the task's own create, update
  and delete are audited.
- `GET /api/audit` needs Administration ≥ `view` (Owner, Operations). Those
  roles read the whole trail, including entries for every product. The web app
  only shows the Audit page to the Owner. See
  [Roles and permissions](../../concepts/roles-and-permissions.md#routes-open-to-every-signed-in-member).

- Two more copies defend against tail truncation and host compromise: the
  append-only `audit_entries` table in PostgreSQL (`Backend/db/auditSink.ts`)
  and batches in the audit bucket under Object Lock, each batch linked to the
  previous by hash (`Backend/storage/auditArchive.ts`). Batches carry a
  `bootId`; since v2.1 a boot's first batch chains from the previous boot's
  head.

## Addendum (v2.1): one chain across restarts

**Problem.** Every boot started a fresh chain at `seq` 1 from the 64-zero
genesis. A restart boundary was therefore a place where the tail of the
previous chain could be cut, or a whole boot removed, without any hash
breaking. Only the archived copies tied the chains together, not the hashes.

**Decision: continue `seq`.** On boot, before anything else is audited,
`initPersistence()` (`Backend/db/boot.ts`) calls `audit.resume(source)`. The
source is `audit_entries` (`pgAuditSource`, rows by `id`) when `DATABASE_URL`
is set, else the JSONL file (`fileSource`). `resume()` reads the whole store
through the same `ChainVerifier` the offline script uses
(`Backend/audit/chain.ts`), then continues it: the boot's first entry has
`seq = last.seq + 1` and `prevHash = last.hash`. That first entry is always a
boot marker:

| Store at boot | First entry | `sensitive` |
|---|---|---|
| empty (first boot ever) | `audit.chain_genesis`, `seq` 1, genesis `prevHash` | no |
| verifies | `audit.chain_resumed`, linked to the stored head | no |
| broken (edited, missing, reordered, torn last line) | `audit.chain_discontinuity`, still linked to the last readable entry; `target` names the first break | yes |
| unreadable (I/O or permission error) | `audit.chain_discontinuity` at `seq` 1 / genesis; `target` gives the error | yes |

The boot always goes ahead, and a fresh genesis is never silent.

We chose this over the alternative of a `boot` entry that restarts at `seq` 1
with `prevHash` set to the last hash:

- **`seq` becomes a global position.** A gap or a repeat is visible to a
  person reading the trail or the table, and "entry 4211" means one thing.
  With a per-boot `seq`, every reference also needs a boot id.
- **Old tooling keeps working.** In file mode a v2.1 file still passes the
  v2.0.0 documented verifier, which resets on `seq` 1 and otherwise expects
  each line to link to the previous one. Under the alternative, every boot
  would look like a broken genesis to that script.
- **No schema change.** `UNIQUE (chain_id, seq)` and the archive keys
  (`<bootId>/<fromSeq>-<toSeq>`) stay unique: `chain_id` and `bootId` are
  still per boot, and two replicas that continue the same head use different
  ids.
- **The hash format is unchanged.** It is the same fields in the same order,
  so v2.0.0 entries and v2.1 entries verify with one `digest()`.

The marker entry is not a second design. It is what lets a verifier tell a
legitimate boot boundary from tampering: within one boot each entry must
follow the one before it (the previous line in a file, the previous row of
the same `chain_id` in the table), and only a marker may link anywhere else.

**Verification.** `ChainVerifier` checks a stream in storage order. Each
entry must hash correctly, and its `prevHash` must name an entry already seen
whose `seq` is one less (or be genesis at `seq` 1). This detects an edited
entry (`hash_mismatch`), a missing or reordered entry, or a cut tail before a
later boot (`unknown_parent`, `out_of_order`, `seq_mismatch`), duplicates,
and a silent fresh genesis after continuity began (`unexpected_genesis`).
Given the last head known to have been written, it also detects a cut tail
at the very end (`truncated_tail`). `audit.verifyAll()` passes that head: the
last line this process wrote to the file, or the last row its sink committed.
`audit.verify()` stays synchronous and in-memory (it checks this boot's
entries from the resumed anchor) because `/api/ready` calls it on every
probe. A boot-time discontinuity is reported alongside it, not as a break,
so a broken history that can never be repaired does not keep the instance
out of rotation forever.

**Compatibility.** Hash format and fields are unchanged. Data written by
v2.0.0 starts from genesis once per boot, and those genesis restarts are
accepted (`legacyBoots`) until the first v2.1 marker. v2.0.0 could also store
an entry a few lines ahead of the entry it follows: a bus subscriber appended
re-entrantly while the outer entry was still being published, and the file
write raced. Before the first marker such an entry is held until its parent
arrives, within 1,000 records and with each parent continued at most once,
and counted as `legacyReordered`. v2.1 data gets no such tolerance. v2.1 also
removes the race: file writes are serialised in chain order, and bus
publication is queued, so a re-entrant append lands after its trigger in the
file, in the table and in the archive.

**Consequences.**

- Restart boundaries are covered by the hashes. Cutting the tail of an
  earlier boot, or removing a boot, breaks the next boot's marker.
- Boot reads the whole store once (keyset pages of 5,000 rows, or a
  line-by-line stream). This is linear in history size. The verifier keeps
  one index entry per hash, about 150 MB per million entries.
- The newest tail is still only as safe as its anchor. If the store's last
  entries are removed while no process is running, the next boot continues
  from the shorter chain. The defence is an independent copy: compare with
  the archive's latest `headHash` (`verify-audit.ts --head <hash>`), or with
  the database when the file is the store.
- Replicas sharing one database each continue the head they read, which
  produces a fork (counted as `forks`, not a break). Each fork is linear
  within its `chain_id`.
- `Backend/scripts/verify-audit.ts` verifies a file, a `row_to_json` export
  of `audit_entries`, archived batches, or the database directly. It reports
  the first break. See
  [Audit verification](../../operations/audit-verification.md).

## References

- `Backend/audit/auditLog.ts`, `Backend/audit/chain.ts`,
  `Backend/audit/fileSource.ts`, `Backend/db/auditSink.ts` (`pgAuditSource`),
  `Backend/db/boot.ts`, `Backend/scripts/verify-audit.ts`,
  `Backend/routes/security.routes.ts`,
  `Backend/routes/system.routes.ts` (`/api/ready`)
- [Audit log concept](../../concepts/audit-log.md),
  [Audit verification](../../operations/audit-verification.md)
