# Audit log

Every state change in TavetaHQ is recorded in one append-only log whose entries
are chained by hash, so editing or removing history is detectable. The design
and its trade-offs are in [ADR 0008](../architecture/adr/0008-hash-chained-audit-log.md);
this page is about what is in it and how to read it.

## An entry

```json
{"seq":14,"at":"2026-11-07T00:37:02.009Z","actor":"m11","action":"jit.approved","target":"m4 → production:renewberry","sensitive":true,"prevHash":"211b1793…6cc6","hash":"63116fc7…64e7"}
```

| Field | Meaning |
|---|---|
| `seq` | 1, 2, 3, … across the whole history: each boot continues the last stored `seq` |
| `at` | ISO timestamp |
| `actor` | member id, or `system` for the server itself (start/stop, backups, JIT expiry) |
| `action` | dotted verb, e.g. `deploy.approved` |
| `target` | human-readable object of the action; never contains secrets |
| `sensitive` | security-relevant; filter with `?sensitive=1` |
| `requestId` | the request that caused it, when there was one — match it with logs and error responses |
| `prevHash` | `hash` of the previous entry, which for a boot's first entry is the last stored entry (64 zeros for the very first entry) |
| `hash` | SHA-256 of `[seq, at, actor, action, target, sensitive, requestId ?? null, prevHash]` as JSON |

## Actions recorded

From `audit.append` calls in the backend (the prefix names the module):

| Prefix | Examples |
|---|---|
| `server.` | `started`, `stopping` |
| `audit.` | boot markers, always the first entry of a boot: `chain_genesis` (empty store), `chain_resumed` (stored chain verified and continued), `chain_discontinuity` (store unreadable or broken; sensitive) |
| `auth.` | `password_ok`, `mfa_ok`, `mfa_failed`, `locked`, `blocked_risk`, `step_up`, `step_up_failed`, `totp_enroll_started`, `totp_enrolled`, `totp_enroll_failed`, `passkey_ok`, `passkey_failed`, `passkey_registered`, `passkey_removed`, `passkey_suspended`, `session_revoked`, `signed_out`, `revoked_all`, `invite_accepted`, `recovery_requested`, `password_reset`, `demo_sign_in` |
| `team.` | `invited`, `updated`, `owner_bootstrapped` |
| `token.` | `created`, `revoked` |
| `security.` | `member_access_revoked`, `totp_secrets_sealed` |
| `jit.` | `requested`, `approved`, `denied`, `revoked`, `expired` |
| `task.`, `doc.` | `created`, `updated`, `deleted`, `linked`; `doc.version_snapshot` |
| `deploy.`, `incident.` | `requested`, `approved`, `rolled_back`; `declared`, `updated`, `auto_opened`, `action_added`, `action_updated`, `action_completed`, `action_reopened`, `action_removed` |
| `onboarding.`, `offboarding.` | `nda_signed`, `profile_completed`; offboarding steps and completion |
| `channel.`, `message.`, `workspace.`, `notification.` | collaboration changes (never message bodies) |
| `repo.`, `pr.`, `github.`, `code_findings.` | linking repositories, review decisions, applied webhook deliveries |
| `monitor.`, `integration.`, `webhook.` | monitor changes and checks, connecting integrations, outbound webhook subscriptions and failures |
| `file.` | `upload_requested`, `uploaded`, `rejected`, `download_issued`, `swept` |
| `backup.` | `created`, `pruned`, `drill_passed`, `drill_failed`, restores |
| `ml.`, `assistant.` | `export`, `train.requested`, `train.failed`; `asked` (length and outcome, never the question) |
| `console.`, `codespace.` | `query`; `created`, `start`, `stop` |

Task comments, subtasks and time logs are recorded as **task events**
(`db.taskEvents`, served by `GET /api/tasks/_activity`), not as audit entries.
Sign-in attempts are also kept separately as sign-in records
(`GET /api/locations/sign-ins`).

## Reading it

```console
$ curl -s -b owner 'http://localhost:8080/api/audit?limit=3'
[{"seq":14,…,"action":"jit.approved",…},{"seq":13,…,"action":"jit.requested",…},{"seq":12,…,"action":"deploy.approved",…}]
```

`GET /api/audit` returns newest first. Query parameters: `limit` (default 200,
max 500), `sensitive=1`, `actor=<memberId>`, `action=<prefix>` (e.g.
`action=deploy.`). The filters apply after the limit, so `limit` bounds the
window that is searched.

`GET /api/audit/verify` recomputes this boot's chain (`live`) and re-reads the
durable store end to end across every boot (`store`). It returns `ok`,
`brokenAt` (the first broken `seq`) and `continuity`, which says how this boot
started. `GET /api/ready` includes the live result as `auditChain` and returns
`503` when it is broken. An offline verifier,
`Backend/scripts/verify-audit.ts`, checks a file, a database export or the
archive. See [Audit verification](../operations/audit-verification.md).

The web app's **Audit log** page (Owner only in the UI) and each member's
detail page read this endpoint. Live entries also stream over
`GET /api/_events` as `event: audit`, to Administration ≥ `view` only.

## Where it is stored

- In memory: this boot's entries, the chain that `verify()` checks from the
  stored head the boot resumed from.
- Appended to `AUDIT_LOG_FILE` (default `./.audit/audit.jsonl`), one JSON
  entry per line, in chain order. The file keeps history across restarts as
  one chain.
- With PostgreSQL, mirrored into the append-only `audit_entries` table, one
  `chain_id` per boot. The table is the store a boot resumes from when
  `DATABASE_URL` is set. Without it, the file is.
- Archived in batches to the write-once audit bucket (`S3_BUCKET_AUDIT`,
  Object Lock), with each batch linked to the previous one by hash. See
  [Audit verification](../operations/audit-verification.md).

## Across restarts

On boot, before anything else is audited, the server reads the durable store
and verifies it end to end. It then continues the chain, so restart
boundaries are covered by the hashes like any other entry:

```text
… seq 4179 task.updated            ← last entry of the previous boot
  seq 4180 server.stopping
  seq 4181 audit.chain_resumed     prevHash = hash of 4180 (new boot)
  seq 4182 server.started
```

If the store cannot be read, or is already broken, the boot still goes ahead.
Its first entry is then a sensitive `audit.chain_discontinuity` that says
why, and `/api/audit/verify` reports it, so a fresh start is never silent.
Data written by v2.0.0, which started a new chain at every boot, still
verifies, and the first v2.1 boot links to it. Design:
[ADR 0008 addendum](../architecture/adr/0008-hash-chained-audit-log.md#addendum-v21-one-chain-across-restarts).

Access: the API returns the trail only to Administration ≥ `view` (Owner,
Operations); other roles get `403 forbidden` (see [Roles and permissions](roles-and-permissions.md#routes-open-to-every-signed-in-member)).
