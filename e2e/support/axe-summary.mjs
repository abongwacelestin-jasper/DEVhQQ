// Aggregates test-results/axe/*.json by impact and rule: node support/axe-summary.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('../test-results/axe/', import.meta.url).pathname;
if (!existsSync(dir)) throw new Error('no axe results; run the accessibility spec first');
const byRule = new Map();
const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };
let pages = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const { route, theme, rows } = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  pages++;
  for (const r of rows) {
    byImpact[r.impact] = (byImpact[r.impact] ?? 0) + 1;
    const k = `${r.impact}|${r.id}`;
    const e = byRule.get(k) ?? { impact: r.impact, id: r.id, help: r.help, routes: [], nodes: 0, sample: r.sample[0] };
    e.routes.push(`${theme === 'dark' ? 'dark:' : ''}${route}`);
    e.nodes += r.nodes;
    byRule.set(k, e);
  }
}
const order = ['critical', 'serious', 'moderate', 'minor'];
console.log(`pages audited: ${pages}; rule-hits by impact: ${JSON.stringify(byImpact)}\n`);
console.log('| Impact | Rule | What | Pages | Nodes | Example |\n|---|---|---|---|---|---|');
for (const e of [...byRule.values()].sort((a, b) => order.indexOf(a.impact) - order.indexOf(b.impact) || b.routes.length - a.routes.length))
  console.log(`| ${e.impact} | \`${e.id}\` | ${e.help} | ${e.routes.length}${e.routes.length <= 4 ? ` (${e.routes.join(', ')})` : ''} | ${e.nodes} | \`${String(e.sample).slice(0, 60).replace(/\|/g, '\\|')}\` |`);
