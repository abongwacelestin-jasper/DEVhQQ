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
 * Nothing is sent; no network access is needed.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from '../config/env.ts';
import { escapeHtml } from '../mail/layout.ts';
import { sampleBrand, sampleEmails } from '../mail/samples.ts';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = resolve(outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : '.mail-preview');
mkdirSync(out, { recursive: true });

const brand = sampleBrand(config.mail.brand);
const emails = sampleEmails(brand);

const rows: string[] = [];
for (const [name, mail] of Object.entries(emails)) {
  writeFileSync(join(out, `${name}.html`), mail.html);
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
console.log(`Open ${join(out, 'index.html')}`);
