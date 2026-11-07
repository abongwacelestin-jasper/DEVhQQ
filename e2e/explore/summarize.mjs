// Summarise docs/qa/evidence/explore-*.json for triage: node explore/summarize.mjs [role...]
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'qa', 'evidence');
const only = process.argv.slice(2);
for (const f of readdirSync(dir).filter((f) => f.startsWith('explore-') && f.endsWith('.json'))) {
  const rows = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  for (const r of rows) {
    if (only.length && !only.includes(r.role)) continue;
    const flags = [];
    if (r.landed !== r.route) flags.push(`LANDED ${r.landed}`);
    if (r.noAccess) flags.push('NO-ACCESS');
    if (r.overflowX) flags.push(`OVERFLOW ${r.scrollWidth}px ${JSON.stringify(r.wide.slice(0, 2))}`);
    if (r.unnamedButtonCount) flags.push(`unnamed-buttons ${r.unnamedButtonCount}`);
    if (r.deadLinks?.length) flags.push(`dead-links ${JSON.stringify(r.deadLinks.slice(0, 3))}`);
    if (r.console?.length) flags.push(`console ${JSON.stringify(r.console.slice(0, 2))}`);
    if (r.errors?.length) flags.push(`PAGE-ERROR ${JSON.stringify(r.errors.slice(0, 2))}`);
    if (r.api?.length) flags.push(`api ${JSON.stringify([...new Set(r.api)].slice(0, 4))}`);
    if (r.empty) flags.push('EMPTY');
    if (r.probeError) flags.push(`probe ${r.probeError}`);
    if (process.env.MOCK && r.mockCopy?.length) flags.push(`copy ${JSON.stringify(r.mockCopy.slice(0, 3))}`);
    console.log(`${r.role} ${r.viewport} ${r.route} ${JSON.stringify(r.h1.slice(0, 1))} ${flags.join(' | ')}`);
  }
}
