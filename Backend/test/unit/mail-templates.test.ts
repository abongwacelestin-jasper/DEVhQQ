/** Every email template: HTML + text parts, branded footer, escaping, absolute links. */
import '../setup.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadMailConfig } from '../../config/mail.ts';
import { appLink, onColor, renderEmail, safeHref, wrap } from '../../mail/layout.ts';
import { sampleEmails } from '../../mail/samples.ts';
import { recoveryEmail } from '../../mail/templates.ts';

const brand = loadMailConfig(
  {
    BRAND_NAME: 'Acme Cloud',
    BRAND_LEGAL_NAME: 'Acme Cloud Technologies Ltd',
    BRAND_LOGO_URL: 'https://cdn.acme.example/brand/logo@2x.png',
    BRAND_PRIMARY_COLOR: '#0f766e',
    BRAND_ACCENT_COLOR: '#7c3aed',
    BRAND_SUPPORT_EMAIL: 'help@acme.example',
    BRAND_POSTAL_ADDRESS: '12 Harbour Road, Floor 3, Accra, Ghana',
    BRAND_WEBSITE_URL: 'https://acme.example',
    APP_URL: 'https://app.acme.example',
    MAIL_TRANSPORT: 'resend',
    RESEND_API_KEY: 're_test_key',
    MAIL_FROM: 'Acme Cloud <no-reply@mail.acme.example>',
  },
  { isProd: true, appOrigin: 'https://app.acme.example' },
).brand;

const emails = sampleEmails(brand);
const names = Object.keys(emails);

const XSS = '<script>alert("x")</script>';
const IMG = '<img src=x onerror=alert(1)>';
const hostile = sampleEmails(brand, { person: XSS, title: `${IMG} "quoted" 'single'` });

const hrefs = (html: string) => [...html.matchAll(/\bhref="([^"]*)"/g)].map((m) => m[1]);

describe('mail templates — coverage', () => {
  it('covers every email the product sends', () => {
    const categories = new Set(Object.values(emails).map((e) => e.category));
    for (const c of [
      'invite',
      'password-reset',
      'password-changed',
      'sign-in-alert',
      'mfa-enrolled',
      'backup-codes-generated',
      'backup-code-used',
      'account-locked',
      'access-request',
      'task-assigned',
      'incident',
      'deployment-approval',
      'offboarding-started',
      'offboarding-completed',
      'digest',
    ])
      assert.ok(categories.has(c as never), `missing template for ${c}`);
  });
});

for (const name of names) {
  const mail = emails[name];
  describe(`mail template — ${name}`, () => {
    it('renders a complete HTML document and a plain-text part', () => {
      assert.ok(mail.subject.length > 5 && mail.subject.length <= 120, mail.subject);
      assert.ok(!/[\r\n]/.test(mail.subject));
      assert.match(mail.html, /^<!DOCTYPE html>/);
      assert.ok(mail.html.includes('<meta name="color-scheme" content="light dark">'));
      assert.ok(mail.html.includes('width="600"'), '600 px container');
      assert.ok(mail.html.includes('<!--[if mso]>'), 'Outlook conditionals');
      assert.ok(mail.html.includes('mso-hide:all'), 'hidden preheader');
      assert.ok(mail.text.length > 100);
      assert.ok(!/<[a-z][^>]*>/i.test(mail.text), 'text part has no markup');
    });

    it('carries the brand: logo, colour, footer with legal name, address and support', () => {
      for (const part of [mail.html, mail.text]) {
        assert.ok(part.includes('Acme Cloud Technologies Ltd'), 'legal name');
        assert.ok(part.includes('12 Harbour Road, Floor 3, Accra, Ghana'), 'postal address');
        assert.ok(part.includes('help@acme.example'), 'support contact');
        assert.ok(/You received this/.test(part), 'why you got this');
      }
      assert.ok(mail.html.includes('src="https://cdn.acme.example/brand/logo@2x.png"'));
      assert.ok(mail.html.includes('#0f766e'), 'primary colour');
      assert.ok(!mail.html.includes('DevHQ'), 'no hard-coded product name');
      assert.ok(!mail.text.includes('DevHQ'), 'no hard-coded product name in text');
    });

    it('uses only absolute links, and the only image is the logo', () => {
      const links = hrefs(mail.html);
      assert.ok(links.length >= 2);
      for (const h of links) assert.match(h, /^(https:\/\/|mailto:)/, h);
      for (const u of mail.text.match(/\b(?:https?:\/\/|www\.)\S+/g) ?? [])
        assert.match(u, /^https:\/\//, u);
      const imgs = [...mail.html.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/g)].map((m) => m[1]);
      assert.deepEqual(imgs, ['https://cdn.acme.example/brand/logo@2x.png']);
    });

    it('has no script, external stylesheet or remote CSS', () => {
      assert.ok(!/<script/i.test(mail.html));
      assert.ok(!/<link\b/i.test(mail.html));
      assert.ok(!/url\(/i.test(mail.html));
      assert.ok(!/@import/i.test(mail.html));
      assert.ok(!/\son[a-z]+=/i.test(mail.html), 'no event handler attributes');
    });

    it('is written in calm copy: no exclamation marks', () => {
      assert.ok(!mail.subject.includes('!'), mail.subject);
      assert.ok(!mail.text.includes('!'), 'text part');
    });

    it('escapes user-controlled names and titles', () => {
      const h = hostile[name];
      assert.ok(!h.html.includes('<script'), 'no script tag');
      assert.ok(!h.html.includes('<img src=x'), 'no injected image');
      if (h.html.includes('alert'))
        assert.ok(/&lt;(script|img)/.test(h.html), 'escaped, not dropped');
      for (const href of hrefs(h.html)) assert.match(href, /^(https:\/\/|mailto:)/);
      assert.ok(!/[\r\n]/.test(h.subject));
    });
  });
}

describe('mail layout', () => {
  it('refuses relative and non-http links', () => {
    assert.throws(() => safeHref('/tasks/RB-1'), /absolute/);
    assert.throws(() => safeHref('javascript:alert(1)'), /http/);
    assert.throws(() => safeHref('data:text/html,x'), /http/);
    assert.equal(safeHref('mailto:help@acme.example'), 'mailto:help@acme.example');
    assert.equal(appLink(brand, '/tasks/RB-1'), 'https://app.acme.example/tasks/RB-1');
    assert.equal(appLink(brand, 'inbox'), 'https://app.acme.example/inbox');
  });

  it('refuses to render a template with a relative link', () => {
    assert.throws(
      () =>
        renderEmail(
          {
            category: 'digest',
            kind: 'notification',
            subject: 's',
            preheader: 'p',
            heading: 'h',
            blocks: [{ t: 'button', href: '/relative', label: 'Go' }],
            reason: 'r',
          },
          brand,
        ),
      /absolute/,
    );
  });

  it('picks readable button text for the brand colour', () => {
    assert.equal(onColor('#4f46e5'), '#ffffff');
    assert.equal(onColor('#0f766e'), '#ffffff');
    assert.equal(onColor('#facc15'), '#111827');
    assert.equal(onColor('#ffffff'), '#111827');
  });

  it('renders a text wordmark when no logo is configured', () => {
    const plain = { ...brand, logoUrl: undefined };
    const m = sampleEmails(plain)['sign-in-alert'];
    assert.ok(!/<img\b/.test(m.html));
    assert.ok(m.html.includes('Acme Cloud</span>'));
  });

  it('omits the address line when none is configured', () => {
    const m = sampleEmails({ ...brand, postalAddress: '' })['invite'];
    assert.ok(m.html.includes('Acme Cloud Technologies Ltd<br>'));
  });

  it('wraps text at 76 columns without splitting links', () => {
    const long = `word `.repeat(40) + 'https://app.acme.example/' + 'x'.repeat(100);
    for (const line of wrap(long).split('\n'))
      assert.ok(line.length <= 76 || line.startsWith('https://'), line);
  });

  it('keeps the recovery email compatible: button label, token link, escaping', () => {
    const tpl = recoveryEmail(
      XSS,
      'https://app.acme.example/reset-password?token=abc',
      30,
      undefined,
      brand,
    );
    assert.ok(tpl.html.includes('Choose a new password'));
    assert.ok(tpl.html.includes('&lt;script&gt;'));
    assert.ok(tpl.text.includes('token=abc'));
    assert.equal(tpl.category, 'password-reset');
  });
});
