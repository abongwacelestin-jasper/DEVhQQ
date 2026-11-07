# 0005. A separate Python ML service behind the backend

- **Status:** Accepted, planned for Wave 4 (ML lane)
- **Date:** 2026-11-07 (owner decision)

## Context

DevHQ wants predictions (task ETA and overdue risk, deployment risk, sign-in
anomaly scores) and an assistant that answers questions about the
organisation's work. The ML ecosystem is Python. The API is a dependency-free
Node process (ADR [0001](0001-no-framework-backend.md)) and the security
boundary for all data; it must stay that way. Sign-in risk already exists as
rules in `Backend/lib/geo.ts`.

## Decision

Run models in their own Python service, reachable only from the backend:

> [!NOTE]
> **Planned: Wave 4 (ML).** Contract from `docs/agents/WAVE4.md` §6:
>
> - Python service (`models`, port 8000, internal network only): `GET /health`,
>   `POST /v1/predict/task-eta`, `/v1/predict/overdue`, `/v1/predict/deploy-risk`,
>   `/v1/score/signin-anomaly`, `/v1/assistant/answer`, `POST /v1/train/{model}`.
> - Every request is authenticated with an HMAC over the request using
>   `ML_SERVICE_TOKEN` (`X-DevHQ-Signature`, timestamp, 5-minute skew).
> - Backend bridge: `GET /api/insights/tasks/:key`,
>   `GET /api/insights/deployments/:id`, `GET /api/insights/signins/:id`,
>   `POST /api/assistant/ask` `{question, scope?}` → `{answer, sources[], model}`
>   (optional SSE variant `POST /api/assistant/ask/stream`).
> - Responses carry `source: 'model' | 'heuristic'`; when the service is down
>   the backend falls back to the existing rule-based risk in
>   `Backend/lib/geo.ts`.
> - The assistant uses `ANTHROPIC_API_KEY` and `ASSISTANT_MODEL` (default
>   `claude-sonnet-5-5`) in the Python service only; the key never reaches the
>   browser or the Node backend.

## Consequences

- The browser never talks to the ML service. Authorisation and product scope
  are applied by the backend before anything is sent, so the model only sees
  data the caller could already see.
- The backend stays dependency-free; Python dependencies are isolated in their
  own container and lockfile.
- Every insight has a fallback, so the platform keeps working without the
  service (and without an API key) — responses say which path produced them.
- Text forwarded to the assistant passes through `sanitizeForPrompt()`
  (`Backend/lib/validate.ts`), which strips control and bidi characters and
  fake role delimiters. That is defence in depth, not a guarantee: the model's
  output is treated as untrusted.
- Another service to deploy, monitor and secure, and a shared secret to rotate.

## References

- `Models/` (placeholder today), `Backend/lib/geo.ts`, `Backend/lib/validate.ts`
- [ML overview](../../ml/index.md)
