/** Every email template: HTML + text parts, branded footer, escaping, absolute links. */
import '../setup.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadMailConfig } from '../../config/mail.ts';
import {
  TONES,
  appLink,
  contrast,
  onColor,
  renderEmail,
  safeHref,
  wrap,
} from '../../mail/layout.ts';
import {
  firstName,
  formatDay,
  priorityLabel,
  product,
  taskStatusLabel,
} from '../../mail/labels.ts';
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
const imgs = (html: string) =>
  [...html.matchAll(/<img\b[^>]*>/g)].map((m) => ({
    tag: m[0],
    src: /\bsrc="([^"]*)"/.exec(m[0])?.[1] ?? '',
  }));

const SECURITY = new Set([
  'password-reset',
  'password-changed',
  'sign-in-alert',
  'mfa-enrolled',
  'backup-codes-generated',
  'backup-code-used',
  'account-locked',
]);

/** Raw values of the task, incident and deployment enums, as a whole value (cell, pill, text field). */
const RAW =
  '(?:todo|in-progress|review|backlog|urgent|high|medium|low|investigating|identified|monitoring|resolved|staging|production|renewberry|Renewberry)';
const RAW_HTML = new RegExp(`>\\s*${RAW}\\s*<`);
const RAW_TEXT = new RegExp(`(?:^|: +| · )${RAW}(?: · |$)`, 'm');

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

    it('uses only absolute https links', () => {
      const links = hrefs(mail.html);
      assert.ok(links.length >= 2);
      for (const h of links) assert.match(h, /^(https:\/\/|mailto:)/, h);
      for (const u of mail.text.match(/\b(?:https?:\/\/|www\.)\S+/g) ?? [])
        assert.match(u, /^https:\/\//, u);
    });

    it('uses absolute https images, each with alt, width and height', () => {
      const tags = imgs(mail.html);
      assert.ok(tags.length >= 1);
      assert.equal(tags[0].src, 'https://cdn.acme.example/brand/logo@2x.png', 'logo first');
      for (const t of tags) {
        assert.match(t.src, /^https:\/\//, t.src);
        assert.ok(/\balt="[^"]*"/.test(t.tag), `alt on ${t.src}`);
        assert.ok(/\bwidth="\d+"/.test(t.tag), `width on ${t.src}`);
        assert.ok(/display:(block|inline-block)/.test(t.tag), `display on ${t.src}`);
      }
      for (const t of tags.slice(1)) {
        assert.ok(/\bheight="\d+"/.test(t.tag), `height on ${t.src}`);
        assert.ok(/background-color:#[0-9a-f]{6}/.test(t.tag), `fallback colour on ${t.src}`);
        assert.ok(t.src.startsWith(`${brand.assetBaseUrl}/email/`), t.src);
      }
    });

    if (SECURITY.has(mail.category))
      it('is a security notice: no image but the logo, a shield drawn in HTML', () => {
        assert.deepEqual(
          imgs(mail.html).map((t) => t.src),
          ['https://cdn.acme.example/brand/logo@2x.png'],
        );
        assert.ok(/class="tile-(warn|bad|accent)"/.test(mail.html), 'HTML shield tile');
        assert.ok(!mail.html.includes('Notification settings'), 'cannot be turned off');
      });
    else
      it('has exactly one hero image with alt text, width and height', () => {
        const heroes = imgs(mail.html).filter((t) => /class="hero"/.test(t.tag));
        assert.equal(heroes.length, 1);
        const [h] = heroes;
        assert.match(h.tag, /\bwidth="520"/);
        assert.match(h.tag, /\bheight="208"/);
        assert.match(h.tag, /\balt="[^"]{10,}"/);
        assert.match(h.src, /^https:\/\/app\.acme\.example\/brand\/email\/hero-[a-z]+\.jpg$/);
        assert.ok(mail.html.includes('>Help<'), 'footer navigation');
      });

    it('greets by first name', () => {
      if (!/\bHi /.test(mail.text)) return;
      assert.ok(!/Hello /.test(mail.text));
      assert.ok(!/Hi [A-Z][a-z]+ [A-Z][a-z]+,/.test(mail.text), 'no full name in the greeting');
      assert.ok(!/>Hi [A-Z][a-z]+ [A-Z][a-z]+,/.test(mail.html));
    });

    it('shows human labels, never raw enum values or lower-case product ids', () => {
      assert.ok(!RAW_HTML.test(mail.html), `raw value in HTML: ${RAW_HTML.exec(mail.html)?.[0]}`);
      assert.ok(!RAW_TEXT.test(mail.text), `raw value in text: ${RAW_TEXT.exec(mail.text)?.[0]}`);
      assert.ok(!/\bRenewberry\b/.test(mail.html + mail.text), 'product display name');
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

describe('mail content — human details', () => {
  it('greets by first name and falls back to a single-word name', () => {
    assert.equal(firstName('Kofi Mensah'), 'Kofi');
    assert.equal(firstName('  Ines  Duarte '), 'Ines');
    assert.equal(firstName('Prince'), 'Prince');
    assert.match(emails['task-assigned'].text, /^Hi Kofi,$/m);
    assert.ok(emails['task-assigned'].html.includes('>Hi Kofi,</p>'));
    assert.match(emails['offboarding-handover'].text, /^Hi Ines,$/m);
  });

  it('labels every enum and shows the product display name with its mark', () => {
    assert.deepEqual(priorityLabel('high'), { label: 'High', tone: 'warn' });
    assert.equal(taskStatusLabel('todo').label, 'To do');
    assert.equal(taskStatusLabel('review').label, 'In review');
    assert.equal(taskStatusLabel('some_new-state').label, 'Some new state');
    assert.deepEqual(product('Renewberry'), { id: 'renewberry', name: 'RenewBerry' });
    assert.deepEqual(product('mirror'), { id: 'mirror', name: 'Mirror Acture' });
    const task = emails['task-assigned'];
    for (const l of ['To do', 'High priority', 'RenewBerry']) assert.ok(task.text.includes(l), l);
    assert.ok(task.html.includes('class="pill pill-warn"'));
    assert.ok(task.html.includes('src="https://app.acme.example/brand/email/mark-renewberry.png"'));
    const inc = emails['incident-assigned'];
    for (const l of ['SEV1 · Critical', 'Investigating']) assert.ok(inc.text.includes(l), l);
    assert.ok(emails['deployment-approval'].text.includes('Production'));
  });

  it('formats dates with weekday and a relative day in the member time zone', () => {
    assert.equal(
      formatDay('2026-11-14', { now: '2026-11-07T14:03:00Z' }),
      'Sat 14 Nov 2026 · in 7 days',
    );
    assert.equal(
      formatDay('2026-11-08', { now: '2026-11-07T23:30:00Z', timeZone: 'Africa/Lagos' }),
      'Sun 8 Nov 2026 · today',
    );
    assert.equal(formatDay('2026-11-07T23:30:00Z', { timeZone: 'Africa/Lagos' }), 'Sun 8 Nov 2026');
    assert.ok(emails['task-assigned'].text.includes('Sat 14 Nov 2026 · in 7 days'));
  });

  it('links straight to the task, incident and deployment', () => {
    assert.ok(
      hrefs(emails['task-assigned'].html).includes('https://app.acme.example/tasks/RB-142'),
    );
    assert.ok(
      hrefs(emails['incident-assigned'].html).includes('https://app.acme.example/incidents/INC-27'),
    );
    assert.ok(
      hrefs(emails['deployment-approval'].html).includes(
        'https://app.acme.example/deployments/dep-311',
      ),
    );
  });

  it('groups the digest by type with counts', () => {
    const d = emails['digest-daily'];
    for (const g of [
      'Waiting for your approval (1)',
      'Assigned to you (1)',
      'Mentions and comments (2)',
    ])
      assert.ok(d.text.includes(g), g);
    assert.ok(d.text.indexOf('Waiting for your approval') < d.text.indexOf('Assigned to you'));
  });

  it('keeps pill text readable in light and dark mode', () => {
    for (const [tone, t] of Object.entries(TONES)) {
      assert.ok(contrast(t.fg, t.bg) >= 4.5, `${tone} light ${contrast(t.fg, t.bg).toFixed(2)}`);
      assert.ok(contrast(t.darkFg, t.darkBg) >= 4.5, `${tone} dark`);
    }
  });

  it('refuses an illustration on a security notice', () => {
    assert.throws(
      () =>
        renderEmail(
          {
            category: 'sign-in-alert',
            kind: 'security',
            subject: 's',
            preheader: 'p',
            heading: 'h',
            hero: 'invite',
            blocks: [],
            reason: 'r',
          },
          brand,
        ),
      /no illustration/,
    );
  });
});
