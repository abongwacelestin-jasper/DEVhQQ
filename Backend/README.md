# DevHQ API (`@devhq/backend`)

The DevHQ API: Node 22, TypeScript run directly with Node's type stripping,
no build step and no runtime dependencies. It also serves the backend console
at `/console`.

- Architecture: [docs/architecture/overview.md](../docs/architecture/overview.md)
- API reference (generated): [docs/api/reference.md](../docs/api/reference.md)
- Running it: [docs/getting-started/local-development.md](../docs/getting-started/local-development.md)

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `npm start` | `node --experimental-strip-types server.ts` on `PORT` (8080) |
| `npm run start:prod` | the same with `NODE_ENV=production` (needs `SESSION_SECRET`, `APP_ORIGIN`, `WEBAUTHN_RP_ID`) |
| `npm run typecheck` | `tsc --noEmit` — 0 errors expected |
| `npm run lint` | ESLint, zero warnings allowed |
| `npm run smoke` / `npm test` | boots the app in-process on a random port and runs the end-to-end smoke checks (32 today); exits non-zero on the first failure |
| `npm run format` / `format:check` | Prettier |
| `npm run validate` | typecheck + lint |

`typecheck` does not catch syntax that strip-only mode rejects; only running
the code does. Run `npm run smoke` before you push.

## Layout

```text
Backend/
├── server.ts              entry point: buildApp() seeds, builds the router, registers route modules; main() listens, schedules backups, handles SIGTERM
├── types.ts               shared domain types and HttpError
├── backend.html           the backend console (single page, served with a CSP nonce)
├── fonts/                 self-hosted console webfonts
├── audit/auditLog.ts      hash-chained audit log + JSONL file
├── auth/
│   ├── rbac.ts            permission matrix, can(), requireArea, requireStepUp, requireElevation, assertProduct
│   ├── sessions.ts        session store, continuous verification, rotation, revocation
│   ├── jit.ts             just-in-time production access grants
│   ├── totp.ts            RFC 6238 one-time codes
│   └── webauthn.ts        passkey registration and assertion (node:crypto only)
├── config/env.ts          configuration from the environment; fails closed in production
├── lib/
│   ├── http.ts            Router, request pipeline, error envelope, body parsing
│   ├── validate.ts        allow-list schema validation (v.object, v.string, …), sanitizeForPrompt
│   ├── query.ts           safe JSON query engine for the console
│   ├── geo.ts             offline IP geolocation and sign-in risk scoring
│   ├── events.ts          in-process event bus (SSE source)
│   ├── logger.ts          JSON logger with secret redaction and a ring buffer
│   └── metrics.ts         per-route counters and latency percentiles, Prometheus text
├── middleware/authenticate.ts   builds the principal from cookie or bearer token
├── resilience/backups.ts  immutable snapshots, restore drill, pruning
├── routes/                one module per domain, each exporting registerXRoutes(router)
├── security/
│   ├── headers.ts         security headers, CSP, origin guard (CORS + CSRF)
│   ├── rateLimit.ts       token buckets (api, auth)
│   └── crypto.ts          scrypt passwords, token signing, constant-time compare
├── store/
│   ├── db.ts              in-memory store and demo seed
│   ├── taskActivity.ts    seed task events, comments, subtasks, time logs
│   └── collection.ts      Wave 4 persistence seam (Collection, setDriver, hydrateAll)
└── scripts/smoke.ts       end-to-end smoke test
```

## Conventions

These are enforced in review. Each one exists because a control depends on it.

1. **Register every route through `Router.add`** with a summary and a tag
   (`{ summary, tag, auth?, responses? }`). The route table is the inventory,
   the OpenAPI document and the docs; an unregistered endpoint is a bug.
2. **Guards in the chain, in this order:** `authLimiter` (auth endpoints only)
   → `authenticate` → `requireArea(area, level)` → `requireStepUp()` for
   sensitive actions. A route with no `authenticate` is public; say so with
   `auth: 'public'`.
3. **Validate every body** with `parse(schema, ctx.body)` from
   `lib/validate.ts`. Schemas are allow-lists: unknown fields are rejected.
   Validate query and path parameters you use (patterns, enums, bounds).
4. **Out of scope is `404`, never `403`.** Use `assertProduct(principal,
   product)` or filter with `canSeeProduct`; a resource in a product the caller
   is not assigned to must be indistinguishable from one that does not exist.
5. **Audit every state change**: `audit.append({ actor, action, target,
   sensitive?, requestId: ctx.requestId })`. Mark authentication, access,
   role, production and destructive changes `sensitive: true`. Never put
   secrets in `target`.
6. **Throw `HttpError(status, code, message, details?)`** for expected
   failures, with a stable `snake_case` code. Anything else becomes
   `500 internal` and is logged, not shown. Then run `npm run gen` in `docs/`
   so the [error-code catalogue](../docs/api/error-codes.md) stays current.
7. **Strip-only syntax.** No `enum`, `namespace`, parameter properties or
   decorators. Import with the `.ts` extension and use `import type` for types.
   See [ADR 0002](../docs/architecture/adr/0002-strip-only-typescript.md).
8. **No runtime dependencies** without a decision record
   ([ADR 0001](../docs/architecture/adr/0001-no-framework-backend.md)).
9. **Persist through collections** (Wave 4): create stores with
   `createCollection<T>('name')` from `store/collection.ts`; after an in-place
   mutation call `.save(key)`. Never write SQL in a route module.
10. **No `any`, no `@ts-ignore`, no weakened checks** (BOARD hard rules). An
    `eslint-disable` needs a one-line justification.
11. **Log through `lib/logger.ts`**, never log bodies, tokens or passwords.

## Adding a route

1. Create or open `routes/<domain>.routes.ts` and export
   `registerXRoutes(r: Router)`.
2. Add the route:

   ```ts
   r.add(
     'POST',
     '/api/widgets',
     { summary: 'Create a widget', tag: 'widgets', responses: [401, 403, 404, 422] },
     authenticate,
     requireArea('Project', 'contribute'),
     (ctx) => {
       const body = parse(createBody, ctx.body);           // 422 on bad input
       assertProduct(ctx.principal!, body.product);        // 404 out of scope
       const w = { id: `w-${randomToken(6)}`, ...body };
       widgets.set(w.id, w);                               // a Collection
       audit.append({
         actor: ctx.principal!.memberId,
         action: 'widget.created',
         target: w.id,
         requestId: ctx.requestId,
       });
       publish('widget', { id: w.id });
       ctx.status = 201;
       return w;
     },
   );
   ```

   Register static paths before parameterised siblings
   (`/api/widgets/_stats` before `/api/widgets/:id`); matching is first-wins.
3. If the module is new, add one `registerXRoutes(router)` line (and its
   import) after the existing ones in `server.ts`.
4. Add checks to `scripts/smoke.ts` in a clearly labelled block: the happy
   path and at least one refusal (wrong role → `403`, other product → `404`,
   bad body → `422`). Never remove or relax an existing check.
5. Run `npm run typecheck && npm run lint && npm run smoke`, then
   `cd ../docs && npm run gen && npm run check` and commit the regenerated
   reference.
