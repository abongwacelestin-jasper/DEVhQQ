# Webhooks

## Inbound: GitHub App

`POST /api/github/webhook` (public; `Backend/integrations/github/webhook.ts`).
Configure the GitHub App to send `application/json` payloads. Verification
order, failing closed:

1. `GITHUB_WEBHOOK_SECRET` must be set, otherwise `503` — unsigned events are
   never accepted.
2. `X-Hub-Signature-256: sha256=<hex>` is recomputed over the **raw** body
   bytes (`ctx.rawBody`, never re-serialised JSON) and compared in constant
   time → `401` on mismatch.
3. `X-GitHub-Delivery` must be new → `409 replayed_delivery` on a replay.
   Delivery ids are kept for 7 days.

Only then is the event applied (repositories, pull requests, CI runs, code
findings, installations), and each applied delivery is audited.

Related routes: `GET /api/github/app` (installation status, mode, webhook
health, rate limit; Repository ≥ `view`) and `GET /api/github/install-url`
(Administration ≥ `manage`). Configuration: `GITHUB_APP_ID`,
`GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG`, `GITHUB_WEBHOOK_SECRET`,
`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`. With app credentials the data is
live; with only the webhook secret the mode is `webhook-only`; with nothing,
outside production the GitHub routes serve labelled demo data
(`source: "demo"`) and in production they answer
`503 integration_unconfigured`.

## Outbound: integrations

Administration manages outbound channels (`Backend/routes/integrations.routes.ts`,
`Backend/routes/webhooks.routes.ts`): Slack incoming webhooks, a generic signed
webhook and PagerDuty Events v2.

| Route | Guard |
|---|---|
| `GET /api/integrations` | Administration ≥ `view` |
| `POST /api/integrations/:kind/connect` | Administration ≥ `manage` + step-up |
| `DELETE /api/integrations/:id` | Administration ≥ `manage` + step-up |
| `GET /api/integrations/:id/webhooks` (subscriptions and delivery log) | Administration ≥ `view` |
| `POST /api/integrations/:id/webhooks` (subscribe) | Administration ≥ `manage` + step-up |
| `DELETE /api/integrations/:id/webhooks/:webhookId` | Administration ≥ `manage` |
| `POST /api/integrations/:id/webhooks/:webhookId/test` (signed ping) | Administration ≥ `manage` |

Credentials are sealed with AES-256-GCM before they are stored and are never
returned except as a 4-character hint. A generic webhook's signing secret is
returned **once**, on connect.

**Events:** `deployment.approved`, `deployment.failed`, `incident.opened`,
`incident.resolved`, `monitor.down`, `monitor.up`, plus `ping` from the test
route. A subscription is for an event and a product.

**Envelope** (generic webhook body): `{id, type, at, product?, data}`.

**Signature:** `X-DevHQ-Signature: t=<unix seconds>,v1=<hex>` where
`v1 = HMAC-SHA256(secret, "<t>.<raw body>")`.

**Delivery:** through the same SSRF guard as uptime monitors (DNS resolved
and pinned, private/loopback/link-local/metadata ranges blocked, http/https
only, 10 s deadline, no redirects). Failures retry with exponential backoff
(about 2 s, 8 s, 32 s, 2 min, 8 min, with jitter). Pending deliveries are
persisted, so a restart does not lose them. The delivery log keeps the last
200 per integration.

### Verifying a delivery

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(secret, rawBody, header, toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=')));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceSec || !parts.v1) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return expected.length === parts.v1.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}
```

This mirrors `verifyOutboundSignature` in
`Backend/integrations/webhooks/dispatcher.ts`. Also:

- verify over the raw bytes before parsing JSON;
- de-duplicate by the envelope `id`;
- answer `2xx` quickly and process asynchronously; anything else is retried.
