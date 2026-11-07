# Rate limits

Token buckets, in memory, per API process (`Backend/security/rateLimit.ts`).
A bucket holds up to *capacity* tokens, refills continuously at *refill/s*,
and each request takes one.

| Bucket | Applies to | Development | Production |
|---|---|---|---|
| `api` | every request, including unknown paths (global middleware) | 600 burst, 20/s | 120 burst, 2/s |
| `auth` | sign-in, MFA, step-up, demo sign-in, passkey options/verify, invite preview and accept | 60 burst, 1/s | 10 burst, 0.1/s (one every 10 s) |

Auth routes are charged to both buckets. The numbers come from
`Backend/config/env.ts` and are not configurable by environment variable;
`GET /api/_config` shows the effective values.

## Keys

Buckets are keyed by client IP: the socket address, or the first
`X-Forwarded-For` entry when `TRUST_PROXY=1`. The limiter also supports a
per-session key, but it only applies when a limiter runs after
`authenticate`, and none does today.

## Headers and errors

Every limited response carries `RateLimit-Remaining`. When a bucket is empty:

```console
$ for i in $(seq 1 11); do curl -s -o /dev/null -w '%{http_code} ' -X POST https://<api>/api/auth/sign-in \
    -H 'content-type: application/json' -d '{"email":"nobody@techorg.io","password":"x"}'; done
401 401 401 401 401 401 401 401 401 429 429
$ curl -si -X POST https://<api>/api/auth/sign-in …
HTTP/1.1 429 Too Many Requests
RateLimit-Remaining: 0
Retry-After: 7
{"error":{"code":"rate_limited","message":"Too many requests — slow down","requestId":"f1c9147d-…"}}
```

(A local API started with `NODE_ENV=production`; one token of the ten had gone
to an earlier auth call.)

Wait `Retry-After` seconds before retrying. Both headers are in the CORS
`Access-Control-Expose-Headers` list, so browser code can read them.

## Other abuse limits

- Five consecutive wrong passwords lock an account for 15 minutes
  (`423 locked`), independent of IP.
- Request bodies are capped at `MAX_BODY_BYTES` (256 KB).
- Slow clients: headers within 10 s, the whole request within 30 s.

## Operating notes

- Buckets idle for 10 minutes are evicted. `GET /api/security/rate-limits`
  lists the 50 most-drained buckets.
- Behind a load balancer each instance has its own buckets; the code comment
  says to back the limiter with a shared store (e.g. Redis) for more than one
  instance. Not done.
- Without `TRUST_PROXY=1` behind a proxy, every client shares the proxy's IP
  and therefore one bucket. With it but without a proxy that overwrites
  `X-Forwarded-For`, clients choose their own key.
