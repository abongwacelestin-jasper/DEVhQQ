import { describe, expect, it } from 'vitest';
import { buildSnippet, snippetKinds, type SnippetKind } from './snippets';

const base = {
  method: 'POST',
  origin: 'http://localhost:8080/',
  url: '/api/tasks',
  body: '{"title":"Fix login","estimate":2}',
  headers: [['X-Request-Id', 'abc']] as [string, string][],
  token: 'live-token-123',
  includeToken: false,
};

const kinds = snippetKinds.map((k) => k.id);

/** Reads one POSIX single-quoted word (as produced by the snippet's sq helper) back to its value. */
function unquoteShell(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === "'") {
      const end = s.indexOf("'", i + 1);
      out += s.slice(i + 1, end);
      i = end + 1;
    } else if (s[i] === '\\') {
      out += s[i + 1];
      i += 2;
    } else throw new Error(`unquoted character ${s[i]} in ${s}`);
  }
  return out;
}

describe('buildSnippet', () => {
  it('offers nine distinct clients', () => {
    expect(new Set(kinds).size).toBe(9);
  });

  it.each(kinds)('%s: targets the full URL and never leaks the live token unless opted in', (k) => {
    const out = buildSnippet(k, base);
    expect(out).not.toContain('live-token-123');
    expect(out).toContain(k === 'http' ? '/api/tasks' : 'http://localhost:8080/api/tasks');
    expect(out).toContain(k === 'axios' ? 'method: "post"' : 'POST');
    expect(out).toContain('X-Request-Id');
  });

  it.each(kinds)('%s: includes the live token only when includeToken is set', (k) => {
    expect(buildSnippet(k, { ...base, includeToken: true })).toContain('Bearer live-token-123');
    expect(buildSnippet(k, { ...base, includeToken: true, token: null })).not.toContain('null');
  });

  it.each(kinds.filter((k) => k !== 'http'))(
    '%s: falls back to the DEVHQ_TOKEN environment variable',
    (k) => {
      expect(buildSnippet(k, base)).toContain('DEVHQ_TOKEN');
    },
  );

  it('raw HTTP uses a <token> placeholder, the Host header and a correct Content-Length', () => {
    const out = buildSnippet('http', base);
    const compact = JSON.stringify(JSON.parse(base.body));
    expect(out).toContain('Host: localhost:8080');
    expect(out).toContain('Authorization: Bearer <token>');
    expect(out).toContain(`Content-Length: ${new TextEncoder().encode(compact).length}`);
    expect(out.endsWith(compact)).toBe(true);
    expect(buildSnippet('http', { ...base, origin: 'not a url' })).toContain(
      'Host: localhost:8080',
    );
  });

  it('omits body and content type for an empty body', () => {
    const get = { ...base, method: 'GET', body: '  ' };
    for (const k of ['curl', 'httpie', 'wget', 'go', 'powershell', 'http'] as SnippetKind[]) {
      const out = buildSnippet(k, get);
      expect(out).not.toMatch(/Content-Type|ContentType|--data-raw|--raw|body-data/);
    }
    expect(buildSnippet('fetch', get)).not.toContain('body:');
    expect(buildSnippet('axios', get)).not.toContain('data:');
    expect(buildSnippet('python', get)).not.toContain('json=');
  });

  it('passes a non-JSON body through unchanged', () => {
    expect(buildSnippet('curl', { ...base, body: 'a=1&b=2' })).toContain("--data-raw 'a=1&b=2'");
  });

  it('skips header rows with an empty name', () => {
    const out = buildSnippet('curl', { ...base, headers: [['', 'ignored']] });
    expect(out).not.toContain('ignored');
  });

  it('curl: shell-quotes every value so quotes in data cannot break out', () => {
    const tricky = [`it's`, `'; rm -rf / #`, `$(whoami)`, '`id`', `a\\b"c`];
    for (const t of tricky) {
      const out = buildSnippet('curl', {
        ...base,
        url: `/api/tasks?q=${t}`,
        body: JSON.stringify({ title: t }),
        headers: [['X-Note', t]],
        token: t,
        includeToken: true,
      });
      const lines = out.split(' \\\n');
      const words = lines.map((l) => l.trim());
      expect(unquoteShell(words[0].replace(/^curl -sS -X POST /, ''))).toBe(
        `http://localhost:8080/api/tasks?q=${t}`,
      );
      expect(unquoteShell(words[1].replace(/^-H /, ''))).toBe(`Authorization: Bearer ${t}`);
      expect(unquoteShell(words[3].replace(/^-H /, ''))).toBe(`X-Note: ${t}`);
      expect(JSON.parse(unquoteShell(words[4].replace(/^--data-raw /, '')))).toEqual({
        title: t,
      });
    }
  });

  it('python: converts JSON literals to Python literals', () => {
    const out = buildSnippet('python', {
      ...base,
      body: '{"done":true,"flag":false,"reviewer":null}',
    });
    expect(out).toContain('"done": True');
    expect(out).toContain('"flag": False');
    expect(out).toContain('"reviewer": None');
  });

  // FINDING F-FE-2: the Python snippet converts JSON literals with a global regex
  // over the pretty-printed body, so the words true/false/null *inside string
  // values* are rewritten too: {"note":"true story"} becomes {"note": "True story"}.
  // The generated request then sends different data than the user typed.
  it.fails('python: leaves the words true/false/null inside strings alone (F-FE-2)', () => {
    const out = buildSnippet('python', { ...base, body: '{"note":"true or false, not null"}' });
    expect(out).toContain('"note": "true or false, not null"');
  });

  // FINDING F-FE-3: the PowerShell snippet wraps the URL in single quotes without
  // escaping, so a URL containing a quote (e.g. a search for "it's") produces a
  // broken command: -Uri 'http://…?q=it's'. PowerShell escapes ' as ''.
  it.fails('powershell: escapes single quotes in the URL (F-FE-3)', () => {
    const out = buildSnippet('powershell', { ...base, url: "/api/tasks?q=it's" });
    expect(out).toContain("-Uri 'http://localhost:8080/api/tasks?q=it''s'");
  });

  it('powershell: sends the body as a here-string with a JSON content type', () => {
    const out = buildSnippet('powershell', base);
    expect(out).toContain("$body = @'");
    expect(out).toContain("-ContentType 'application/json' -Body $body");
    expect(out).toContain('"Authorization" = "Bearer $env:DEVHQ_TOKEN"');
  });

  it('go: imports strings only when there is a body', () => {
    expect(buildSnippet('go', base)).toContain('"strings"');
    expect(buildSnippet('go', { ...base, body: '' })).not.toContain('"strings"');
  });
});
