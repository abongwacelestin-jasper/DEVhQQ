/**
 * Generates docs/api/error-codes.md by scanning every `new HttpError(...)`
 * in the backend.
 *
 *   node --experimental-strip-types docs/scripts/gen-errors.ts [--check]
 *
 * Only literal status/code pairs are collected; that is the only style the
 * backend uses. Messages written as template literals are shown with their
 * `${...}` placeholders.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, emit, generatedBanner, walk, rel, cell } from './lib.ts';

interface Hit {
  status: number;
  code: string;
  message: string;
  file: string;
  line: number;
}

const files = walk(join(ROOT, 'Backend'), (n) => n.endsWith('.ts'), [
  'Backend/scripts',
  'Backend/test',
]);
const hits: Hit[] = [];
// The message is optional in the match: some call sites pass a variable or an expression.
const re = /new HttpError\(\s*(\d{3}),\s*'([a-z_]+)',\s*(?:(['`"])((?:\\.|(?!\3)[\s\S])*?)\3)?/g;

for (const abs of files) {
  const src = readFileSync(abs, 'utf8');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    hits.push({
      status: Number(m[1]),
      code: m[2],
      message: m[3] ? m[4].replace(/\s+/g, ' ') : '_(computed at runtime)_',
      file: rel(abs),
      line: src.slice(0, m.index).split('\n').length,
    });
  }
}

/**
 * Domain errors that a route rethrows as `new HttpError(<status>, e.code, e.message)`.
 * Their codes are collected from `new <Class>('code', 'message')` call sites.
 * Add a row when a module introduces another such wrapper.
 */
const WRAPPERS: { cls: string; status: number }[] = [{ cls: 'BackupError', status: 422 }];

for (const w of WRAPPERS) {
  const wre = new RegExp(
    `new ${w.cls}\\(\\s*'([a-z_]+)',\\s*(?:(['\`"])((?:\\\\.|(?!\\2)[\\s\\S])*?)\\2)?`,
    'g',
  );
  for (const abs of files) {
    const src = readFileSync(abs, 'utf8');
    for (const m of src.matchAll(wre))
      hits.push({
        status: w.status,
        code: m[1],
        message: m[2] ? m[3].replace(/\s+/g, ' ') : '_(computed at runtime)_',
        file: rel(abs),
        line: src.slice(0, m.index).split('\n').length,
      });
  }
}

/**
 * Call sites whose status or code is computed. Each is listed by hand with the
 * values it can produce; the check below fails if a new computed site appears
 * that is not listed here.
 */
const COMPUTED: { file: string; marker: string; status: number; code: string; message: string }[] =
  [
    {
      file: 'Backend/routes/files.routes.ts',
      marker: "e.code === 'StorageUnavailable'",
      status: 503,
      code: 'storage_unavailable',
      message: 'Object storage request failed',
    },
    {
      file: 'Backend/routes/files.routes.ts',
      marker: "e.code === 'StorageUnavailable'",
      status: 502,
      code: 'storage_error',
      message: 'Object storage request failed',
    },
    ...(['bad_signature', 'replayed', 'signature_expired'] as const).map((code) => ({
      file: 'Backend/routes/insights.routes.ts',
      marker: 'new HttpError(401, err,',
      status: 401,
      code,
      message: 'Invalid service signature',
    })),
  ];
for (const c of COMPUTED) {
  const src = readFileSync(join(ROOT, c.file), 'utf8');
  const at = src.indexOf(c.marker);
  if (at < 0) {
    console.error(
      `✗ ${c.file}: computed HttpError marker not found — update COMPUTED in gen-errors.ts`,
    );
    process.exit(1);
  }
  hits.push({
    status: c.status,
    code: c.code,
    message: c.message,
    file: c.file,
    line: src.slice(0, at).split('\n').length,
  });
}

// Errors raised with a non-literal code would be invisible to this scan; make that loud.
for (const abs of files) {
  const src = readFileSync(abs, 'utf8');
  for (const m of src.matchAll(/new HttpError\(([^)]{0,80})/g)) {
    const wrapped = WRAPPERS.some((w) =>
      new RegExp(`instanceof ${w.cls}\\)\\s*throw\\s*$`).test(src.slice(0, m.index)),
    );
    const listed = COMPUTED.some(
      (c) =>
        c.file === rel(abs) &&
        src.slice(m.index, m.index + 200).includes(c.marker.replace(/^new HttpError\(/, '')),
    );
    if (
      !/^\s*\d{3},\s*'[a-z_]+'/.test(m[1]) &&
      !/^\s*e\.status/.test(m[1]) &&
      !wrapped &&
      !listed
    ) {
      console.error(`✗ ${rel(abs)}: HttpError with a non-literal status/code: ${m[0]}`);
      process.exit(1);
    }
  }
}

const codes = [...new Set(hits.map((h) => h.code))].sort((a, b) => {
  const sa = Math.min(...hits.filter((h) => h.code === a).map((h) => h.status));
  const sb = Math.min(...hits.filter((h) => h.code === b).map((h) => h.status));
  return sa - sb || a.localeCompare(b);
});

let md = generatedBanner('gen-errors.ts', ['new HttpError(…) in Backend/**/*.ts']);
md += `
# Error codes

Every error the API raises has a stable machine-readable \`code\`. Branch on
\`code\`, never on \`message\` (messages are for people and may change). The
envelope and client guidance are in [Errors](errors.md).

**${codes.length} codes** from **${hits.length} call sites**. The status column lists every
status a code is raised with; most codes have exactly one.

| Code | Status | Example message | Raised in |
|---|---|---|---|
`;

for (const code of codes) {
  const list = hits.filter((h) => h.code === code);
  const statuses = [...new Set(list.map((h) => h.status))].sort().join(', ');
  // Literal messages before computed ones, then the most frequent, then the
  // shortest: usually the most generic wording.
  const freq = (msg: string) => list.filter((h) => h.message === msg).length;
  const computed = (msg: string) => (msg.startsWith('_(computed') ? 1 : 0);
  const messages = [...new Set(list.map((h) => h.message))].sort(
    (a, b) => computed(a) - computed(b) || freq(b) - freq(a) || a.length - b.length,
  );
  const where = [...new Set(list.map((h) => h.file.replace(/^Backend\//, '')))];
  md += `| \`${code}\` | ${statuses} | ${cell(messages[0])}${messages.length > 1 ? ` _(+${messages.length - 1} more)_` : ''} | ${where
    .map((f) => `\`${f}\``)
    .join(', ')} |\n`;
}

md += `
\`internal\` is the router's catch-all: any exception that is not an
\`HttpError\` becomes \`500 internal\` with the message \`Unexpected error\`
(\`Backend/lib/http.ts\`). The stack trace is logged server-side with the
request id and never sent to the client.
`;

emit('docs/api/error-codes.md', md);
