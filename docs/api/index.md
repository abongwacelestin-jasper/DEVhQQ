# API

The DevHQ API is JSON over HTTPS, served by the backend under `/api`. In
development it listens on `http://localhost:8080`, and the web app reaches it
through the Vite proxy at `http://localhost:5173/api`.

| Guide | Covers |
|---|---|
| [Authentication](authentication.md) | sign-in, cookie vs bearer token, partial sessions, step-up, token rotation |
| [Errors](errors.md) | the error envelope, request ids, how to handle each class of error; the generated [error-code catalogue](error-codes.md) |
| [Pagination](pagination.md) | which lists page and how |
| [Rate limits](rate-limits.md) | buckets, headers, production vs development numbers |
| [Webhooks](webhooks.md) | inbound GitHub and outbound integration webhooks (planned) |
| [Reference](reference.md) | every route, generated from the live route table |

## Conventions

- **Requests.** Bodies must be `application/json` (anything else with a body
  is `415`), at most `MAX_BODY_BYTES` (256 KB by default, `413` above). Every
  body is validated against an allow-list schema: unknown fields are rejected
  with `422 validation_failed`, so a client cannot slip `"role":"Owner"` into
  an update:

  ```json
  {"error":{"code":"validation_failed","message":"body has unknown field(s): role","requestId":"efb9fa8f-…"}}
  ```

- **Responses.** JSON with `Content-Type: application/json; charset=utf-8`,
  except the console HTML, fonts, the SSE stream and Prometheus metrics.
  `201` for creates (task creation also sets `Location`), `204` with no body
  when a handler returns nothing (deletes, sign-out).
- **Ids.** Members `m1`…, projects `p1`…, tasks `RB-212`, incidents `INC-31`,
  deployments `d-xxxxxx`, docs `doc-…`. Task and incident ids are
  case-insensitive in paths.
- **Timestamps** are ISO 8601 strings in UTC, except a few epoch-millisecond
  numbers on JIT grants (`requestedAt`, `expiresAt`) and `verifiedAt` in
  capabilities.
- **Every response** carries `X-Request-Id`, the security headers and
  `Cache-Control: no-store`.
- **Discovery.** `GET /api/openapi.json` (public, OpenAPI 3.1, paths and auth
  only — no body schemas), `GET /api/_inventory` (signed in),
  `GET /api/_status-codes` (public).

```console
$ curl -s http://localhost:8080/api/openapi.json | head -c 200
{"openapi":"3.1.0","info":{"title":"DevHQ API","version":"1.4.0","description":"Zero-trust API for DevHQ. Generated from the live route table."},"servers":[{"url":"http://localhost:8080"}],…
```

## Live events

`GET /api/_events` is a Server-Sent Events stream for signed-in members. It
sends `event: hello` on connect, then one event per bus message — types
`audit`, `signin`, `task`, `deployment`, `incident`, `team` — with a JSON
`data` line `{type, at, data}`, and a comment ping every 15 s. It is not
filtered by product today.

> [!NOTE]
> **Planned: Wave 4.** New contracts from `docs/agents/WAVE4.md` §6: list
> endpoints return `{items: […], nextCursor?}`; integrations without
> configuration answer `503 {code: "integration_unconfigured"}`; new modules
> for repositories, pull requests, CI runs, the GitHub App and webhook,
> monitors, integrations, channels and messages, workspaces, notifications,
> onboarding, account recovery, doc versions and comments, offboarding,
> personal access tokens, files, insights and the assistant. They appear in
> the generated [reference](reference.md) as they merge.
