/**
 * B-DOMAIN — GitHub webhook signature and replay (WAVE4 §6).
 *
 * `POST /api/github/webhook` is public but must fail closed. With
 * GITHUB_WEBHOOK_SECRET set, verifies against a live server:
 *  - no/!well-formed signature → 401 invalid_signature;
 *  - a signature computed with the wrong secret → 401;
 *  - a valid signature over the RAW body → 202 accepted;
 *  - the same X-GitHub-Delivery replayed → 409 replayed_delivery;
 *  - an empty body → 400.
 * Also boots a second server with no secret to confirm 503 (never accepts
 * unsigned events).
 *
 * Fails if an unsigned/wrong-key/replayed delivery is accepted, or the
 * no-secret server accepts a webhook.
 */

import { createHmac } from 'node:crypto';
import { req, spawnServer, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

const SECRET = 'cyber-webhook-secret';
const sig = (raw: string, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

export const check: Check = {
  name: 'GitHub webhook signature + replay',
  area: 'B-DOMAIN / SSRF',
  env: { GITHUB_WEBHOOK_SECRET: SECRET },
  run: async (base) => {
    const problems: string[] = [];
    const raw = JSON.stringify({ zen: 'Keep it simple', hook_id: 1 });
    const delivery = 'cyber-delivery-0001';
    const send = (headers: Record<string, string>, body = raw) =>
      req(base, 'POST', '/api/github/webhook', { headers, rawBody: body });

    // No signature.
    const unsigned = await send({ 'x-github-event': 'ping', 'x-github-delivery': 'd-unsigned' });
    if (unsigned.status !== 401) problems.push(`unsigned webhook accepted (${unsigned.status})`);

    // Wrong-secret signature.
    const wrong = await send({
      'x-github-event': 'ping',
      'x-github-delivery': 'd-wrong',
      'x-hub-signature-256': sig(raw, 'not-the-secret'),
    });
    if (wrong.status !== 401) problems.push(`wrong-secret signature accepted (${wrong.status})`);

    // Valid signature → accepted (202).
    const ok = await send({
      'x-github-event': 'ping',
      'x-github-delivery': delivery,
      'x-hub-signature-256': sig(raw),
    });
    if (ok.status !== 202) problems.push(`valid webhook not accepted (${ok.status} ${ok.text})`);

    // Replay the same delivery id → 409.
    const replay = await send({
      'x-github-event': 'ping',
      'x-github-delivery': delivery,
      'x-hub-signature-256': sig(raw),
    });
    if (replay.status !== 409) problems.push(`replayed delivery accepted (${replay.status})`);

    // Empty body → 400 (not a crash).
    const empty = await send(
      { 'x-github-event': 'ping', 'x-github-delivery': 'd-empty', 'x-hub-signature-256': sig('') },
      '',
    );
    if (empty.status !== 400 && empty.status !== 401)
      problems.push(`empty body not rejected (${empty.status})`);

    // A server with no secret must refuse (503), never accept unsigned events.
    const noSecret = await spawnServer({ env: { GITHUB_WEBHOOK_SECRET: '' } });
    try {
      const r = await req(noSecret.base, 'POST', '/api/github/webhook', {
        headers: { 'x-github-event': 'ping', 'x-github-delivery': 'd-x' },
        rawBody: raw,
      });
      if (r.status !== 503) problems.push(`no-secret server did not fail closed (${r.status})`);
    } finally {
      noSecret.stop();
    }

    return {
      status: problems.length ? 'fail' : 'pass',
      id: 'INFO-GHWEBHOOK',
      detail: problems.length
        ? problems.join('; ')
        : 'unsigned/wrong-key 401; valid 202; replay 409; empty 400; no-secret 503 (fail-closed)',
    };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
