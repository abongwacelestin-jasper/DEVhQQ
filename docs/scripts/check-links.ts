/**
 * Docs linter: every relative link and every referenced repository path must
 * exist.
 *
 *   node --experimental-strip-types docs/scripts/check-links.ts
 *
 * Checks, outside fenced code blocks:
 *  1. Markdown links and images with a relative target — the file or
 *     directory must exist; `#anchor` on a `.md` target (or on the same page)
 *     must match a heading, using GitHub's slug rules.
 *  2. Inline code spans that look like a repository path
 *     (`Backend/auth/rbac.ts`, `docs/api/`, `.env.example`, …) — the path must
 *     exist relative to the repository root.
 *
 * Exception: inside a "Planned: Wave 4" admonition (a blockquote containing
 * that phrase) missing targets are allowed, because they describe files other
 * lanes have not merged yet. They are listed as "pending" so phase 2 can find
 * and resolve every one of them.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ROOT, rel, walk } from './lib.ts';

/** Directories under docs/ owned by other lanes — not ours to lint. */
const FOREIGN = ['docs/agents', 'docs/security', 'docs/deploy', 'docs/qa'];

const files = [
  ...walk(join(ROOT, 'docs'), (n) => n.endsWith('.md'), FOREIGN),
  ...['Backend/README.md', 'Frontend/README.md', 'CONTRIBUTING.md', 'CHANGELOG.md']
    .map((f) => join(ROOT, f))
    .filter(existsSync),
];

const PATH_ROOTS =
  /^(Backend|Frontend|Models|docs|infra|e2e|security-tests|\.github|\.husky)\/[^\s]*$/;
const ROOT_FILES = new Set([
  'README.md',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  'LICENSE',
  '.env.example',
  '.npmrc',
  '.gitignore',
  '.editorconfig',
  '.prettierrc',
  'eslint.config.mjs',
  'package.json',
  'package-lock.json',
  'docker-compose.yml',
  'Makefile',
]);

interface Problem {
  file: string;
  line: number;
  msg: string;
}
const problems: Problem[] = [];
const pending: Problem[] = [];

// ── Heading slugs (GitHub flavour) ─────────────────────────────────────────
const slugCache = new Map<string, Set<string>>();

export function slugify(heading: string): string {
  return heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → text
    .replace(/<[^>]+>/g, '') // inline HTML
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function slugsOf(abs: string): Set<string> {
  const hit = slugCache.get(abs);
  if (hit) return hit;
  const seen = new Map<string, number>();
  const out = new Set<string>();
  let fence = false;
  for (const line of readFileSync(abs, 'utf8').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = slugify(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n === 0 ? base : `${base}-${n}`);
  }
  slugCache.set(abs, out);
  return out;
}

// ── Scan ───────────────────────────────────────────────────────────────────
for (const abs of files) {
  const file = rel(abs);
  const lines = readFileSync(abs, 'utf8').split('\n');

  // Mark lines that belong to a "Planned: Wave 4" blockquote.
  const planned = new Array<boolean>(lines.length).fill(false);
  for (let i = 0; i < lines.length;) {
    if (!/^\s*>/.test(lines[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && /^\s*>/.test(lines[j])) j++;
    if (lines.slice(i, j).some((l) => /Planned: Wave 4/.test(l)))
      for (let k = i; k < j; k++) planned[k] = true;
    i = j;
  }

  let fence = false;
  lines.forEach((raw, idx) => {
    if (/^\s*(```|~~~)/.test(raw)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    const lineNo = idx + 1;
    const report = (msg: string) =>
      (planned[idx] ? pending : problems).push({ file, line: lineNo, msg });

    // Strip inline code before scanning links so `[x](y)` inside code is ignored.
    const codeSpans = [...raw.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const text = raw.replace(/`[^`]*`/g, '``');

    const targets: string[] = [];
    for (const m of text.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g))
      targets.push(m[1]);
    const ref = /^\s*\[[^\]]+\]:\s+(\S+)/.exec(text);
    if (ref) targets.push(ref[1]);

    for (const target of targets) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http:, https:, mailto:
      const [pathPart, anchor] = target.split('#') as [string, string | undefined];
      const dest = pathPart ? resolve(dirname(abs), decodeURIComponent(pathPart)) : abs;
      if (pathPart && !existsSync(dest)) {
        report(`broken link → ${target}`);
        continue;
      }
      if (anchor && dest.endsWith('.md') && statSync(dest).isFile()) {
        if (!slugsOf(dest).has(anchor.toLowerCase()))
          report(`missing anchor #${anchor} in ${rel(dest)}`);
      }
    }

    for (const span of codeSpans) {
      let p = span.trim();
      if (!PATH_ROOTS.test(p) && !ROOT_FILES.has(p)) continue;
      if (/[*{}<>$|]/.test(p)) continue; // globs and placeholders
      p = p.replace(/:\d+(-\d+)?$/, '').replace(/#L\d+$/, '');
      if (p.includes(':')) continue;
      if (!existsSync(join(ROOT, p))) report(`missing path \`${p}\``);
    }
  });
}

for (const p of pending) console.log(`… pending (Planned) ${p.file}:${p.line}  ${p.msg}`);
for (const p of problems) console.error(`✗ ${p.file}:${p.line}  ${p.msg}`);
console.log(
  `\n${files.length} files checked · ${problems.length} problem(s) · ${pending.length} pending reference(s) inside Planned admonitions`,
);
if (problems.length) process.exit(1);
