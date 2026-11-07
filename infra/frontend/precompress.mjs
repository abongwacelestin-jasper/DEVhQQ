// Pre-compresses the SPA build for Caddy's `file_server { precompressed br gzip }`.
// Writes <file>.br (quality 11) and <file>.gz (level 9) next to every text
// asset over 1 KiB, so nothing is compressed per request.
//
//   node infra/frontend/precompress.mjs Frontend/dist
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const TEXT = /\.(?:js|mjs|css|html|svg|json|txt|wasm|webmanifest|xml)$/;
const root = process.argv[2];
if (!root) {
  console.error('usage: precompress.mjs <dir>');
  process.exit(2);
}

let files = 0;
let before = 0;
let after = 0;
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (TEXT.test(entry.name) && statSync(path).size > 1024) {
      const body = readFileSync(path);
      const br = brotliCompressSync(body, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: 11,
          [constants.BROTLI_PARAM_SIZE_HINT]: body.length,
        },
      });
      writeFileSync(`${path}.br`, br);
      writeFileSync(`${path}.gz`, gzipSync(body, { level: 9 }));
      files++;
      before += body.length;
      after += br.length;
    }
  }
}
walk(root);
console.log(`precompress: ${files} file(s), ${before} -> ${after} bytes (br)`);
