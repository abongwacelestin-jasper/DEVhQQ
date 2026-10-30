# Packet S1 — Supervisor / release gate

**You own:** verification, not implementation. **You may edit:**
`docs/agents/BOARD.md` (verification log + statuses) only. **You may not edit:**
`Backend/`, `Frontend/`. If a check fails you report it and send the task back
to its lane. You never fix code, and you never relax a check to make a build
pass.

## What you are gating

Every task in `BOARD.md`. A task is accepted only on **two consecutive clean
passes on fresh processes**. Anything else is `❌ failed gate` with the exact
failing command quoted.

## Gate procedure (run in this order, record each result)

### Gate 0 — Environment

```bash
node -v                       # expect >= 22.6
cd Frontend && npm install    # must exit 0  (this failed before T0.4: EINVALIDPACKAGENAME)
```

### Gate 1 — Cold boot (backend)

```bash
cd Backend
npm run typecheck             # expect 0 errors
(PORT=8099 npm run dev > /tmp/gate1.log 2>&1 &) ; sleep 3
curl -fsS localhost:8099/api/health          # {"ok":true,...}
curl -fsS localhost:8099/api/ready           # {"ready":true,...,"auditChain":"intact"}
grep -q "listening" /tmp/gate1.log           # route count must be >= 78
```

A crash on boot previously looked like `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` —
read the log, quote the line.

### Gate 2 — Behaviour walkthrough

Use `curl` with `-H 'X-DevHQ-Client: console'` so tokens come back in the body,
or a cookie jar. Assert on **status codes and error codes**, not on prose.

1. `POST /api/auth/demo {role}` for all six roles → 200 each.
2. `POST /api/auth/sign-in` (`kofi@techorg.io` / `devhq-demo`) → 200 with
   `next`; then `GET /api/tasks` with that partial token → **401
   `mfa_required`**.
3. `POST /api/auth/mfa/totp {code:"246810"}` → 200; `GET /api/tasks` → 200 and
   **every** item is `product: "renewberry"`.
4. `GET /api/tasks/BL-17` as that developer → **404** (never 403).
5. `POST /api/tasks` → 201; `PATCH` with an unknown field (`{"role":"Owner"}`) →
   **422**.
6. Self-close: `PATCH` own task to `done` as a non-manager → **403
   `self_close`**.
7. `POST /api/deployments` then approve it as the same member → **403
   `self_approval`**.
8. Approve as another member of role `Operations` **without** step-up → **401
   `step_up_required`**; after `POST /api/auth/step-up` → 200.
9. `POST /api/_query {from:"members",select:["passwordHash"]}` → **422**.
10. `GET /api/audit/verify` → `{"ok":true}` **after** every write above.
11. Wrong password and unknown email → same status **and** same `error.code`.
12. `GET /console` → 200 HTML; `GET /api/openapi.json` → 200 with a `paths`
    object containing every registered route.

### Gate 3 — Frontend

```bash
cd Frontend
npm run typecheck     # contract: 0 errors. Baseline before Wave 0 was 187 (162 unused-React, 25 real).
npm run build         # exit 0
```

`npx vite build` succeeding is **not** proof of a working type: `tsc` is the
type gate and must be zero by Wave 2. Record the count if it is not zero, and
mark the task as failed rather than "mostly passing".

### Gate 4 — Browser-level behaviour (once Wave 1 lands)

With both servers up at 5173/8080 through the proxy: for each of the six demo
roles — sign in, reload (session must survive), open two of that role's pages,
perform one write, sign out. Record which role/page pairs were exercised. A
blank page or a console error is a failure even if the write worked.

### Gate 5 — Repeat

Kill both servers. Re-run Gates 1–4 from scratch. **The second pass is the
acceptance run.** A flake is a failure: the cause must be fixed.

## Failure report format

```
TASK:      T2.1
GATE:      2.6
COMMAND:   curl -s -X PATCH … -d '{"status":"done"}'
EXPECTED:  403 self_close
ACTUAL:    200 {…}
LOG:       copy the relevant 3 lines
VERDICT:   ❌ send back to F2
```

## Things you must call out even when they "pass"

- Any check that is skipped, disabled, or asserted with a weaker condition than
  the packet states.
- Any `try/catch` that swallows an API error, or a `.catch(() => {})` on a
  write.
- A migrated page that still imports a seed file
  (`grep -r "data/<name>'" Frontend/src`).
- A client-side permission check that does not exist server-side (security
  theatre in reverse).
- Any test that passes only because the backend is not running.
- Rate-limit surprises: dev limits are 600 burst / 20 rps per IP — a page that
  fans out more than that per visit will 429 in the gate and must be batched,
  not retried.
