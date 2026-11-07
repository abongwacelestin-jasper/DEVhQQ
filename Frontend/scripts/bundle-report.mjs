// Per-chunk sizes of a Vite build: raw, gzip (level 9) and brotli (quality 11,
// what infra/frontend/precompress.mjs serves), plus the JS a first visit loads
// before any route chunk (the entry script and its modulepreloads in index.html).
//
//   npx vite build && node scripts/bundle-report.mjs [dist] [--all]
//
// Without --all, chunks under 10 kB raw are summed into one line.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const dist = args.find((a) => !a.startsWith('--')) ?? 'dist';
const all = args.includes('--all');
const assets = join(dist, 'assets');

const size = (buf) => ({
  raw: buf.length,
  gz: gzipSync(buf, { level: 9 }).length,
  br: brotliCompressSync(buf, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  }).length,
});

const files = readdirSync(assets)
  .filter((f) => /\.(?:js|css)$/.test(f))
  .map((f) => ({ f, ...size(readFileSync(join(assets, f))) }))
  .sort((a, b) => b.raw - a.raw);

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const initial = new Set(
  [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.(?:js|css))"/g)].map((m) => m[1]),
);

const kb = (n) => (n / 1000).toFixed(1);
const row = (name, s) => `| ${name} | ${kb(s.raw)} | ${kb(s.gz)} | ${kb(s.br)} |`;
const sum = (list) =>
  list.reduce((t, s) => ({ raw: t.raw + s.raw, gz: t.gz + s.gz, br: t.br + s.br }), {
    raw: 0,
    gz: 0,
    br: 0,
  });

console.log('| Chunk | raw kB | gzip kB | brotli kB |');
console.log('|---|---:|---:|---:|');
const small = [];
for (const s of files) {
  if (!all && s.raw < 10 * 1000 && !initial.has(s.f)) small.push(s);
  else console.log(row(`\`${s.f}\`${initial.has(s.f) ? ' (initial)' : ''}`, s));
}
if (small.length) console.log(row(`${small.length} chunks under 10 kB`, sum(small)));

const js = files.filter((s) => s.f.endsWith('.js'));
const init = files.filter((s) => initial.has(s.f));
console.log('');
console.log(row('**Initial JS + CSS** (index.html)', sum(init)));
console.log(row('**Initial JS**', sum(init.filter((s) => s.f.endsWith('.js')))));
console.log(row(`All JS (${js.length} files)`, sum(js)));
const over = js.filter((s) => s.raw > 500 * 1000);
if (over.length) console.log(`\nOver 500 kB: ${over.map((s) => s.f).join(', ')}`);
