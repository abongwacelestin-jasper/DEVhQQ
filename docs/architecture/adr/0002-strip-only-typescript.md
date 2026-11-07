# 0002. Run TypeScript with Node's type stripping, no build step

- **Status:** Accepted, implemented
- **Date:** 2026-10-30 (recorded 2026-11-07)

## Context

The backend is written in TypeScript for type safety, but a compile step adds
a build artefact that can drift from the source, a second configuration to
keep secure, and a slower edit–run loop. Node 22.6 added
`--experimental-strip-types`, which runs `.ts` files by erasing type
annotations without transforming anything else.

## Decision

Run the backend directly from source:

```bash
node --experimental-strip-types server.ts     # npm run dev / npm start
```

`tsc --noEmit` is used only as a checker (`npm run typecheck`). The compiler
options that make the checker agree with the runtime are in
`Backend/tsconfig.json`: `allowImportingTsExtensions` (imports name the real
`.ts` file), `verbatimModuleSyntax` (type-only imports must say
`import type`), `isolatedModules` and `noEmit`. The same approach is used for
the docs scripts (`docs/scripts/*.ts`).

## Consequences

- What runs is exactly what is reviewed. There is no `dist/` for the backend.
- Only *erasable* TypeScript is allowed. Node rejects, at load time with
  `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`:
  - `enum` and `const enum` — use a union of string literals plus an `as const`
    array;
  - `namespace` / `module` blocks with values;
  - constructor parameter properties (`constructor(readonly code: string)`) —
    assign fields in the body, as `HttpError` in `Backend/types.ts` does;
  - legacy decorators;
  - `import x = require()` and `export =`.
- Imports must include the `.ts` extension (`import { db } from
  '../store/db.ts'`), and type-only imports must be written `import type`, or
  Node tries to load a binding that no longer exists at runtime.
- Wave 0 found this the hard way: the API could not boot because `HttpError`
  used parameter properties (BOARD T0.1), and `typecheck` reported 133 errors
  until the two compiler flags above were added (T0.6).
- Node 22.6 or newer is required (`engines` in `Backend/package.json`). Newer
  Node versions accept the flag as well.
- The frontend is unaffected: Vite compiles it, so it may use any TypeScript
  syntax, though the codebase avoids enums there too.

## References

- `Backend/tsconfig.json`, `Backend/types.ts` (`HttpError`)
- [Troubleshooting: strip-types errors](../../getting-started/troubleshooting.md#err_unsupported_typescript_syntax)
- `docs/agents/BOARD.md` Wave 0, T0.1 and T0.6
