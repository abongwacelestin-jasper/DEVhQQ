# Monitoring

## Probes (public)

| Endpoint | Use | Healthy | Unhealthy |
|---|---|---|---|
| `GET /api/health` | liveness: is the process serving? | `200 {"ok":true,"uptimeSec":4}` | no response |
| `GET /api/ready` | readiness: store seeded **and** audit chain intact | `200 {"ready":true,"members":12,"auditChain":"intact"}` | `503 {"ready":false,…}` |
| `GET /api/version` | which build is running | `{"version":"1.4.0","env":"development","node":"v24.22.0","startedAt":"…"}` | — |

Probes go through the global rate limiter like every request; with
`TRUST_PROXY=1` the probe's own IP is used, so a busy load balancer health
checker should come from an address that is not shared with clients.

## Metrics (signed in)

`GET /api/_metrics` returns JSON: uptime, total requests, status-code mix,
memory, and per route (`"METHOD /path"` as registered) the count, 5xx count,
status mix and p50/p95/p99 latency in ms over the last 200 requests.

```console
$ curl -s -b owner http://localhost:8080/api/_metrics | head -c 300
{"uptimeSec":66,"totalRequests":41,"statuses":{"200":20,"201":2,"400":1,"401":5,"403":7,"404":2,"405":1,"409":1,"415":1,"422":1},"memoryMb":{"rss":108.72,"heapUsed":17.04},"routes":[{"route":"POST /api/tasks","count":5,…
```

`GET /api/_metrics?format=prometheus` returns the text exposition format:

```text
# HELP devhq_requests_total Requests by route and status
# TYPE devhq_requests_total counter
devhq_requests_total{route="GET /api/health",status="200"} 1
devhq_requests_total{route="GET /api/tasks",status="401"} 2
…
```

The endpoint needs a session, so a Prometheus scraper needs a bearer token
today; the session expires after 12 h. Unmatched paths are counted under the
route `unmatched`.

> [!NOTE]
> **Planned: Wave 4 (SEC).** Personal access tokens with an expiry are the
> intended credential for scrapers and scripts.

What to alert on (from the code comments: these numbers are how DevHQ tracks
time to detect):

- 5xx rate per route (`errors` / `count`).
- Spikes in `401` and `429` — credential stuffing or a broken client.
- `/api/ready` returning `503` — the audit chain is broken.
- Mean time to recover: `GET /api/incidents/_stats` →
  `{"open","resolved","mttrMinutes","bySeverity"}`.

## Logs

The API writes one JSON object per line: `info`/`debug` to stdout,
`warn`/`error` to stderr. Every request produces

```json
{"t":"2026-11-07T00:37:18.677Z","level":"info","msg":"request","requestId":"5b7f6211-…","method":"GET","path":"/api/audit/verify","status":200,"ms":0.9,"ip":"127.0.0.1","member":"m4"}
```

except the long-lived `/api/_events` stream. Any field whose name matches
password, secret, token, authorization, cookie, signature, code or totp is
replaced with `[redacted]` before writing. `LOG_LEVEL` sets the threshold.

The last 500 lines are kept in memory: `GET /api/_logs?level=&q=&limit=`.

## Live views

- `GET /api/_events` — Server-Sent Events of audit, sign-in, task, deployment,
  incident and team events.
- `GET /api/security/posture` — active members, passkeys, live sessions,
  locked accounts, rate-limit settings, inventoried routes, active and pending
  JIT grants, crypto settings, audit chain and backup status.
- `GET /api/security/rate-limits` — the 50 most-drained buckets.
- The backend console (`/console`) charts all of the above.

All of these are open to any signed-in member today; see
[Roles and permissions](../concepts/roles-and-permissions.md#routes-open-to-every-signed-in-member).

Metrics, logs, rate limits and events are per process and reset on restart.

> [!NOTE]
> **Planned: Wave 4 (INFRA).** Container health checks, log shipping and the
> deployment's monitoring set-up are documented in `docs/deploy/`.
