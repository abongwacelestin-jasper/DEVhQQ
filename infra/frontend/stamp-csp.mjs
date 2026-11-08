// Copies the Caddyfile with the code sandbox's script hash filled in.
//
//   node infra/frontend/stamp-csp.mjs Frontend/dist infra/frontend/Caddyfile > Caddyfile
//
// The SPA's <meta> CSP (vite.config.ts) allows the sandbox's srcdoc bootstrap by
// hash. Browsers enforce the <meta> policy AND the Caddy header together, so the
// header must allow the same hash or the in-browser code runner is blocked in
// production. The hash depends on the build, so it is read from this build's
// index.html and stamped over the `'sha256-SANDBOX'` placeholder. The build fails
// if either is missing.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [dist, caddyfile] = process.argv.slice(2);
if (!dist || !caddyfile) {
  console.error('usage: stamp-csp.mjs <dist> <Caddyfile>');
  process.exit(2);
}
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const scriptSrc = /script-src([^;"]*)/.exec(html)?.[1] ?? '';
const hash = /'sha256-[A-Za-z0-9+/=]+'/.exec(scriptSrc)?.[0];
if (!hash) {
  console.error('stamp-csp: no sandbox sha256 in index.html script-src');
  process.exit(1);
}
const src = readFileSync(caddyfile, 'utf8');
if (!src.includes("'sha256-SANDBOX'")) {
  console.error("stamp-csp: Caddyfile has no 'sha256-SANDBOX' placeholder");
  process.exit(1);
}
process.stdout.write(src.replaceAll("'sha256-SANDBOX'", hash));
