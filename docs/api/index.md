# API

The TavetaHQ API is JSON over HTTPS, served by the backend under `/api`. Behind
the Compose edge it shares the web app's origin (`https://<DEVHQ_DOMAIN>/api`);
in local development it listens on `http://localhost:8080`, and the web app
reaches it through the Vite proxy at `http://localhost:5173/api`.

| Guide | Covers |
|---|---|
| [Authentication](authentication.md) | sign-in, first-factor enrolment, passkeys, cookie vs CLI bearer token, personal access tokens, step-up, token rotation |
| [Errors](errors.md) | the error envelope, request ids, how to handle each class of error; the generated [error-code catalogue](error-codes.md) |
| [Pagination](pagination.md) | `{items, nextCursor}` lists and the older offset style |
| [Rate limits](rate-limits.md) | buckets, keys, headers, production vs development numbers |
| [Realtime](realtime.md) | `GET /api/stream` vs `GET /api/_events` |
| [Webhooks](webhooks.md) | inbound GitHub webhooks and outbound integration webhooks |
| [Reference](reference.md) | every route (181 today), generated from the live route table |

## Conventions

- **Requests.** Bodies must be `application/json` (anything else with a body
  is `415`), at most `MAX_BODY_BYTES` (256 KB by default, `413` above). File
  bytes never go through the API; see [Storage](../operations/storage.md#file-uploads).
  Every body is validated against an allow-list schema: unknown fields are
  rejected with `422 validation_failed`, so a client cannot slip
  `"role":"Owner"` into an update:

  ```json
  {"error":{"code":"validation_failed","message":"body has unknown field(s): role","requestId":"efb9fa8f-…"}}
  ```

- **Responses.** JSON with `Content-Type: application/json; charset=utf-8`,
  except the console HTML, fonts, the two SSE streams and Prometheus metrics.
  `201` for creates, `204` with no body when a handler returns nothing.
- **Optional integrations** (GitHub, SMTP, ML, the assistant, object storage)
  answer `503 {code: "integration_unconfigured"}` when their configuration is
  missing. Outside production the GitHub routes return clearly labelled demo
  data (`source: "demo"`) instead.
- **Ids.** Members `m1`…, projects `p1`…, tasks `RB-212`, incidents `INC-31`,
  deployments `d-xxxxxx`, docs `doc-…`, backups `bk-…`, tokens: 16 hex
  characters. Task and incident ids are case-insensitive in paths.
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
{"openapi":"3.1.0","info":{"title":"TavetaHQ API","version":"1.4.0","description":"Zero-trust API for TavetaHQ. Generated from the live route table."},"servers":[{"url":"http://localhost:8080"}],…
```

Security controls, mapped to code and tests, are in
[docs/security/CONTROLS.md](../security/CONTROLS.md); the threat model is
[docs/security/THREAT_MODEL.md](../security/THREAT_MODEL.md).
