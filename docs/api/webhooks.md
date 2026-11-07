# Webhooks

DevHQ has no webhook endpoints today. The router already keeps the raw request
body next to the parsed JSON (`ctx.rawBody` in `Backend/lib/http.ts`) so that a
signature can be verified over the exact bytes received.

> [!NOTE]
> **Planned: Wave 4 (B-DOMAIN).** Contract from `docs/agents/WAVE4.md` §6.
>
> **Inbound: GitHub App.**
>
> - `POST /api/github/webhook` — public. The `X-Hub-Signature-256` HMAC is
>   verified over the raw body with `GITHUB_WEBHOOK_SECRET`; deliveries are
>   replay-protected by GitHub's delivery id.
> - `GET /api/github/app` (installation status) and
>   `GET /api/github/install-url`.
> - Configuration: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`,
>   `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`. Without
>   them the GitHub routes fall back to demo data outside production.
>
> **Outbound: integrations.**
>
> - `GET /api/integrations`, `POST /api/integrations/:kind/connect`,
>   `DELETE /api/integrations/:id`.
> - `GET/POST/DELETE /api/integrations/:id/webhooks` — outbound webhooks
>   signed with HMAC, retried with backoff, with a delivery log.
>
> Code will live in `Backend/integrations/webhooks/` and
> `Backend/integrations/github/`. This page will document payloads, the
> signature scheme, retry schedule and delivery log once the lane merges.

## Guidance for receivers (applies once outbound webhooks ship)

- Verify the signature over the raw body before parsing it, with a
  constant-time comparison.
- Reject deliveries whose timestamp is outside your tolerance, and de-duplicate
  by delivery id.
- Respond quickly with `2xx` and process asynchronously; non-`2xx` responses
  will be retried.
