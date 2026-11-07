// Writes a Caddyfile snippet with a `Link` header for the SPA shell, naming what
// index.html loads first: the entry script and the chunks it modulepreloads, the
// stylesheet and the preloaded font. Asset names are content-hashed, so the
// header is generated from each build's index.html.
//
//   node infra/frontend/preload-links.mjs Frontend/dist > preload.caddy
//
// Browsers start these fetches from the header; Cloudflare (Speed → Early Hints)
// caches the header and replays it as a 103 Early Hints response, so they start
// before the HTML is even sent. Only `rel=preload` is used: it is what Early
// Hints forwards. `crossorigin` matches the module scripts' and font's CORS mode,
// so the preloaded responses are reused, not fetched twice.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2];
if (!dist) {
  console.error('usage: preload-links.mjs <dist>');
  process.exit(2);
}
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const links = [];
for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/g)) {
  const url = /\b(?:src|href)="(\/assets\/[^"]+)"/.exec(tag)?.[1];
  if (!url) continue;
  if (/^<script/.test(tag) || /rel="modulepreload"/.test(tag)) {
    links.push(`<${url}>; rel=preload; as=script; crossorigin`);
  } else if (/rel="stylesheet"/.test(tag)) {
    links.push(`<${url}>; rel=preload; as=style`);
  } else if (/rel="preload"/.test(tag) && /as="font"/.test(tag)) {
    links.push(`<${url}>; rel=preload; as=font; crossorigin`);
  }
}
if (!links.length) {
  console.error('preload-links: no assets found in index.html');
  process.exit(1);
}
console.log(`header Link "${links.join(', ')}"`);
