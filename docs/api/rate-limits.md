# Rate limits

Token buckets (`Backend/security/rateLimit.ts`). A bucket holds up to
*capacity* tokens, refills continuously at *refill/s*, and each request takes
one. Design notes and the tests are in
[docs/security/CONTROLS.md](../security/CONTROLS.md#rate-limiting).

| Bucket | Applies to | Keyed by | Development | Production |
|---|---|---|---|---|
| `api` | every request, including unknown paths | client IP, plus the session or PAT when known | 600 burst, 20/s | 120 burst, 2/s |
| `auth` | sign-in, MFA and enrolment, step-up, demo sign-in, passkey options/verify, TOTP enrolment, invite preview and accept | client IP **and** the account named in the body (`email`) | 60 burst, 1/s | 10 burst, 0.1/s |
| `acct` | second-factor routes after authentication (TOTP, step-up, passkey, enrolment) | member id, across all sessions and IPs | 30 burst, 1/s | 5 burst, one per 30 s |
| `collab-post` | posting messages | member | 20 burst, 0.5/s | same |
| `recovery-ip`, `recovery-email`, `recovery-reset` | `POST /api/auth/recovery/request` and `/reset` | IP; per email (silently: still `202`, no mail); IP for reset | IP 20 burst / email 3 per 15 min / reset 30 burst | IP 5 burst, one per minute / email 3 per 15 min / reset 10 burst, one per 30 s |
| assistant | `POST /api/assistant/ask` | member | 6 per minute | same |

The `auth` key on the account means rotating IPs does not buy more guesses
against one account; the `acct` bucket is what bounds TOTP guessing. The
numbers are constants in `Backend/config/env.ts` and the modules named above;
`GET /api/_config` shows the effective `api`/`auth` values.

## Headers and errors

Every limited response carries `RateLimit-Remaining`. When a bucket is empty
(production-mode API, ten bad sign-ins in a row):

```console
401 401 401 401 401 401 401 401 401 429 429
$ curl -si -X POST https://<api>/api/auth/sign-in …
HTTP/1.1 429 Too Many Requests
RateLimit-Remaining: 0
Retry-After: 7
{"error":{"code":"rate_limited","message":"Too many requests — slow down","requestId":"f1c9147d-…"}}
```

Wait `Retry-After` seconds. Both headers are exposed to browser code through
CORS.

## Other abuse limits

- Five consecutive wrong passwords lock an account for 15 minutes
  (`423 locked`), independent of IP.
- Request bodies are capped at `MAX_BODY_BYTES` (256 KB); uploads go straight
  to object storage instead.
- At most 5 realtime streams per member and 2,000 in total
  ([Realtime](realtime.md)).
- Slow clients: headers within 10 s, the whole request within 30 s.

## Operating notes

- The client IP is the socket address, or the first `X-Forwarded-For` entry
  with `TRUST_PROXY=1`. The Compose edge overwrites that header, so set
  `TRUST_PROXY=1` there and nowhere else.
- Buckets live in memory per process. With more than one backend replica a
  shared store must be installed with `setRateLimitStore()`; until then, run
  one replica ([Known limits](../operations/known-limits.md)).
- `GET /api/security/rate-limits` lists the 50 most-drained buckets.
