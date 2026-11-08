/**
 * Email wiring through the real routes, captured by the memory transport:
 * sign-in alerts, backup codes, access requests, account lock-out, invites,
 * incidents and notification preferences.
 */
import '../setup.ts';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, type TestServer } from '../helpers/server.ts';
import { DEMO_MFA_CODE, fullSignIn, passwordOnly, signInAs } from '../helpers/auth.ts';
import { memoryTransport, setMailTransport, type MailMessage } from '../../mail/index.ts';
import { repos } from '../../data/index.ts';
import { notify } from '../../domain/collab/notify.ts';
import { config } from '../../config/env.ts';

const KOFI = 'kofi@techorg.io'; // m4, Developer on renewberry
const mail = memoryTransport();
let app: TestServer;

before(async () => {
  setMailTransport(mail);
  app = await startApp();
});
after(async () => {
  setMailTransport(undefined);
  await app.close();
});
beforeEach(() => {
  mail.outbox.length = 0;
});

/** Mail is handed off without blocking the response; give the event loop a moment. */
async function sent(pred: (m: MailMessage) => boolean, ms = 1_000): Promise<MailMessage[]> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const hits = mail.outbox.filter(pred);
    if (hits.length) return hits;
    await new Promise((r) => setTimeout(r, 10));
  }
  return mail.outbox.filter(pred);
}
const absolute = (m: MailMessage) =>
  [...m.html.matchAll(/\bhref="([^"]*)"/g)].every((x) => /^(https?:\/\/|mailto:)/.test(x[1]));

describe('mail wiring — sign-in alerts', () => {
  it('alerts on a sign-in from a new IP, not on a repeat from a known device', async () => {
    await fullSignIn(app, KOFI); // establishes a known IP + device
    mail.outbox.length = 0;

    const fresh = app.client({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    });
    const pw = await fresh.post<{ token: string }>('/api/auth/sign-in', {
      email: KOFI,
      password: 'devhq-demo',
    });
    assert.equal(pw.status, 200, pw.text);
    assert.equal(mail.outbox.length, 0, 'no alert for the password step alone');
    fresh.token = pw.json.token;
    const ok = await fresh.post('/api/auth/mfa/totp', { code: DEMO_MFA_CODE });
    assert.equal(ok.status, 200, ok.text);

    const [alert] = await sent((m) => m.category === 'sign-in-alert');
    assert.ok(alert, 'sign-in alert sent');
    assert.equal(alert.to, KOFI);
    assert.match(alert.subject, /New sign-in to your .* account/);
    assert.ok(alert.text.includes(fresh.ip), 'IP address');
    assert.ok(alert.text.includes('Chrome on macOS'), 'device');
    assert.ok(alert.text.includes('Local network'), 'approximate location');
    assert.ok(
      alert.text.includes(`${config.mail.brand.appUrl}/security`),
      'secure-your-account link',
    );
    assert.ok(alert.idempotencyKey?.startsWith('sign-in-alert/'));
    assert.ok(absolute(alert));

    // Same IP and device again: familiar, no second alert.
    mail.outbox.length = 0;
    const again = app.client({ ip: fresh.ip, userAgent: fresh.userAgent });
    const pw2 = await again.post<{ token: string }>('/api/auth/sign-in', {
      email: KOFI,
      password: 'devhq-demo',
    });
    again.token = pw2.json.token;
    assert.equal((await again.post('/api/auth/mfa/totp', { code: DEMO_MFA_CODE })).status, 200);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(mail.outbox.filter((m) => m.category === 'sign-in-alert').length, 0);
  });

  it('security alerts ignore notification preferences', async () => {
    const m = (await repos.members.get('m4'))!;
    const saved = m.profile;
    m.profile = {
      displayName: 'Kofi',
      timezone: 'Africa/Accra',
      hoursFrom: '09:00',
      hoursTo: '17:00',
      skills: [],
      notify: [],
      completedAt: new Date().toISOString(),
    };
    await repos.members.put(m);
    try {
      await fullSignIn(app, KOFI); // a brand-new client IP
      const [alert] = await sent((x) => x.category === 'sign-in-alert');
      assert.ok(alert, 'sent even with every alert turned off');
      assert.ok(alert.text.includes('Hello Kofi,'), 'uses the display name');
    } finally {
      m.profile = saved;
      await repos.members.put(m);
    }
  });
});

describe('mail wiring — backup codes', () => {
  it('emails when a new set is generated, never including the codes', async () => {
    const c = await fullSignIn(app, KOFI);
    mail.outbox.length = 0;
    const res = await c.post<{ codes: string[] }>('/api/auth/backup-codes');
    assert.equal(res.status, 201, res.text);
    const [m] = await sent((x) => x.category === 'backup-codes-generated');
    assert.ok(m, 'backup-codes-generated email sent');
    assert.equal(m.to, KOFI);
    for (const code of res.json.codes) {
      assert.ok(!m.html.includes(code) && !m.text.includes(code), 'codes never emailed');
    }
    assert.ok(m.text.includes('10 one-time backup codes'));

    // Using one sends the "backup code used" notice with the remaining count.
    mail.outbox.length = 0;
    const half = await passwordOnly(app, KOFI);
    const used = await half.post('/api/auth/mfa/backup', { code: res.json.codes[0] });
    assert.equal(used.status, 200, used.text);
    const [u] = await sent((x) => x.category === 'backup-code-used');
    assert.ok(u, 'backup-code-used email sent');
    assert.ok(u.text.includes('9 of 10'), 'remaining count');
    assert.ok(absolute(u));
  });
});

describe('mail wiring — access requests', () => {
  it('emails every member who can manage the team, with a link to the member page', async () => {
    const dev = await signInAs(app, 'developer');
    const res = await dev.post<{ notified: number }>('/api/access/requests', {
      path: '/audit',
      reason: '<script>alert(1)</script> incident review',
    });
    assert.equal(res.status, 200, res.text);
    const emails = await sent((x) => x.category === 'access-request');
    assert.ok(emails.length >= 1, 'at least the Owner');
    assert.equal(emails.length, res.json.notified, 'one email per notified admin');
    assert.ok(
      emails.some((e) => e.to === 'amara@techorg.io'),
      'the Owner',
    );
    assert.ok(!emails.some((e) => e.to === KOFI), 'never the requester');
    for (const e of emails) {
      assert.ok(e.html.includes(`${config.mail.brand.appUrl}/team/m4`), 'member page link');
      assert.ok(!e.html.includes('<script>'), 'reason escaped');
      assert.ok(e.html.includes('&lt;script&gt;'));
      assert.ok(absolute(e));
    }
    // The notification is marked emailed, so the digest will not repeat it.
    const n = (await repos.notifications.list('m1')).find((x) => x.refId === 'access:m4:/audit');
    assert.ok(n?.emailedAt);

    // A repeat while the first is unread collapses: no second email.
    mail.outbox.length = 0;
    await dev.post('/api/access/requests', { path: '/audit' });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(mail.outbox.filter((x) => x.category === 'access-request').length, 0);
  });
});

describe('mail wiring — lock-out, invite, incident, preferences', () => {
  it('emails the account owner when repeated failures lock the account', async () => {
    const email = 'ravi@techorg.io';
    const c = app.client();
    for (let i = 0; i < 5; i++)
      await c.post('/api/auth/sign-in', { email, password: `wrong-password-${i}` });
    const [m] = await sent((x) => x.category === 'account-locked');
    assert.ok(m, 'lock-out email sent');
    assert.equal(m.to, email);
    assert.ok(m.text.includes('5 unsuccessful sign-in attempts'));
    const ravi = (await repos.members.get('m10'))!;
    ravi.lockedUntil = undefined;
    await repos.members.put(ravi);
  });

  it('emails an invitation with an absolute single-use link', async () => {
    const admin = await fullSignIn(app, 'amara@techorg.io');
    const res = await admin.post<{ inviteLink: string }>('/api/team/invites', {
      email: 'new.hire@example.com',
      name: 'New <b>Hire</b>',
      role: 'Developer',
      products: ['renewberry'],
    });
    assert.equal(res.status, 200, res.text);
    const [m] = await sent((x) => x.category === 'invite');
    assert.ok(m, 'invite sent');
    assert.equal(m.to, 'new.hire@example.com');
    assert.ok(
      m.text.includes(`${config.mail.brand.appUrl}${res.json.inviteLink}`),
      'same token link',
    );
    assert.ok(!m.html.includes('<b>Hire</b>'));
    assert.ok(m.text.includes('Developer') && m.text.includes('Renewberry'));
  });

  it('emails the owner of a newly declared incident', async () => {
    const dev = await signInAs(app, 'developer');
    const res = await dev.post<{ id: string }>('/api/incidents', {
      product: 'renewberry',
      title: 'Checkout latency above SLO',
      severity: 'SEV2',
      owner: 'm2',
    });
    assert.equal(res.status, 201, res.text);
    const [m] = await sent((x) => x.category === 'incident');
    assert.ok(m, 'incident email sent');
    assert.equal(m.to, (await repos.members.get('m2'))!.email);
    assert.ok(m.subject.includes(`${res.json.id} assigned to you`));
    assert.ok(m.text.includes(`/incidents/${res.json.id}`));
  });

  it('task emails respect the member notification preferences', async () => {
    const task = (await repos.tasks.list({ assignee: 'm4' }))[0];
    const m = (await repos.members.get('m4'))!;
    const saved = m.profile;
    const profile = {
      displayName: 'Kofi',
      timezone: 'UTC',
      hoursFrom: '09:00',
      hoursTo: '17:00',
      skills: [],
      completedAt: new Date().toISOString(),
    };
    try {
      m.profile = { ...profile, notify: ['mentions'] };
      await repos.members.put(m);
      await notify({
        memberId: 'm4',
        kind: 'assignment',
        title: `${task.key} assigned to you`,
        body: task.title,
        link: `/tasks/${task.key}`,
        refId: `task:${task.key}:assignee:m4:pref-off`,
        actor: 'm2',
      });
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(mail.outbox.length, 0, 'opted out of "assigned"');

      m.profile = { ...profile, notify: ['assigned'] };
      await repos.members.put(m);
      await notify({
        memberId: 'm4',
        kind: 'assignment',
        title: `${task.key} assigned to you`,
        body: task.title,
        link: `/tasks/${task.key}`,
        refId: `task:${task.key}:assignee:m4:pref-on`,
        actor: 'm2',
      });
      const [t] = await sent((x) => x.category === 'task-assigned');
      assert.ok(t, 'sent when opted in');
      assert.ok(t.subject.startsWith(`${task.key} assigned to you`));
      assert.ok(t.text.includes(`${config.mail.brand.appUrl}/tasks/${task.key}`));
    } finally {
      m.profile = saved;
      await repos.members.put(m);
    }
  });
});

describe('mail wiring — password changed', () => {
  it('emails the member after a signed-in password change', async () => {
    const c = await fullSignIn(app, 'sam@techorg.io'); // m8
    const res = await c.post('/api/auth/password', {
      currentPassword: 'devhq-demo',
      newPassword: 'Mail-Wiring-Passw0rd!',
    });
    assert.ok(res.status < 300, res.text);
    const hits = await sent((m) => m.to === 'sam@techorg.io' && /password/i.test(m.subject));
    assert.equal(hits.length, 1, JSON.stringify(mail.outbox.map((m) => m.subject)));
    assert.ok(!hits[0].text.includes('Mail-Wiring-Passw0rd!'), 'the password is never emailed');
    assert.ok(absolute(hits[0]));
  });
});
