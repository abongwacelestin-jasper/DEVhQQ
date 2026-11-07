# Errors

## The envelope

Every error response, from every route, has the same shape
(`Router.handle` in `Backend/lib/http.ts`):

```json
{"error":{"code":"not_found","message":"Not found","requestId":"9f88bc6f-63ba-4182-8a20-3eba33d78ae8"}}
```

| Field | Always | Use it for |
|---|---|---|
| `code` | yes | branching in code. Stable, `snake_case`. |
| `message` | yes | showing a person. May change; never parse it. |
| `requestId` | yes | support and debugging. Same value as the `X-Request-Id` header, the request's log line and any audit entry it wrote. |
| `details` | sometimes | structured extras, e.g. `{"retryAfterSec": 840}` for `locked`, `{"reasons": […]}` for `risk_blocked`. |

The complete list of codes, generated from the source, is in
**[Error codes](error-codes.md)**.

Messages never contain stack traces or internal state: an exception that is
not an `HttpError` becomes `500 internal` / `Unexpected error`, and the stack
trace is logged server-side under the same request id.

Some failures are decided before your request reaches a handler, in this
order: `405` (wrong method), `413`/`415`/`400` (body), `403 bad_origin`,
`429` (API rate limit), then the route's guards. A `405` is produced before the
security headers are added.

## Status classes and what to do

| Status | Codes (examples) | Meaning | Retry? |
|---|---|---|---|
| `400` | `invalid_json`, `invite_invalid`, WebAuthn format errors | malformed request | no; fix the request |
| `401` | `unauthenticated`, `session_*`, `mfa_required`, `step_up_required` | who you are is not established (enough) | after re-authenticating or step-up; see [Authentication](authentication.md#status-codes-you-will-see) |
| `403` | `forbidden`, `bad_origin`, `self_approval`, `self_close`, `risk_blocked` | you are known and this is not allowed | no |
| `404` | `not_found` | does not exist **or is outside your scope** — the API does not distinguish | no |
| `405` | `method_not_allowed` | the path exists with other methods (see `Allow`) | no |
| `409` | `not_pending`, `already_rolled_back`, `last_owner`, `member_exists`, `exists` | conflicts with current state | after re-reading state |
| `410` | `invite_expired` | gone for good | no |
| `413` / `415` | `payload_too_large`, `unsupported_media_type` | body too big / not JSON | no |
| `422` | `validation_failed`, `assignee_invalid`, `weak_password`, `no_change`, … | well-formed but invalid; `message` names the field | no; fix input |
| `423` | `locked` | account locked | after `details.retryAfterSec` |
| `429` | `rate_limited` | too many requests | after `Retry-After` seconds |
| `501` | `not_configured` | an optional integration has no configuration | no |
| `502` / `504` | `upstream_error`, `upstream_timeout` | GitHub failed or timed out (Codespaces proxy) | yes, with backoff |
| `500` | `internal` | bug | report with the `requestId` |
| `503` | — | `GET /api/ready` only: not ready (body `{"ready":false,…}`) | yes |

## Examples

Captured from a local API:

```console
$ curl -s -X POST http://localhost:8080/api/tasks -H 'content-type: text/plain' -d 'hi' -b dev
{"error":{"code":"unsupported_media_type","message":"Expected application/json","requestId":"79eedec9-…"}}

$ curl -s -X POST http://localhost:8080/api/tasks -H 'content-type: application/json' -d '{bad' -b dev
{"error":{"code":"invalid_json","message":"Malformed JSON","requestId":"d097bb58-…"}}

$ curl -si -X DELETE http://localhost:8080/api/health
HTTP/1.1 405 Method Not Allowed
Allow: GET
{"error":{"code":"method_not_allowed","message":"Method not allowed on this route","requestId":"94f50140-…"}}

$ curl -s -X PATCH http://localhost:8080/api/tasks/RB-232 -H 'content-type: application/json' -d '{"status":"done"}' -b dev
{"error":{"code":"self_close","message":"A reviewer or manager must move your own task to done","requestId":"5fa2db61-…"}}
```

## Client guidance

- Branch on `status`, then `code`. Treat unknown codes by status class.
- Show `message` to people; log `requestId` with anything you report.
- Do not retry `4xx` except `401` (after re-authenticating), `409` (after
  refreshing), `423` and `429` (after waiting).
- A `404` for something you expect to exist usually means scope: check the
  member's products.

The web app wraps all of this in `ApiError` (`Frontend/src/api/client.ts`),
with `status`, `code`, `message`, `requestId` and `details`. Network failures
become `ApiError(0, 'network', …)`; that code exists only in the client.

> [!NOTE]
> **Planned: Wave 4.** Optional integrations (GitHub App, SMTP, S3, ML) answer
> `503 {code: "integration_unconfigured"}` when their environment variables are
> missing (`docs/agents/WAVE4.md` §4). The existing Codespaces OAuth route
> answers `501 not_configured` in that situation today.
