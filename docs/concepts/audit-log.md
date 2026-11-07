# Audit log

Every state change in DevHQ is recorded in one append-only log whose entries
are chained by hash, so editing or removing history is detectable. The design
and its trade-offs are in [ADR 0008](../architecture/adr/0008-hash-chained-audit-log.md);
this page is about what is in it and how to read it.

## An entry

```json
{"seq":14,"at":"2026-11-07T00:37:02.009Z","actor":"m11","action":"jit.approved","target":"m4 → production:renewberry","sensitive":true,"prevHash":"211b1793…6cc6","hash":"63116fc7…64e7"}
```

| Field | Meaning |
|---|---|
| `seq` | 1, 2, 3, … within the current process lifetime |
| `at` | ISO timestamp |
| `actor` | member id, or `system` for the server itself (start/stop, backups, JIT expiry) |
| `action` | dotted verb, e.g. `deploy.approved` |
| `target` | human-readable object of the action; never contains secrets |
| `sensitive` | security-relevant; filter with `?sensitive=1` |
| `requestId` | the request that caused it, when there was one — match it with logs and error responses |
| `prevHash` | `hash` of the previous entry (64 zeros for the first) |
| `hash` | SHA-256 of `[seq, at, actor, action, target, sensitive, requestId ?? null, prevHash]` as JSON |

## Actions recorded

From `audit.append` calls in the backend:

| Prefix | Actions |
|---|---|
| `server.` | `started`, `stopping` |
| `auth.` | `demo_sign_in`, `password_ok`, `mfa_ok`, `mfa_failed`, `locked`, `blocked_risk`, `step_up`, `passkey_ok`, `passkey_registered`, `passkey_removed`, `session_revoked`, `signed_out`, `revoked_all`, `invite_accepted` |
| `team.` | `invited`, `updated` (role/products/status, with before → after and the number of sessions revoked) |
| `jit.` | `requested`, `approved`, `denied`, `revoked`, `expired` |
| `task.` | `created`, `updated` (changed field names), `deleted` |
| `doc.` | `created`, `updated`, `deleted` |
| `deploy.` | `requested`, `approved`, `rolled_back` |
| `incident.` | `declared`, `updated` |
| `backup.` | `created`, `pruned`, `drill_passed`, `drill_failed` |
| `console.` | `query` (collection and row count) |
| `codespace.` | `created`, `start`, `stop` |

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

`GET /api/audit/verify` recomputes the chain: `{"ok":true}` or
`{"ok":false,"brokenAt":<seq>}`. `GET /api/ready` includes the result and
returns `503` when it is broken. See
[Audit verification](../operations/audit-verification.md).

The web app's **Audit log** page (Owner only in the UI) and each member's
detail page read this endpoint. Live entries also stream over
`GET /api/_events` as `event: audit`.

## Where it is stored

- In memory, as the chain that `verify()` checks. Empty at every start.
- Appended to `AUDIT_LOG_FILE` (default `./.audit/audit.jsonl`), one JSON
  entry per line, opened in append mode. The file keeps history across
  restarts; each process lifetime starts a new chain at `seq` 1 with the
  genesis `prevHash`.

Access: today any signed-in member can read the whole trail through the API
(see [Roles and permissions](roles-and-permissions.md#routes-open-to-every-signed-in-member)).

> [!NOTE]
> **Planned: Wave 4 (STORAGE).** The audit archive is shipped to
> `S3_BUCKET_AUDIT` with object lock in production.
