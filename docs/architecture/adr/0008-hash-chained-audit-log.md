# 0008. Hash-chained, append-only audit log

- **Status:** Accepted, implemented. Shipping the chain to write-once object
  storage is planned for Wave 4 (STORAGE lane).
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
  `{ok: false, brokenAt: seq}`. It backs `GET /api/audit/verify` and the
  readiness probe (`GET /api/ready` answers `503` when the chain is broken).
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
- The in-memory chain starts empty on every boot (the JSONL file is not read
  back), so `seq` restarts at 1 and `verify()` covers only the current process
  lifetime. The JSONL file keeps the full history across restarts, with one
  chain per process lifetime.
- Task comments, subtasks and time logs are recorded as task events
  (`db.taskEvents`) rather than audit entries; the task's own create, update
  and delete are audited.
- `GET /api/audit` has no area guard today: any signed-in member can read the
  whole trail, including entries for products outside their scope. The web app
  only shows the Audit page to the Owner. See
  [Roles and permissions](../../concepts/roles-and-permissions.md#routes-open-to-every-signed-in-member).

> [!NOTE]
> **Planned: Wave 4 (STORAGE, B-DATA).** The audit archive ships to
> `S3_BUCKET_AUDIT` with object lock (WORM) in production, so an attacker with
> server access still cannot rewrite history. With PostgreSQL in place the
> chain can survive restarts; the exact approach is B-DATA's and STORAGE's to
> define.

## References

- `Backend/audit/auditLog.ts`, `Backend/routes/security.routes.ts`,
  `Backend/routes/system.routes.ts` (`/api/ready`)
- [Audit log concept](../../concepts/audit-log.md),
  [Audit verification](../../operations/audit-verification.md)
