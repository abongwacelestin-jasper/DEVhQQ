# DevHQ ML service (`Models/`)

Python 3.12 · FastAPI + uvicorn · pydantic v2 · scikit-learn · Anthropic SDK.
An **internal** service: it sits on the private compose network, is reached only
by the Node backend, and authenticates every request except `GET /health`
with an HMAC signature.

```
Browser ──▶ backend (Node) ──HMAC──▶ models (this service) ──▶ Anthropic API (assistant only)
              │  RBAC + product scoping happen here, before any data leaves
              └─ falls back to rule-based heuristics if this service is down / slow / has no model
```

## Quick start

```bash
cd Models
uv sync --frozen --python 3.12          # or: npm run setup
export ML_SERVICE_TOKEN=$(openssl rand -hex 32)
uv run devhq-models train --model all --source synthetic   # SYNTHETIC cold-start models
uv run devhq-models serve --port 8000                      # npm run dev
uv run pytest                                              # npm test
uv run ruff check . && uv run mypy                         # npm run lint / typecheck
```

Backend side: set the same `ML_SERVICE_TOKEN` and `ML_SERVICE_URL=http://models:8000`.
Without `ML_SERVICE_URL`, every insight answers `source: "heuristic"` and the
assistant answers `503 integration_unconfigured`.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `ML_SERVICE_TOKEN` | — | Shared HMAC secret with the backend. **Required (≥ 32 chars) in production**; without it authenticated routes return 503. |
| `MODEL_SIGNING_KEY` | derived from `ML_SERVICE_TOKEN` | Signs registry metadata. Set it explicitly so rotating the service token doesn't invalidate promoted models. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_BUCKET_MODELS` | — | Model registry in the `models` bucket (MinIO locally). If any is missing, the local directory is used. |
| `MODEL_DIR` | `./.model-registry` (`/var/lib/devhq-models` in the image) | Local registry fallback. |
| `ML_BOOTSTRAP_SYNTHETIC` | on outside production | Train + promote on synthetic data at startup when nothing is promoted. |
| `BACKEND_URL` | — | Only for `train --source backend` (pulls `GET /api/insights/_export`, signed). |
| `ANTHROPIC_API_KEY` | — | Assistant. Unset → `503 integration_unconfigured`. Never sent to the browser. |
| `ASSISTANT_MODEL` | `claude-sonnet-5-5` | |
| `ASSISTANT_MAX_TOKENS` / `ASSISTANT_TIMEOUT_SECONDS` | `4096` / `25` | Hard caps per answer. |
| `ASSISTANT_FALLBACKS` | on | Server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). Claude API only. |
| `ML_TRAIN_THREADS`, `OMP_NUM_THREADS` | `1` | Native thread caps; avoids OpenMP oversubscription on shared hosts. |
| `ML_MAX_SKEW_SECONDS`, `ML_MAX_BODY_BYTES` | `300`, `8 MiB` | |

## API

All bodies are camelCase JSON; unknown fields are rejected (422). Errors are
`{"error": {"code", "message"}}`.

| Method & path | Body → response |
|---|---|
| `GET /health` | public → `{"status":"ok"}` |
| `POST /v1/predict/task-eta` | task features → `{etaDays:{p10,p50,p90}, model}` |
| `POST /v1/predict/overdue` | task features → `{probability, drivers[], model}` |
| `POST /v1/predict/deploy-risk` | deploy features → `{probability, score, level, drivers[], model}` |
| `POST /v1/score/signin-anomaly` | sign-in features → `{score, reasons[], decision, model}` |
| `POST /v1/assistant/answer` | `{question, context[]}` → `{answer, sources[], model, stopReason, grounded, truncated}` |
| `POST /v1/train/{model}` | `{source:"synthetic"\|"inline", dataset?, seed?, promote?}` → metrics, `passed`, `promoted` |
| `GET /v1/models` | served models, versions, metrics, `trainedOn` |

`model.trainedOn` is `"synthetic"` for cold-start models. The UI must show that.

### Request signing

```
canonical = "v1\n" + ts + "\n" + nonce + "\n" + METHOD + "\n" + path?query + "\n" + rawBody
X-DevHQ-Signature: v1=hex(HMAC-SHA256(ML_SERVICE_TOKEN, canonical))
X-DevHQ-Timestamp: <unix seconds>     X-DevHQ-Nonce: <random hex>
```

Five-minute skew, constant-time compare, and a nonce cache (replays → 401).
Verification runs in ASGI middleware **before** routing and body parsing, so
an unauthenticated caller always gets 401 and never a schema error. The Node
implementation is `Backend/integrations/ml/signing.ts`; both test suites assert
the same test vector.

## Training pipeline

```bash
devhq-models train --model all --source synthetic                 # cold start
devhq-models train --model overdue --source file --path export.json
devhq-models train --model all --source backend                   # BACKEND_URL + token
```

1. **Data**: the backend export (`GET /api/insights/_export`, Administration:admin
   or service signature, audited), a JSON file, or the synthetic generator.
2. **Split**: time-based. The oldest 75% trains and the newest 25% tests, so models are
   judged on the future, never on a shuffled past.
3. **Metrics**: AUC + Brier (classifiers), MAE + interval coverage (ETA), AUC on
   weak labels (anomaly).
4. **Gate**: candidates are always saved but only **promoted** when every
   threshold holds (table below). Otherwise the service keeps the previous model,
   or the backend keeps using heuristics.
5. **Registry**: `<name>/<version>/model.joblib` + `metadata.json` (sha256, size,
   metrics, thresholds, feature schema, training-data sha256 and row counts,
   seed, runtime versions, HMAC signature) and a signed `<name>/promoted.json`.

| Model | Promotion thresholds (held-out, later-in-time window) |
|---|---|
| `overdue` | AUC ≥ 0.70, Brier ≤ 0.20, ≥ 200 train / 50 test rows |
| `deploy-risk` | AUC ≥ 0.68, Brier ≤ 0.20, ≥ 200 / 50 rows |
| `task-eta` | MAE ≤ 5 days, MAE ≤ 0.9 × estimate-only heuristic, p10–p90 coverage ≥ 0.65 |
| `signin-anomaly` | AUC ≥ 0.80 on labelled test rows, ≥ 200 / 50 rows |

**Loading is fail-closed.** `joblib.load` executes pickle code, so an artifact is
only unpickled after the pointer signature, the metadata signature, the sha256
of the bytes, the feature-column list and the scikit-learn minor version all
check out. A tampered or unsigned artifact is refused and its endpoint answers
`503 model_unavailable`, so the backend falls back to heuristics. Write access to the
bucket alone cannot get code executed here.

## Model cards

> **Synthetic cold start.** Until a real export passes the gate, served models
> were trained on `training/synthetic.py`, generated data with a hand-written
> causal story. Their metrics show that the pipeline works. They do **not** show
> accuracy for any real team. API responses say `trainedOn: "synthetic"`.

### Task ETA (`task-eta`)
- **Purpose**: calendar days until an open task is done, as a p10/p50/p90 interval.
- **Model**: three `GradientBoostingRegressor(loss="quantile")` (α = 0.1/0.5/0.9), predictions sorted to prevent crossing.
- **Features**: estimate (h), type, priority, status, days in status, age, days to due, blocked by an open task, comments, subtasks total/done, logged hours (and vs. estimate), assignee open tasks, assignee 30-day throughput, assignee late rate (with a prior).
- **Training data**: finished tasks; features as at creation, label = days from creation to done.
- **Metrics** (synthetic, seed 11, test window): MAE ≈ 1 day vs ≈ 1.8 for the heuristic; coverage ≈ 0.7.
- **Limitations**: export rows approximate "as at creation" and use *current* assignee stats (mild leakage); small teams won't pass the 200-row floor for a while; holidays and part-time schedules are not modelled.

### Overdue risk (`overdue`)
- **Purpose**: probability an open task finishes after its due date.
- **Model**: `HistGradientBoostingClassifier` in `CalibratedClassifierCV` (isotonic ≥ 1000 rows, else sigmoid), so 0.7 means roughly 7 in 10.
- **Drivers**: each feature is reset to the training median and the probability change is measured; the top positive changes are phrased for the UI. This is local sensitivity, **not causation**.
- **Metrics** (synthetic): AUC ≈ 0.97, Brier ≈ 0.05. Synthetic lateness is nearly determined by due date vs. remaining work, so expect much lower AUC on real data.
- **Limitations**: same as ETA; a due date moved after the fact rewrites the label.

### Deployment risk (`deploy-risk`)
- **Purpose**: probability that a deployment fails or is rolled back.
- **Model**: calibrated gradient boosting, as above. `level` is `high` ≥ 0.35, `medium` ≥ 0.15.
- **Features**: environment, provider (bucketed), hour/weekday (UTC; off-hours, weekend), requester deploys in 90 days and failure rate, product failure rate in 30 days, incidents on the product in 7 days, open incidents, hours since the last deploy of that product/env. Rates use a 1-in-10 prior.
- **Metrics** (synthetic): AUC ≈ 0.7–0.75. The gate refused an earlier, weaker generator at 0.66, which shows the gate works.
- **Limitations**: knows nothing about the diff itself (size, files, migrations); providers outside the known list are pooled as `other`.
- **Fairness**: requester history is a feature. A high score must never block or reassign someone's deploy on its own. It is advisory, and the two-person approval rule stays the control. Review per-requester score distributions before using the score in any workflow.

### Sign-in anomaly (`signin-anomaly`)
- **Purpose**: how unusual a sign-in is for its organisation, scored 0–100 with `{score, reasons}` compatible with `lib/geo.ts assessRisk` (`decision` uses the same 40/70 bands).
- **Model**: `IsolationForest` per organisation with ≥ 200 sign-ins, plus a global fallback. The raw score is scaled against the org's own training distribution (median → 0, 99th percentile → ~67, so roughly 1% of ordinary sign-ins score in the challenge band or above).
- **Features**: hour and weekday (cyclic), log distance from the member's usual city, network type, new device (proxy: never-seen IP), travel speed since the last good sign-in, new country.
- **Reasons**: human sentences from robust z-scores and category frequencies against the org baseline ("Tor exit node", "Impossible travel: about 4,500 km/h", "9,000 km from usual sign-in locations", …).
- **Metrics** (synthetic): AUC on injected anomalies ≥ 0.9. Real exports only have weak labels (blocked, or rule score ≥ 70).
- **Limitations**: unsupervised, so a new but legitimate pattern, like a team member who relocates, scores high until it becomes normal. **Advisory only**: the backend still gates sign-ins with the rule-based `assessRisk`, and the insight shows both scores.

### Privacy
- The export and every prediction payload carry **no names, emails, IP addresses, cities or free text**, only derived numbers and categories (`Backend/integrations/ml/features.ts`). Pydantic rejects unknown fields, so an accidental `ip` or `email` field fails validation.
- Metadata stores a hash of the training data, not the data.

## Assistant (`/v1/assistant/answer`)

- **Scoping is the backend's job.** `POST /api/assistant/ask` collects only the docs, tasks, incidents and deployments the caller can read, using the same rules as their routes. It caps them at 120 items, 4,000 chars each and 150,000 total, strips delimiter tricks, and sends that. This service never fetches workspace data.
- **Retrieval**: passages of about 1,200 chars, BM25 ranking, top 8 within 16,000 chars.
- **Model call**: Anthropic Python SDK, `client.beta.messages.create` with `ASSISTANT_MODEL`, a token cap, `output_config.effort = "low"`, a JSON-schema output (`answer`, `source_ids`), a 25 s timeout, 1 retry, and server-side refusal fallback.
- **Injection posture**: the system prompt is a constant that tells the model records are data, not instructions. Records go into the user turn as a JSON array inside `<workspace_data>`, with `<`/`>` escaped so content can't close the block. The question goes last. The model has no tools. Cited ids are filtered to what was actually retrieved (and again by the backend). Tests check that injected text never reaches the system prompt and that invented source ids are dropped.
- **Failure modes**: no key → 503 `integration_unconfigured`; rate limit → 503 `assistant_busy`; timeout → 504; refusal → a short refusal message with no sources.
- **Logging**: the backend audits each question's length, source count and outcome. It never logs question content.
