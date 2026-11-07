# Audit verification

How to confirm the audit log has not been altered. Background:
[Audit log](../concepts/audit-log.md) and
[ADR 0008](../architecture/adr/0008-hash-chained-audit-log.md).

## Live chain

```console
$ curl -s -b owner http://localhost:8080/api/audit/verify
{"ok":true}
```

A broken chain returns `{"ok":false,"brokenAt":<seq>}`: the entry at `brokenAt`
was changed, or something before it was inserted or removed. The readiness
probe checks the same thing on every call:

```console
$ curl -s http://localhost:8080/api/ready
{"ready":true,"members":12,"auditChain":"intact"}
```

and returns `503` with `"auditChain":"broken"` when it fails, so an
orchestrator stops routing traffic to that instance. The backend console's
**Integrity check** calls `/api/audit/verify`. `GET /api/security/posture`
includes the result under `resilience.audit`.

## The file on disk

`AUDIT_LOG_FILE` holds one JSON entry per line. Each process lifetime writes
its own chain, starting at `seq` 1 with a `prevHash` of 64 zeros. To verify a
file offline, recompute each hash exactly as `digest()` in
`Backend/audit/auditLog.ts` does:

```js
// verify-audit.mjs — node verify-audit.mjs .audit/audit.jsonl
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const GENESIS = '0'.repeat(64);
let prev = GENESIS, n = 0, chains = 0;
for (const line of readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean)) {
  const e = JSON.parse(line);
  if (e.seq === 1) { prev = GENESIS; chains++; }           // a new process lifetime
  const h = createHash('sha256').update(JSON.stringify(
    [e.seq, e.at, e.actor, e.action, e.target, e.sensitive, e.requestId ?? null, e.prevHash],
  )).digest('hex');
  if (e.prevHash !== prev || h !== e.hash) { console.error(`broken at line ${n + 1} (seq ${e.seq})`); process.exit(1); }
  prev = e.hash; n++;
}
console.log(`ok: ${n} entries in ${chains} chain(s)`);
```

Run against the audit file of a local session this printed
`ok: 17 entries in 1 chain(s)`; after changing one `action` in a copy of the
file it printed `broken at line 12 (seq 12)` and exited 1.

Limits: a restart boundary (`seq` back to 1) is where an attacker could cut
the tail of a chain without detection, and the file is only as safe as the
disk it is on. Off-host, write-once copies close that gap.

> [!NOTE]
> **Planned: Wave 4 (STORAGE).** The audit archive is shipped to
> `S3_BUCKET_AUDIT` with object lock (WORM).

## What to do when verification fails

1. Treat it as a security incident: declare one and keep the instance for
   forensics rather than restarting it (a restart starts a fresh chain).
2. Compare the in-memory trail (`GET /api/audit?limit=500`) with the JSONL file
   and any off-host copy to find the altered range.
3. Use the `requestId` of the surrounding entries to find the matching log
   lines (`GET /api/_logs?q=<requestId>`).
