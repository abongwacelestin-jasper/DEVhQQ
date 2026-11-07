# 0005. A separate Python ML service behind the backend

- **Status:** Accepted, implemented (Wave 4, ML lane)
- **Date:** 2026-11-07 (owner decision)

## Context

DevHQ wants predictions (task ETA and overdue risk, deployment risk, sign-in
anomaly scores) and an assistant that answers questions about the
organisation's work. The ML ecosystem is Python. The API is a Node process with a
single runtime dependency (ADR [0001](0001-no-framework-backend.md)) and the security
boundary for all data; it must stay that way. Sign-in risk already exists as
rules in `Backend/lib/geo.ts`.

## Decision

Run models in their own Python service, reachable only from the backend:

- A FastAPI service (`models`, port 8000, internal network only) with
  prediction, scoring, assistant and training endpoints; every request except
  `GET /health` carries an HMAC signature with `ML_SERVICE_TOKEN`
  (`X-DevHQ-Signature`, timestamp, nonce, 5-minute skew).
- The backend bridge (`Backend/integrations/ml/`) exposes
  `GET /api/insights/tasks/:key`, `/deployments/:id`, `/signins/:id`,
  `POST /api/assistant/ask`, and admin routes for status and training.
- Responses carry `source: 'model' | 'heuristic'`; when the service is down,
  unconfigured or has no promoted model, the backend uses its rule-based
  heuristics.
- The assistant calls the Anthropic API from the Python service only
  (`ANTHROPIC_API_KEY`, `ASSISTANT_MODEL`).
- Details, model cards and the training gate:
  [Models/README.md](../../../Models/README.md).

## Consequences

- The browser never talks to the ML service. Authorisation and product scope
  are applied by the backend before anything is sent, so the model only sees
  data the caller could already see.
- The backend gains no ML dependencies; Python dependencies are isolated in their
  own container and lockfile.
- Every insight has a fallback, so the platform keeps working without the
  service (and without an API key) — responses say which path produced them.
- Text forwarded to the assistant passes through `sanitizeForPrompt()`
  (`Backend/lib/validate.ts`), which strips control and bidi characters and
  fake role delimiters. That is defence in depth, not a guarantee: the model's
  output is treated as untrusted.
- Another service to deploy, monitor and secure, and a shared secret to rotate.

## References

- `Models/`, `Backend/integrations/ml/`, `Backend/lib/geo.ts`, `Backend/lib/validate.ts`
- [ML overview](../../ml/index.md)
