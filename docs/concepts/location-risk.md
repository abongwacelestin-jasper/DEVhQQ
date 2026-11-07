# Location risk

Every sign-in is resolved to a location and scored for risk. A high score
blocks the sign-in; a medium score is surfaced to the client as a challenge.
The engine is `Backend/lib/geo.ts`; it runs offline, without sending IPs to a
third party.

## Resolving an IP

`lookupIp(ip)` uses a small built-in longest-prefix table of the regions the
team works from (Lagos, Accra, Berlin, Madrid, Tokyo, Pune, São Paulo, two US
datacenter ranges), plus Tor and VPN ranges, loopback and private networks.
Each entry has a city, country, region, coordinates and a network type:
`residential`, `office`, `datacenter`, `vpn`, `tor`, `loopback` or `unknown`.
Anything not in the table is `Unknown`.

The table is a stand-in. The code comment says to replace it with a MaxMind
GeoLite2 database in production behind the same interface; that is not done,
so most real-world IPs resolve to `Unknown`.

The client IP is the socket address, or the first `X-Forwarded-For` entry when
`TRUST_PROXY=1`.

## Scoring

`assessRisk(location, history)` adds up signals, capped at 100:

| Signal | Points |
|---|---|
| Tor exit node | +70 |
| Datacenter IP ("likely automation") | +30 |
| Anonymising VPN | +25 |
| Impossible travel: more than 500 km from the last successful sign-in at more than 900 km/h | +60 |
| First successful sign-in from this country (when there is history) | +20 |

Loopback, private and unknown locations never count as travel or a new
country.

`riskDecision(score)`:

| Score | Decision | Effect today |
|---|---|---|
| ≥ 70 | `block` | the sign-in is refused with `403 risk_blocked`, recorded as `blocked`, and audited as `auth.blocked_risk` (sensitive) |
| 40–69 | `challenge` | the password response includes `risk: {reasons}`; the second factor is required as always |
| < 40 | `allow` | — |

The score is applied only after a correct password (or a valid passkey
assertion). A `risk_blocked` response therefore tells the caller the password
was right; that is accepted, because only someone who already had it can get
that response, and the attempt is audited as sensitive.

```console
$ curl -s -X POST http://localhost:8080/api/auth/sign-in -H 'content-type: application/json' \
    -H 'X-Forwarded-For: 185.220.101.9' -d '{"email":"yuki@techorg.io","password":"devhq-demo"}'
{"error":{"code":"risk_blocked","message":"Sign-in blocked by location risk policy — contact an Owner","requestId":"c18c6981-…","details":{"reasons":["Tor exit node","First sign-in from Tor network"]}}}
```

(API started with `TRUST_PROXY=1`.)

## Sign-in records

Every attempt — success, failure, challenge, block, demo — becomes a
`SignInRecord` `{id, memberId, at, ip, method, result, location, risk}`
(newest first, the last 2,000 kept). Unknown emails are recorded with
`memberId: "unknown"`. The seed adds ten sample records so the views have data
on first boot.

| Route | Returns |
|---|---|
| `GET /api/locations/me` | where the current request appears to come from |
| `GET /api/locations/lookup?ip=` | resolve any IP |
| `GET /api/locations/regions` | the regions in the table |
| `GET /api/locations/sign-ins` | sign-in history; filters `memberId`, `result`, `country`, `minRisk`, `limit` |
| `GET /api/locations/summary` | counts per country, with failed and risky (score ≥ 40) counts |
| `GET /api/locations/sessions` | live sessions with location |
| `POST /api/locations/assess` `{ip, memberId?}` | dry-run of the engine for an IP; no side effects |

Members see their own records; Administration ≥ `view` (Owner, Operations)
sees everyone's and may pass `memberId`.

```console
$ curl -s -b owner -X POST http://localhost:8080/api/locations/assess -H 'content-type: application/json' \
    -d '{"ip":"185.220.101.4","memberId":"m7"}'
{"ip":"185.220.101.4","memberId":"m7","location":{"city":"Unknown","country":"Tor network","countryCode":"XX","region":"Anonymous","lat":0,"lon":0,"network":"tor"},"risk":{"score":90,"reasons":["Tor exit node","First sign-in from Tor network"]},"decision":"block","fromLast":{"city":"Tokyo","km":14261,"at":"2026-11-05T18:38:26.454Z"}}
```

## Location during a session

Location is not only checked at sign-in. A session whose client IP changes is
kept but loses its recent verification, so the next sensitive action needs a
[step-up](step-up.md); its stored location is updated.

## Model score

`GET /api/insights/signins/:id` adds an anomaly score from the ML service
(`source: "model"`, IsolationForest per organisation) next to these rules, and
falls back to the rules (`source: "heuristic"`) when the service is
unavailable. The score is advisory: sign-ins are still allowed, challenged or
blocked by `riskDecision()` above. See [ML](../ml/index.md).
