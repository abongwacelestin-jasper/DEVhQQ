# ML and the assistant

## Today

There are no models. `Models/` is a placeholder npm package: `Models/index.ts`
and scripts that only print a message, plus empty `Models/data/` and
`Models/models/` directories. Nothing in the backend or the web app calls it.

What exists instead:

- **Sign-in risk** is rule-based (`Backend/lib/geo.ts`): Tor, VPN and
  datacenter networks, impossible travel, first sign-in from a country. See
  [Location risk](../concepts/location-risk.md).
- **Task signals** are computed on read: `overdue` (not done and past due) on
  every task, late-task counts per product in `/api/products`.
- **The assistant panel** in the web app (`Frontend/src/components/assistant/`,
  `Frontend/src/data/assistant.ts`) answers from canned content in the browser.
  It does not call a model.
- `sanitizeForPrompt()` in `Backend/lib/validate.ts` is ready for text that
  will be forwarded to a model.

## Planned

> [!NOTE]
> **Planned: Wave 4 (ML).** A Python service replaces the placeholder
> ([ADR 0005](../architecture/adr/0005-separate-python-ml-service.md)). Its own
> guide will be `Models/README.md`, written by the ML lane.
>
> | Capability | Backend route | Python endpoint | Fallback |
> |---|---|---|---|
> | Task ETA and overdue risk | `GET /api/insights/tasks/:key` | `POST /v1/predict/task-eta`, `/v1/predict/overdue` | heuristic |
> | Deployment risk | `GET /api/insights/deployments/:id` | `POST /v1/predict/deploy-risk` | heuristic |
> | Sign-in anomaly | `GET /api/insights/signins/:id` | `POST /v1/score/signin-anomaly` | rules in `Backend/lib/geo.ts` |
> | Assistant | `POST /api/assistant/ask` `{question, scope?}` → `{answer, sources[], model}`; optional SSE `POST /api/assistant/ask/stream` | `POST /v1/assistant/answer` | — |
> | Training | — | `POST /v1/train/{model}` | — |
>
> - Every response says where it came from: `source: 'model' | 'heuristic'`.
> - The service listens on port 8000 on the internal network only and checks an
>   HMAC signature on every request (`ML_SERVICE_TOKEN`, header
>   `X-DevHQ-Signature`, timestamp with 5-minute skew). The backend reaches it
>   at `ML_SERVICE_URL`.
> - The assistant calls the Anthropic API with `ANTHROPIC_API_KEY` and
>   `ASSISTANT_MODEL` (default `claude-sonnet-5-5`) from the Python service; the
>   key never reaches the backend's responses or the browser.
> - Trained artefacts are stored in `S3_BUCKET_MODELS`.
> - Code: `Models/`, `Backend/integrations/ml/`,
>   `Backend/routes/insights.routes.ts`, `Backend/routes/assistant.routes.ts`.

## Rules the planned design keeps

- The backend authorises and scopes **before** sending anything to the model
  service, so the assistant can only cite data the caller could already open,
  and its `sources[]` let the user check.
- Model output is untrusted input: rendered as text, never executed, never
  used to make an authorisation decision.
- Without the service or the API key, DevHQ still works; insights fall back to
  heuristics and the assistant reports that it is unavailable.
