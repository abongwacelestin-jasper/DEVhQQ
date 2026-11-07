import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/render';
import { RichText, safeHref, type RichTextOptions } from './RichText';

function show(text: string, opts: RichTextOptions = {}) {
  const { container } = renderWithRouter(
    <p data-testid="msg">
      <RichText text={text} {...opts} />
    </p>,
  );
  return container.querySelector('[data-testid="msg"]') as HTMLElement;
}

describe('RichText — safeHref', () => {
  it.each([
    ['https://devhq.app/x', 'https://devhq.app/x'],
    ['  http://example.test ', 'http://example.test/'],
    ['mailto:ops@devhq.app', 'mailto:ops@devhq.app'],
  ])('allows %s', (raw, out) => expect(safeHref(raw)).toBe(out));

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '//evil.example/x',
    '/relative',
    'https://',
    '',
  ])('refuses %s', (raw) => expect(safeHref(raw)).toBeNull());
});

describe('RichText — never produces markup from text', () => {
  it('renders HTML in a message as literal text', () => {
    const el = show('<img src=x onerror=alert(1)> <script>alert(2)</script> <b>bold</b>');
    expect(el.querySelector('img, script, b')).toBeNull();
    expect(el.textContent).toBe(
      '<img src=x onerror=alert(1)> <script>alert(2)</script> <b>bold</b>',
    );
  });

  it('a javascript: markdown link becomes plain label text, not an anchor', () => {
    for (const text of [
      '[click](javascript:alert(1))',
      '[click](JAVASCRIPT:alert`1`)',
      '[x](data:text/html;base64,PHNjcmlwdD4=)',
    ]) {
      const el = show(text);
      expect(el.querySelector('a'), text).toBeNull();
      expect(el.textContent).toContain(text.startsWith('[click]') ? 'click' : 'x');
    }
  });

  it('safe links open in a new tab with noopener noreferrer', () => {
    const el = show(
      'see [the runbook](https://devhq.app/docs/runbook) or https://status.devhq.app.',
    );
    const links = [...el.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://devhq.app/docs/runbook',
      'https://status.devhq.app/',
    ]);
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(links[0].textContent).toBe('the runbook');
    expect(el.textContent?.endsWith('.')).toBe(true);
  });

  it('mailto links do not open a new tab', () => {
    const a = show('mail mailto:ops@devhq.app now').querySelector('a');
    expect(a?.getAttribute('href')).toBe('mailto:ops@devhq.app');
    expect(a?.getAttribute('target')).toBeNull();
  });

  it('allowLinks=false renders external links inert', () => {
    const el = show('go https://evil.example/x and [here](https://evil.example/y)', {
      allowLinks: false,
    });
    expect(el.querySelector('a')).toBeNull();
    const inert = [...el.querySelectorAll('span.line-through')];
    expect(inert.map((s) => s.textContent)).toEqual(['https://evil.example/x', 'here']);
    expect(inert[0].getAttribute('title')).toMatch(/disabled/);
  });
});

describe('RichText — formatting', () => {
  it('bold, italic, strike and code', () => {
    const el = show('**bold** *it* _it2_ ~~gone~~ `x`');
    expect(el.querySelector('strong')?.textContent).toBe('bold');
    expect([...el.querySelectorAll('em')].map((e) => e.textContent)).toEqual(['it', 'it2']);
    expect(el.querySelector('s')?.textContent).toBe('gone');
    expect(el.querySelector('code')?.textContent).toBe('x');
  });

  it('nothing inside a code span is formatted or linked', () => {
    const el = show('`**not bold** https://x.test @m4 RB-1`');
    expect(el.querySelector('code')?.textContent).toBe('**not bold** https://x.test @m4 RB-1');
    expect(el.querySelector('strong, a, em')).toBeNull();
  });

  it('snake_case and arithmetic are not italicised', () => {
    const el = show('call get_user_name and 2*3*4');
    expect(el.querySelector('em')).toBeNull();
    expect(el.textContent).toBe('call get_user_name and 2*3*4');
  });

  it('task keys, incidents and PR refs link inside the app', () => {
    const el = show('RB-221 broke INC-31, fixed in #148');
    const hrefs = [...el.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/tasks/RB-221', '/incidents/INC-31', '/pull-requests/148']);
    for (const a of el.querySelectorAll('a')) expect(a.getAttribute('target')).toBeNull();
  });

  it('preserves line breaks', () => {
    expect(show('one\ntwo\n\nthree').textContent).toBe('one\ntwo\n\nthree');
  });

  it('highlights the search needle case-insensitively (≥ 2 chars), never inside tokens', () => {
    const el = show('Deploy failed, deploy again', { highlight: 'DEPLOY' });
    expect([...el.querySelectorAll('mark')].map((m) => m.textContent)).toEqual([
      'Deploy',
      'deploy',
    ]);
    expect(show('abc', { highlight: 'a' }).querySelector('mark')).toBeNull();
    expect(show('none here', { highlight: 'zz' }).querySelector('mark')).toBeNull();
  });
});

describe('RichText — mentions', () => {
  const people = new Map([
    ['m4', 'Kofi Mensah'],
    ['m11', 'Grace Liu'],
  ]);

  it('known ids render as @Name; unknown ids stay plain text', () => {
    const el = show('ping @m4 and @M11, not @m99', { mentionable: people });
    const chips = [...el.querySelectorAll('span.font-medium')];
    expect(chips.map((c) => c.textContent)).toEqual(['@Kofi Mensah', '@Grace Liu']);
    expect(chips[0].getAttribute('title')).toBe('@m4');
    expect(el.textContent).toContain('not @m99');
  });

  it('trailing punctuation stays outside the mention', () => {
    const el = show('thanks @m4.', { mentionable: people });
    expect(el.querySelector('span.font-medium')?.textContent).toBe('@Kofi Mensah');
    expect(el.textContent).toBe('thanks @Kofi Mensah.');
  });

  it('@channel and @everyone are always highlighted', () => {
    const el = show('@channel @everyone', { mentionable: people });
    expect([...el.querySelectorAll('span.font-medium')].map((c) => c.textContent)).toEqual([
      '@channel',
      '@everyone',
    ]);
  });

  it('without a member map, any @handle is styled', () => {
    expect(show('hi @someone').querySelector('span.font-medium')?.textContent).toBe('@someone');
  });

  // FINDING F-FE-10 (components/messaging/RichText.tsx:29, TOKEN group 8): the
  // mention pattern has no left boundary, so the domain part of an email
  // address is tokenised as a mention. Where no member map is passed (the
  // assistant panel, AssistantPanel.tsx:411) "write to ada@example.com"
  // renders "@example.com" as a highlighted mention chip. Mentions should only
  // start at the beginning of a line or after whitespace, like #123 refs do.
  it.fails('an email address is not split into text plus a mention', () => {
    const el = show('write to ada@example.com');
    expect(el.querySelector('span.font-medium')).toBeNull();
    expect(screen.getByText('write to ada@example.com')).toBeDefined();
  });
});
