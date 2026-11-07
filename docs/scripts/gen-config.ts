/**
 * Generates docs/operations/env-vars.md: every environment variable the code
 * reads, where, and whether `.env.example` mentions it.
 *
 *   node --experimental-strip-types docs/scripts/gen-config.ts [--check]
 *
 * Patterns recognised (the only styles used in this repository):
 *  - TypeScript: `process.env.NAME`, `process.env['NAME']`, and the helper calls
 *    `required('NAME')`, `int('NAME')`, `env('NAME')`, `positiveInt('NAME')`;
 *    `import.meta.env.NAME` in the frontend.
 *  - Python (Models): `os.environ.get("NAME")`, `os.getenv("NAME")`,
 *    `_bool/_int/_secret("NAME")`.
 * `*_FILE` support comes from `SECRET_VARS` in infra/docker/entrypoint.sh
 * (backend) and from `_secret(...)` (models).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, emit, generatedBanner, walk, rel } from './lib.ts';

type Pkg = 'Backend' | 'Frontend' | 'Models';
const uses = new Map<string, Map<Pkg, Set<string>>>();
const add = (name: string, pkg: Pkg, file: string) => {
  const byPkg = uses.get(name) ?? new Map<Pkg, Set<string>>();
  const files = byPkg.get(pkg) ?? new Set<string>();
  files.add(file);
  byPkg.set(pkg, files);
  uses.set(name, byPkg);
};

const TS = [
  /process\.env\.([A-Z][A-Z0-9_]*)\b/g,
  /process\.env\[\s*'([A-Z][A-Z0-9_]*)'\s*\]/g,
  /\b(?:required|int|env|positiveInt)\(\s*'([A-Z][A-Z0-9_]*)'/g,
  /import\.meta\.env\.([A-Z][A-Z0-9_]*)\b/g,
];
const PY = [
  /os\.environ\.get\(\s*"([A-Z][A-Z0-9_]*)"/g,
  /os\.getenv\(\s*"([A-Z][A-Z0-9_]*)"/g,
  /os\.environ\.setdefault\(\s*"([A-Z][A-Z0-9_]*)"/g,
  /\b_(?:bool|int|secret)\(\s*"([A-Z][A-Z0-9_]*)"/g,
];
/** Variables Node or the runtime set, not configuration. */
const IGNORE = new Set(['NODE_V8_COVERAGE', 'PATH']);

const scan = (
  pkg: Pkg,
  dir: string,
  test: (n: string) => boolean,
  patterns: RegExp[],
  skip: string[] = [],
) => {
  if (!existsSync(join(ROOT, dir))) return;
  for (const abs of walk(join(ROOT, dir), test, skip)) {
    const src = readFileSync(abs, 'utf8');
    for (const re of patterns)
      for (const m of src.matchAll(re))
        if (!IGNORE.has(m[1])) add(m[1], pkg, rel(abs).replace(`${pkg}/`, ''));
  }
};

scan('Backend', 'Backend', (n) => n.endsWith('.ts'), TS, ['Backend/test']);
// Frontend source contains sample code (editor snippets) that mentions
// process.env.*; only import.meta.env is real configuration there.
scan('Frontend', 'Frontend/src', (n) => /\.tsx?$/.test(n), [TS[3]]);
if (existsSync(join(ROOT, 'Frontend/vite.config.ts'))) {
  const src = readFileSync(join(ROOT, 'Frontend/vite.config.ts'), 'utf8');
  for (const re of TS) for (const m of src.matchAll(re)) add(m[1], 'Frontend', 'vite.config.ts');
}
scan('Models', 'Models', (n) => n.endsWith('.py'), PY, ['Models/tests']);

const entrypoint = join(ROOT, 'infra/docker/entrypoint.sh');
const fileSecrets = new Set<string>();
if (existsSync(entrypoint)) {
  const block = /SECRET_VARS="([^"]*)"/.exec(readFileSync(entrypoint, 'utf8'))?.[1] ?? '';
  for (const n of block.split(/\s+/).filter(Boolean)) fileSecrets.add(n);
}
const modelSecrets = new Set<string>();
for (const abs of existsSync(join(ROOT, 'Models'))
  ? walk(join(ROOT, 'Models'), (n) => n.endsWith('.py'), ['Models/tests'])
  : [])
  for (const m of readFileSync(abs, 'utf8').matchAll(/\b_secret\(\s*"([A-Z][A-Z0-9_]*)"/g))
    modelSecrets.add(m[1]);

const example = existsSync(join(ROOT, '.env.example'))
  ? readFileSync(join(ROOT, '.env.example'), 'utf8')
  : '';
const inExample = (n: string) =>
  new RegExp(`^#?\\s*${n}=`, 'm').test(example) || new RegExp(`\\b${n}\\b`).test(example);

const names = [...uses.keys()].sort();
const cellFor = (n: string, pkg: Pkg) => {
  const files = uses.get(n)?.get(pkg);
  return files
    ? [...files]
        .sort()
        .map((f) => `\`${f}\``)
        .join('<br>')
    : '';
};

let md = generatedBanner('gen-config.ts', [
  'process.env / import.meta.env / os.environ reads',
  'infra/docker/entrypoint.sh',
  '.env.example',
]);
md += `
# Environment variables (generated)

Every variable read by the code, found by scanning \`Backend/\`, \`Frontend/\`
and \`Models/\`. What each one means and its defaults are in the
hand-written [configuration reference](configuration.md); this page is the
drift check: if code starts reading a new variable, it appears here.

**${names.length} variables.** "\`_FILE\`" means the container can pass the
value as a file path in \`NAME_FILE\` (compose secrets) instead of \`NAME\`.

| Variable | Backend | Frontend | Models | \`_FILE\` | In \`.env.example\` |
|---|---|---|---|---|---|
`;
for (const n of names) {
  const file = fileSecrets.has(n) || modelSecrets.has(n) ? 'yes' : '';
  md += `| \`${n}\` | ${cellFor(n, 'Backend')} | ${cellFor(n, 'Frontend')} | ${cellFor(n, 'Models')} | ${file} | ${inExample(n) ? 'yes' : ''} |\n`;
}

const exampleOnly = [...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)]
  .map((m) => m[1])
  .filter((n, i, a) => a.indexOf(n) === i && !uses.has(n) && !n.endsWith('_FILE'))
  .sort();
md += `
## In \`.env.example\` but not read by application code

Usually Compose or edge settings (read by \`docker-compose.yml\`, the Caddyfile
or scripts, not by the Node/Python code).

${exampleOnly.length ? exampleOnly.map((n) => `\`${n}\``).join(' · ') : 'None.'}
`;

emit('docs/operations/env-vars.md', md);
