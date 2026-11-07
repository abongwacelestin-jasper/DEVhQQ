// Prints the first bytes of each wave-4 endpoint for a role: node explore/api-probe.mjs <apiURL> <role> [path...]
import { request } from '@playwright/test';

const [base, role = 'admin', ...extra] = process.argv.slice(2);
const api = await request.newContext({ baseURL: base });
const s = await api.post('/api/auth/demo', { data: { role } });
console.log('demo', s.status());
const paths = extra.length
  ? extra
  : ['/api/channels', '/api/notifications', '/api/repos', '/api/pulls', '/api/monitors', '/api/ci/runs', '/api/integrations', '/api/workspaces', '/api/onboarding', '/api/tokens', '/api/github/app', '/api/security/code-findings', '/api/deployments', '/api/insights/tasks/RB-212'];
for (const p of paths) {
  const r = await api.get(p);
  console.log(`== ${p} ${r.status()}\n${(await r.text()).slice(0, 300)}`);
}
await api.dispose();
