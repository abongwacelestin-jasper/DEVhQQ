// Lists the error of every failed test from test-results/*/error-context.md: node support/errors.mjs [filter]
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('../test-results/', import.meta.url).pathname;
const filter = process.argv[2] ?? '';
for (const d of readdirSync(dir)) {
  const f = join(dir, d, 'error-context.md');
  if (!existsSync(f) || !d.includes(filter)) continue;
  const text = readFileSync(f, 'utf8');
  const name = text.match(/- Name: (.*)/)?.[1] ?? d;
  const err = text.split('# Error details')[1]?.split('```')[1]?.trim().split('\n').filter((l) => l.trim()).slice(0, 6).join('\n    ') ?? '';
  console.log(`== ${name}\n    ${err}`);
  if (process.env.SNAP) {
    const snap = text.split('```yaml')[1]?.split('```')[0] ?? '';
    const main = snap.slice(snap.indexOf('- main')).split('\n').slice(0, Number(process.env.SNAP)).join('\n');
    console.log(main);
  }
}
