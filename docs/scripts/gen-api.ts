/**
 * Generates docs/api/reference.md from the live route table.
 *
 *   node --experimental-strip-types docs/scripts/gen-api.ts           # write
 *   node --experimental-strip-types docs/scripts/gen-api.ts --check   # fail if stale
 *
 * It boots the app in-process exactly like Backend/scripts/smoke.ts does
 * (buildApp(), no listening socket), reads router.inventory() — the same table
 * that serves /api/openapi.json — and enriches each row with the route-level
 * guards read from Backend/routes/*.routes.ts.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emit, generatedBanner, readRouteGuards, guardsFor, guardLabel, cell } from './lib.ts';

// The audit log appends to ./.audit/audit.jsonl by default; keep generator runs
// out of the working tree. Must be set before the backend modules load.
process.env.AUDIT_LOG_FILE = join(tmpdir(), `devhq-docs-${process.pid}.jsonl`);

const { buildApp } = await import('../../Backend/server.ts');
const router = await buildApp();
const routes = router.inventory();
const guards = readRouteGuards();

const missing = routes.filter((r) => !guardsFor(guards, r.method, r.path));
if (missing.length) {
  console.error('Could not locate the source of these routes:', missing);
  process.exit(1);
}

const tags: string[] = [];
for (const r of routes) if (!tags.includes(r.tag)) tags.push(r.tag);

const byAuth = (mode: string) => routes.filter((r) => r.auth === mode).length;

const authText: Record<string, string> = {
  public: 'public',
  session: 'session',
  partial: 'partial (password only)',
};

let md = generatedBanner('gen-api.ts', ['router.inventory()', 'Backend/routes/*.routes.ts']);
md += `
# API reference

Every route the API registers, grouped by tag, in registration order. The
same route table produces \`GET /api/openapi.json\` (OpenAPI 3.1) and
\`GET /api/_inventory\`, so this page, the OpenAPI document and the backend
console cannot disagree about which endpoints exist.

**${routes.length} routes** — ${byAuth('public')} public, ${byAuth('session')} session,
${byAuth('partial')} partial-session.

How to read the columns:

| Column | Meaning |
|---|---|
| Auth | \`public\`: no credentials. \`session\`: a fully verified session (password + second factor) sent as the \`__Host-devhq_session\` cookie or \`Authorization: Bearer\`, or a personal access token (\`Bearer dhq_pat_…\`) whose scopes cover the route. \`partial\`: a password-only session that has not finished MFA. See [Authentication](authentication.md). |
| Guards | Route-level middleware read from the source: \`Area ≥ level\` is \`requireArea\`, \`step-up\` is \`requireStepUp\` (strong verification in the last 5 minutes), \`interactive session\` is \`requireSession\` (personal access tokens are refused), \`auth rate limit\` is the tight \`authLimiter\` bucket. Personal access tokens never pass step-up. Handlers apply further checks (product scope → \`404\`, two-person rules, role checks); those are described in [Concepts](../concepts/index.md). |
| Responses | Status codes declared in the route's metadata, besides \`200\`/\`201\`/\`204\`. Declared, not exhaustive: every route can also return \`429\` and \`5xx\`. The full error catalogue is in [Error codes](error-codes.md). |

Tags: ${tags.map((t) => `[${t}](#${t})`).join(' · ')}

`;

for (const tag of tags) {
  const list = routes.filter((r) => r.tag === tag);
  md += `\n## ${tag}\n\n`;
  md += '| Method | Path | Summary | Auth | Guards | Responses | Source |\n';
  md += '|---|---|---|---|---|---|---|\n';
  for (const r of list) {
    const g = guardsFor(guards, r.method, r.path)!;
    md += `| \`${r.method}\` | \`${r.path}\` | ${cell(r.summary)} | ${authText[r.auth] ?? r.auth} | ${cell(
      guardLabel(g),
    )} | ${r.responses.join(' ')} | [${g.file.replace('Backend/routes/', '')}:${g.line}](../../${g.file}#L${g.line}) |\n`;
  }
}

emit('docs/api/reference.md', md);
