/**
 * CYBER-001 — SSE broadcast leaks events across members/products.
 *
 * GET /api/_events subscribes every authenticated session to one global event
 * bus with no per-subscriber filtering. Any publish() (sign-ins, deployments,
 * incidents, team changes) reaches every listener. A low-privilege member
 * therefore receives activity about members and products they cannot see.
 *
 * PoC: subscribe as "tester", then trigger a sign-in of a different member
 * ("developer", m4). If the tester's stream carries that member's sign-in
 * event, the broadcast is unscoped. Exits fail when the leak reproduces.
 */

import { req, signInDemo, sleep, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

async function collectEvents(base: string, token: string, ms: number): Promise<any[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const events: any[] = [];
  try {
    const r = await fetch(`${base}/api/_events`, {
      // Match the UA bound at sign-in, or the session's UA-binding check revokes it.
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'text/event-stream',
        'user-agent': 'cyber-suite/1.0',
      },
      signal: ctrl.signal,
    });
    if (!r.ok || !r.body) return events;
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const type = /event: (.+)/.exec(frame)?.[1];
        const dataLine = /data: (.+)/.exec(frame)?.[1];
        if (type && dataLine) {
          try {
            events.push({ type, data: JSON.parse(dataLine) });
          } catch {
            /* ping / comment */
          }
        }
      }
    }
  } catch {
    /* aborted on timeout — expected */
  } finally {
    clearTimeout(timer);
  }
  return events;
}

export const check: Check = {
  name: 'SSE /_events cross-member/product leak',
  area: 'Browser/SSE',
  run: async (base) => {
    const tester = await signInDemo(base, 'tester');
    // Start listening, then provoke an event from a *different* member.
    const listen = collectEvents(base, tester, 1800);
    await sleep(250);
    await signInDemo(base, 'developer'); // publishes a 'signin' event for m4
    // Also trigger an incident the tester may not own.
    await req(base, 'POST', '/api/incidents', {
      token: await signInDemo(base, 'admin'),
      origin: 'http://localhost:5173',
      body: { product: 'blog', title: 'Cyber probe incident', severity: 'SEV3' },
    });
    const events = await listen;

    const foreignSignin = events.find(
      (e) => e.type === 'signin' && e.data?.memberId && e.data.memberId !== 'm10',
    );
    const foreignIncident = events.find((e) => e.type === 'incident');
    // The audit bus is broadcast too: every audit.append reaches every
    // subscriber, leaking the full real-time security trail (actors, targets,
    // IPs, hashes) to any authenticated low-privilege member.
    const auditLeak = events.find((e) => e.type === 'audit' && e.data?.data?.actor);

    const leaks: string[] = [];
    if (foreignSignin)
      leaks.push(
        `signin of ${foreignSignin.data.memberId} (${foreignSignin.data.city ?? '?'}, risk ${foreignSignin.data.risk ?? '?'})`,
      );
    if (foreignIncident) leaks.push(`incident ${JSON.stringify(foreignIncident.data)}`);
    if (auditLeak)
      leaks.push(
        `audit entry actor=${auditLeak.data.data.actor} action=${auditLeak.data.data.action} target=${auditLeak.data.data.target}`,
      );

    if (leaks.length) {
      return {
        status: 'fail',
        id: 'CYBER-001',
        detail: `tester (m10) received unscoped events — ${leaks.join(' | ')}`,
      };
    }
    return {
      status: 'pass',
      id: 'CYBER-001',
      detail: 'tester received no foreign member/product/audit events',
    };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
