export interface CodeFile {
  path: string;
  content: string;
}

/** A browsable snapshot of renewberry/api for the in-browser code workspace. */
export const repoFiles: Record<string, CodeFile[]> = {
  'renewberry/api': [
    {
      path: 'src/billing/retry.ts',
      content: `import { sleep, jitter } from '../lib/time';
import { chargeInvoice, markFailed } from './invoices';
import type { Invoice } from './types';

const MAX_ATTEMPTS = 5;

/** RB-221 — retry failed payments with capped exponential backoff. */
export async function retryPayment(invoice: Invoice, attempt = 0): Promise<boolean> {
  if (attempt >= MAX_ATTEMPTS) {
    await markFailed(invoice);
    return false;
  }
  const ok = await chargeInvoice(invoice);
  if (ok) return true;
  const delay = Math.min(30_000, 500 * 2 ** attempt);
  await sleep(delay + jitter());
  return retryPayment(invoice, attempt + 1);
}
`,
    },
    {
      path: 'src/billing/invoices.ts',
      content: `import { db } from '../lib/db';
import type { Invoice } from './types';

export async function chargeInvoice(invoice: Invoice) {
  const res = await db.payments.charge(invoice.customerId, invoice.amount);
  return res.status === 'succeeded';
}

export async function markFailed(invoice: Invoice) {
  await db.invoices.update(invoice.id, { status: 'failed' });
}
`,
    },
    {
      path: 'src/billing/types.ts',
      content: `export interface Invoice {
  id: string;
  customerId: string;
  amount: number;
  currency: 'usd' | 'eur' | 'gbp';
  status: 'open' | 'paid' | 'failed';
}
`,
    },
    {
      path: 'src/auth/reset.ts',
      content: `import { sendEmail } from '../lib/mail';
import { createToken } from '../lib/tokens';

/** RB-212 — password reset. Tokens expire after 30 minutes and are single-use. */
export async function requestReset(email: string) {
  const token = await createToken({ email, ttlMinutes: 30, singleUse: true });
  await sendEmail(email, 'reset-password', { token });
}
`,
    },
    {
      path: 'src/lib/time.ts',
      content: `export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const jitter = () => Math.floor(Math.random() * 250);
`,
    },
    {
      path: 'src/config.ts',
      content: `/** Secrets come from the environment — never commit real values. */
export const config = {
  stripeKey: process.env.STRIPE_SECRET_KEY ?? '',
  databaseUrl: process.env.DATABASE_URL ?? '',
  webhookSecret: process.env.WEBHOOK_SECRET ?? '',
};
`,
    },
    {
      path: 'test/retry.test.ts',
      content: `import { retryPayment } from '../src/billing/retry';

test('gives up after 5 attempts', async () => {
  const invoice = { id: 'in_1', customerId: 'c_1', amount: 900, currency: 'usd', status: 'open' } as const;
  expect(await retryPayment(invoice, 5)).toBe(false);
});
`,
    },
    {
      path: 'package.json',
      content: `{\n  "name": "renewberry-api",\n  "version": "2.3.1",\n  "scripts": { "test": "vitest run", "lint": "eslint src" },\n  "dependencies": { "express": "4.19.2", "jsonwebtoken": "8.5.1", "stripe": "14.10.0" }\n}\n`,
    },
    {
      path: 'src/lib/db.ts',
      content: `/** In-memory stand-in for the database client, so code runs safely in the sandbox. */
type Row = Record<string, unknown>;

const tables: Record<string, Map<string, Row>> = {
  invoices: new Map(),
  payments: new Map(),
};

export const db = {
  payments: {
    async charge(customerId: string, amount: number) {
      const status = amount > 0 && amount < 100_000 ? 'succeeded' : 'declined';
      tables.payments.set(\`\${customerId}-\${tables.payments.size + 1}\`, { customerId, amount, status });
      return { status };
    },
  },
  invoices: {
    async update(id: string, patch: Row) {
      const next = { ...(tables.invoices.get(id) ?? {}), ...patch };
      tables.invoices.set(id, next);
      return next;
    },
  },
};
`,
    },
    {
      path: 'src/lib/mail.ts',
      content: `export async function sendEmail(to: string, template: string, data: Record<string, unknown>) {
  console.info(\`[mail] \${template} → \${to}\`, data);
}
`,
    },
    {
      path: 'src/lib/tokens.ts',
      content: `interface TokenOptions {
  email: string;
  ttlMinutes: number;
  singleUse: boolean;
}

export async function createToken(options: TokenOptions) {
  const random = Math.random().toString(36).slice(2, 12);
  return \`\${random}.\${options.ttlMinutes}m\`;
}
`,
    },
    {
      path: 'test/time.test.ts',
      content: `import { jitter } from '../src/lib/time';

test('jitter stays under 250ms', () => {
  for (let i = 0; i < 100; i++) {
    expect(jitter()).toBeLessThan(250);
  }
});
`,
    },
    {
      path: 'playground.ts',
      content: `// Scratch file — press F5 or ▶ to run it. Output shows in the Output panel.
import { retryPayment } from './src/billing/retry';
import { requestReset } from './src/auth/reset';

const invoice = { id: 'in_42', customerId: 'cus_7', amount: 1_250, currency: 'usd', status: 'open' } as const;

async function main() {
  const started = Date.now();
  const ok = await retryPayment(invoice);
  console.info(\`Charged \${invoice.id}: \${ok ? 'succeeded' : 'failed'} in \${Date.now() - started}ms\`);
  await requestReset('ada@example.com');
}

main();
`,
    },
    {
      path: 'README.md',
      content: `# renewberry/api\n\nSubscription billing API.\n\n- \`npm test\` — unit tests\n- \`node playground.ts\` — run the scratch file\n- Secrets live in TavetaHQ → Integrations → credentials\n`,
    },
  ],

  'blog/platform': [
    {
      path: 'src/editor/Toolbar.tsx',
      content: `export function Toolbar() {\n  return <div role="toolbar" aria-label="Formatting" />;\n}\n`,
    },
    {
      path: 'src/seo/meta.ts',
      content: `export function metaFor(post: { title: string; excerpt: string }) {\n  return { title: post.title, description: post.excerpt.slice(0, 155) };\n}\n`,
    },
    { path: 'README.md', content: `# blog/platform\n` },
  ],
};

export const branchesFor = (repo: string) =>
  repo === 'renewberry/api'
    ? [
        'main',
        'fix/rb-221-retry-payments',
        'feat/rb-212-password-reset',
        'feat/rb-230-invoice-export',
      ]
    : ['main', 'feat/bl-24-seo-meta'];
