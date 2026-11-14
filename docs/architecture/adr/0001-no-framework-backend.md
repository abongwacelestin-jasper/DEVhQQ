# 0001. No web framework: a route table on `node:http`

- **Status:** Accepted, implemented
- **Date:** 2026-10-30 (recorded 2026-11-07)

## Context

The API is the enforcement point for every security control in TavetaHQ:
headers, origin checks, rate limits, authentication, authorisation,
validation and audit. Each npm dependency is code that runs with the API's
privileges, and the repository's `.npmrc` already treats installs as a
supply-chain risk (`ignore-scripts=true`, `audit-level=high`). The API surface
also has to be fully known: an endpoint that exists but is not in the
inventory is a "shadow API" nobody reviews.

## Decision

Build the HTTP layer on `node:http` with a small router of our own
(`Backend/lib/http.ts`, about 250 lines):

- Every endpoint is registered through `Router.add(method, path, meta,
  ...middleware, handler)` with a summary, a tag, an auth mode and the status
  codes it can return.
- The router owns the cross-cutting behaviour: request ids, `405` with
  `Allow`, body size and content-type limits, JSON parsing, the error
  envelope, metrics and the request log line.
- The route table is exposed three ways from the same data:
  `router.inventory()` (also `GET /api/_inventory`), `GET /api/openapi.json`
  (OpenAPI 3.1, built in `Backend/routes/system.routes.ts`) and the generated
  [API reference](../../api/reference.md).
- The backend has one runtime dependency, the PostgreSQL driver `pg`, added
  with ADR [0003](0003-postgres-jsonb-collections.md) and loaded only when
  `DATABASE_URL` is set. Everything else (HTTP, crypto, S3 signing, SMTP,
  WebAuthn) uses Node's standard library.

## Consequences

- A route cannot exist without appearing in the inventory, the OpenAPI
  document, the console and these docs.
- We maintain the router ourselves. Features a framework gives for free —
  content negotiation, streaming bodies, multipart — are absent; handlers that
  need to stream return the `STREAM` sentinel and write to `ctx.res`
  themselves (`/api/_events`, `/console`, fonts, Prometheus metrics).
- Matching is a linear scan of regexes in registration order, so a static path
  must be registered before a parameterised sibling
  (`/api/incidents/_stats` before `/api/incidents/:id`). With about 180 routes
  this costs nothing measurable.
- The OpenAPI document describes paths, auth and status codes but not request
  or response schemas; the validation schemas in the route files are the
  source of truth for bodies.
- Wave 4 lanes add routes by calling `registerXRoutes(router)` once in
  `Backend/server.ts`; nothing else is shared.

## References

- `Backend/lib/http.ts`, `Backend/server.ts`, `Backend/routes/system.routes.ts`
- [Architecture overview — request pipeline](../overview.md#request-pipeline)
