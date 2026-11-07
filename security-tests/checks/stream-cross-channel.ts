/**
 * Browser/SSE — /api/stream cross-channel message leakage (B-COLLAB).
 *
 * The collaboration stream must deliver a channel's message.* events only to
 * members who can read that channel *now*. PoC: Admin opens a private DM with
 * the PM (Tester excluded) and posts a message. A Tester listening on
 * /api/stream must NOT receive that message; a participant (PM) must.
 *
 * Fails if the Tester (a non-member) receives the private DM's message event.
 */

import { CLI, req, signInDemo, sleep, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

async function collect(base: string, token: string, ms: number): Promise<any[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const out: any[] = [];
  try {
    const r = await fetch(`${base}/api/stream`, {
      headers: { authorization: `Bearer ${token}`, 'user-agent': 'cyber-suite/1.0', accept: 'text/event-stream' },
      signal: ctrl.signal,
    });
    if (!r.ok || !r.body) return out;
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const type = /event: (.+)/.exec(frame)?.[1];
        const data = /data: (.+)/.exec(frame)?.[1];
        if (type && data) {
          try {
            out.push({ type, data: JSON.parse(data) });
          } catch {
            /* heartbeat */
          }
        }
      }
    }
  } catch {
    /* aborted at timeout */
  } finally {
    clearTimeout(timer);
  }
  return out;
}

export const check: Check = {
  name: '/api/stream private-channel leak to non-member',
  area: 'Browser/SSE',
  run: async (base) => {
    const admin = await signInDemo(base, 'admin'); // m1
    const pm = await signInDemo(base, 'pm'); // m2
    const tester = await signInDemo(base, 'tester'); // m10

    // Admin opens a private DM with the PM only (Tester m10 is not a member).
    const dm = await req(base, 'POST', '/api/channels', {
      token: admin,
      headers: CLI,
      body: { kind: 'dm', members: ['m2'] },
    });
    const channelId = dm.json?.id;
    if (!channelId) return { status: 'fail', id: 'INFO-STREAM', detail: `DM create failed (${dm.status} ${dm.text})` };

    const secret = `secret-dm-${Date.now()}`;
    const testerEvents = collect(base, tester, 1800);
    const pmEvents = collect(base, pm, 1800);
    await sleep(300);
    const post = await req(base, 'POST', `/api/channels/${channelId}/messages`, {
      token: admin,
      headers: CLI,
      body: { kind: 'text', text: secret },
    });
    if (post.status !== 201 && post.status !== 200)
      return { status: 'fail', id: 'INFO-STREAM', detail: `message post failed (${post.status} ${post.text})` };

    const [tEv, pEv] = await Promise.all([testerEvents, pmEvents]);
    const leakedToTester = tEv.some(
      (e) => e.type?.startsWith('message') && JSON.stringify(e.data).includes(secret),
    );
    const deliveredToPm = pEv.some(
      (e) => e.type?.startsWith('message') && JSON.stringify(e.data).includes(secret),
    );

    if (leakedToTester)
      return { status: 'fail', id: 'INFO-STREAM', detail: 'Tester (non-member) received a private DM message via /api/stream' };
    return {
      status: 'pass',
      id: 'INFO-STREAM',
      detail: `private DM message withheld from non-member; delivered to participant=${deliveredToPm}`,
    };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
