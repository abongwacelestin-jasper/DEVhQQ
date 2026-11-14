import type { DocKind, ProjectDoc } from '../types/docs';
import { NOW } from '../utils/date';

const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

export const docKindMeta: Record<DocKind, { label: string; color: string }> = {
  spec: { label: 'Spec', color: 'bg-accent-soft text-accent-ink' },
  runbook: { label: 'Runbook', color: 'bg-bad-soft text-bad' },
  meeting: { label: 'Meeting notes', color: 'bg-sunken text-ink' },
  decision: { label: 'Decision', color: 'bg-warn-soft text-warn' },
  guide: { label: 'Guide', color: 'bg-ok-soft text-ok' },
  handover: { label: 'Handover', color: 'bg-info-soft text-info' },
};

export const docTemplates: Record<DocKind, string> = {
  spec: '# Title\n\n> One-line summary of the problem and who it is for.\n\n## Goals\n- \n\n## Non-goals\n- \n\n## Requirements\n- [ ] \n\n## Open questions\n- ',
  runbook:
    '# Runbook: service name\n\n> When to use this runbook.\n\n## Detect\n- Alert name and dashboard\n\n## Mitigate\n- [ ] Step one\n- [ ] Step two\n\n## Roll back\n```bash\n# command\n```\n\n## Escalate\n- On-call owner',
  meeting:
    '# Meeting — date\n\n## Attendees\n- \n\n## Notes\n- \n\n## Actions\n- [ ] Owner — action',
  decision:
    '# Decision: title\n\n> Status: proposed\n\n## Context\n\n## Options\n- A\n- B\n\n## Decision\n\n## Consequences',
  guide: '# Guide\n\n## Before you start\n- \n\n## Steps\n- [ ] ',
  handover:
    '# Handover\n\n> Everything the next owner needs.\n\n## Open work\n- [ ] \n\n## Access to transfer\n- \n\n## Contacts\n- ',
};

const v = (id: string, h: number, by: string, summary: string, body: string) => ({
  id,
  at: ago(h),
  by,
  summary,
  body,
});

const paymentsSpec = `# Payments v2 — retry & invoices

> Recover failed renewals automatically and let customers export invoices.

## Goals
- Retry failed payments up to 5 times with exponential backoff
- Customers can download invoices as CSV and PDF
- Zero duplicate charges

## Requirements
- [x] Backoff capped at 30s between attempts (RB-221)
- [x] Webhook deduplication (RB-209)
- [ ] Invoice export with permission check (RB-230)
- [ ] Password reset flow merged before v2.4 (RB-212)

## Rollout
\`\`\`bash
devhq deploy renewberry/api --env staging --task RB-221
\`\`\`

## Open questions
- Do we email the customer after the 3rd failed attempt?`;

export const seedDocs: ProjectDoc[] = [
  {
    id: 'doc-payments-spec',
    projectId: 'p1',
    product: 'renewberry',
    title: 'Payments v2 — retry & invoices',
    kind: 'spec',
    status: 'published',
    visibility: 'project',
    body: paymentsSpec,
    createdBy: 'm2',
    createdAt: ago(24 * 20),
    updatedBy: 'm4',
    updatedAt: ago(5),
    editors: ['m2', 'm4', 'm5'],
    versions: [
      v('v3', 5, 'm4', 'Ticked backoff requirement', paymentsSpec),
      v(
        'v2',
        72,
        'm2',
        'Added rollout command',
        paymentsSpec.replace('- [x] Backoff', '- [ ] Backoff'),
      ),
      v('v1', 24 * 20, 'm2', 'Created from Spec template', '# Payments v2\n\n> Draft'),
    ],
    comments: [
      {
        id: 'c1',
        at: ago(4),
        by: 'm5',
        text: 'Let’s answer the email question before v2.4 — support will ask.',
      },
    ],
  },
  {
    id: 'doc-api-runbook',
    projectId: 'p3',
    product: 'renewberry',
    title: 'Runbook: renewberry api 5xx',
    kind: 'runbook',
    status: 'published',
    visibility: 'restricted',
    body: '# Runbook: renewberry api 5xx\n\n> Use when the 5xx rate is above 2% for 5 minutes.\n\n## Detect\n- Monitor: renewberry-api /health\n- Dashboard: Monitors → renewberry\n\n## Mitigate\n- [ ] Check the latest deploy in Deployments\n- [ ] Scale webhook workers down to 2\n- [ ] Roll back if a deploy correlates\n\n## Roll back\n```bash\ndevhq rollback renewberry/api --to v2.3.0 --mfa\n```\n\n## Escalate\n- Grace Liu (Operations), then Amara Okafor',
    createdBy: 'm11',
    createdAt: ago(24 * 60),
    updatedBy: 'm11',
    updatedAt: ago(2),
    editors: ['m11', 'm1'],
    versions: [
      v('v2', 2, 'm11', 'Added worker scaling step', ''),
      v('v1', 24 * 60, 'm11', 'Created', ''),
    ],
    comments: [],
  },
  {
    id: 'doc-auth-adr',
    projectId: 'p2',
    product: 'renewberry',
    title: 'Decision: session timeout 15 minutes',
    kind: 'decision',
    status: 'in-review',
    visibility: 'workspace',
    body: '# Decision: session timeout 15 minutes\n\n> Status: in review\n\n## Context\nCustomers asked for shorter idle sessions on shared devices.\n\n## Options\n- 30 minutes (current)\n- 15 minutes with a 30-second warning\n\n## Decision\n15 minutes, warning 30 seconds before lock, unlock with MFA.\n\n## Consequences\n- Slightly more unlock prompts\n- Matches the TavetaHQ workspace policy',
    createdBy: 'm2',
    createdAt: ago(48),
    updatedBy: 'm2',
    updatedAt: ago(30),
    editors: ['m2'],
    versions: [v('v1', 48, 'm2', 'Created', '')],
    comments: [
      {
        id: 'c2',
        at: ago(20),
        by: 'm1',
        text: 'Approve. Please link this from the security policy.',
      },
    ],
  },
  {
    id: 'doc-blog-launch',
    projectId: 'p4',
    product: 'blog',
    title: 'Launch plan — editor refresh',
    kind: 'guide',
    status: 'published',
    visibility: 'project',
    body: '# Launch plan — editor refresh\n\n## Before launch\n- [x] Toolbar merged (BL-17)\n- [ ] SEO meta fields (BL-24)\n- [ ] Autosave load test\n\n## Launch day\n- [ ] Announce in #general\n- [ ] Monitor error rate for 2h\n\n## Owners\n- Priya — comms\n- Tomás — editor\n- Sam — SEO',
    createdBy: 'm3',
    createdAt: ago(24 * 10),
    updatedBy: 'm6',
    updatedAt: ago(14),
    editors: ['m3', 'm6', 'm8'],
    versions: [v('v1', 24 * 10, 'm3', 'Created', '')],
    comments: [],
  },
  {
    id: 'doc-mirror-standup',
    projectId: 'p6',
    product: 'mirror',
    title: 'Beta standup — Oct 22',
    kind: 'meeting',
    status: 'published',
    visibility: 'project',
    body: '# Beta standup — Oct 22\n\n## Attendees\n- Priya, Inès, Yuki, Ravi\n\n## Notes\n- Onboarding screens (MA-38) are 3 days late\n- Invite emails blocked on design\n\n## Actions\n- [ ] Inès — split MA-38 into two handoffs\n- [ ] Ravi — test plan for invites\n- [x] Yuki — fix timeout copy (MA-36)',
    createdBy: 'm3',
    createdAt: ago(30),
    updatedBy: 'm3',
    updatedAt: ago(30),
    editors: ['m3'],
    versions: [v('v1', 30, 'm3', 'Created', '')],
    comments: [],
  },
  {
    id: 'doc-mirror-tokens',
    projectId: 'p7',
    product: 'mirror',
    title: 'Design tokens & dark mode',
    kind: 'spec',
    status: 'draft',
    visibility: 'project',
    body: '# Design tokens & dark mode\n\n> Draft — Inès\n\n## Tokens\n- surface, sunken, ink, muted\n- accent with soft and ink variants\n\n## Requirements\n- [x] Token names agreed\n- [ ] Contrast AA on every pair\n- [ ] Export to Figma',
    createdBy: 'm9',
    createdAt: ago(60),
    updatedBy: 'm9',
    updatedAt: ago(8),
    editors: ['m9', 'm7'],
    versions: [v('v1', 60, 'm9', 'Created', '')],
    comments: [],
  },
];
