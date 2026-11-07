# Realtime

Two Server-Sent Events streams exist. Both need authentication and both filter
every event against the subscriber's access **at delivery time**, so a role,
product or membership change takes effect on the next event.

| | `GET /api/stream` | `GET /api/_events` |
|---|---|---|
| For | the web app's messaging and notifications (`Frontend/src/components/messaging/useRealtime.ts`) | the backend console, and the web app's engineering pages for product events (`Frontend/src/components/engineering/data/events.ts`) |
| Events | `channel.created`, `channel.updated`, `channel.removed`, `message.created`, `message.updated`, `message.deleted`, `notification.created`, `notification.read` | `audit`, `signin`, `team`, `member.*`, `auth.*`, `security.*`, `token.*`, `jit.*` (security); `task`, `deployment`, `incident`, `monitor`, `repo`, `pull_request`, `ci`, `code_finding`, `integration` (product) |
| Who receives what | channel events: only if you can read the channel now (membership, privacy and product re-checked per event); notifications: only the addressed member | security events: Administration ≥ `view`; product events: members who can see that product; anything else: nobody |
| Code | `Backend/domain/collab/realtime.ts` | `Backend/routes/system.routes.ts`, `Backend/security/eventPolicy.ts` |

Message bodies never travel over `/api/_events`; collaboration events do not
touch the global bus at all.

## `GET /api/stream`

```text
retry: 5000
event: hello
data: {"member":"m4","at":"2026-11-07T05:40:23.100Z"}

id: 42
event: message.created
data: {"type":"message.created","at":"…","data":{…}}
```

- Each event has an `id`. On reconnect, send `Last-Event-ID` to replay recent
  events you can still read (the server keeps the last 500).
- A heartbeat runs every `STREAM_HEARTBEAT_MS` (15 s). Each beat also checks
  that your session still exists and your account is active, so revoking a
  session or deactivating a member closes their streams within one beat.
- At most 5 open streams per member (the oldest is closed with
  `event: end` / `{"reason":"superseded"}`) and 2,000 overall. A client that
  does not read fast enough (more than 512 KB unsent) is dropped with
  `slow_consumer`.
- Browsers connect with `new EventSource('/api/stream')`; the session cookie
  is sent automatically on the same origin.

## `GET /api/_events`

Sends `event: hello` on connect, then `event: <type>` with
`data: {type, at, data}` for each bus event the subscriber may see, and a
comment ping every 15 s. A product event whose product cannot be determined is
not delivered. A new event type stays invisible until it is added to the
policy.

Both streams are per backend process; see
[Known limits](../operations/known-limits.md#run-exactly-one-backend-replica).
