/**
 * Writes every email template, filled with realistic sample data, as `.html`
 * and `.txt` files plus an `index.html` that links them all.
 *
 *   npm run mail:preview                     # → Backend/.mail-preview/
 *   npm run mail:preview -- --out /tmp/mail  # any other folder
 *
 * The brand comes from the BRAND_* / APP_URL environment variables, so the
 * owner can preview real branding before going live:
 *
 *   BRAND_NAME="Acme" BRAND_LOGO_URL=https://… npm run mail:preview
 *
 * Nothing is sent; no network access is needed. Production HTML points at
 * absolute image URLs (APP_URL / BRAND_ASSET_BASE_URL); for the preview, every
 * image whose file exists under Frontend/public/ is copied into the output
 * folder and the preview HTML points at the copy, so previews never show
 * broken images even when that server is not running. The rewrite is
 * preview-only: the templates themselves always emit absolute URLs.
 */

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/env.ts';
import { escapeHtml } from '../mail/layout.ts';
import { sampleBrand, sampleEmails } from '../mail/samples.ts';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = resolve(outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : '.mail-preview');
mkdirSync(out, { recursive: true });

const brand = sampleBrand(config.mail.brand);
const emails = sampleEmails(brand);

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '../../Frontend/public');

/** Local file behind an image URL: relative to the asset base, or by its path. */
function localFile(src: string): string | undefined {
  const candidates: string[] = [];
  if (src.startsWith(`${brand.assetBaseUrl}/`))
    candidates.push(join(PUBLIC, 'brand', src.slice(brand.assetBaseUrl.length + 1)));
  try {
    candidates.push(join(PUBLIC, decodeURIComponent(new URL(src).pathname)));
  } catch {
    return undefined;
  }
  return candidates.find((f) => f.startsWith(`${PUBLIC}/`) && existsSync(f));
}

const copied = new Map<string, string>();
function localizeImages(html: string): string {
  return html.replace(
    /(<img\b[^>]*\bsrc=")([^"]+)(")/g,
    (all, pre: string, src: string, post: string) => {
      const file = localFile(src.replace(/&amp;/g, '&'));
      if (!file) return all;
      const rel = `assets/${file.slice(PUBLIC.length + 1)}`;
      if (!copied.has(rel)) {
        mkdirSync(dirname(join(out, rel)), { recursive: true });
        copyFileSync(file, join(out, rel));
        copied.set(rel, src);
      }
      return `${pre}${rel}${post}`;
    },
  );
}

const rows: string[] = [];
for (const [name, mail] of Object.entries(emails)) {
  writeFileSync(join(out, `${name}.html`), localizeImages(mail.html));
  writeFileSync(join(out, `${name}.txt`), mail.text);
  rows.push(
    `<tr><td style="padding:8px 12px"><code>${escapeHtml(mail.category)}</code></td><td style="padding:8px 12px">${escapeHtml(mail.subject)}</td><td style="padding:8px 12px"><a href="${name}.html">HTML</a> · <a href="${name}.txt">text</a></td></tr>`,
  );
}

writeFileSync(
  join(out, 'index.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(brand.name)} email previews</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:32px;color:#111827">
<h1 style="font-size:20px">${escapeHtml(brand.name)} email previews</h1>
<p style="color:#6b7280;font-size:14px">${Object.keys(emails).length} templates · links point at ${escapeHtml(brand.appUrl)} · generated ${new Date().toISOString()}</p>
<table style="border-collapse:collapse;font-size:14px">${rows.join('\n')}</table>
</body></html>
`,
);

console.log(`Wrote ${Object.keys(emails).length} emails (.html + .txt) to ${out}`);
console.log(
  `Copied ${copied.size} images into ${join(out, 'assets')}; production HTML keeps absolute URLs`,
);
console.log(`Open ${join(out, 'index.html')}`);
