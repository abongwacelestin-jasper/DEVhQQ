export interface AssistantSource {
  label: string;
  to: string;
  kind: 'PR' | 'Deploy' | 'Incident' | 'Task' | 'Person' | 'Monitor';
}

export interface AssistantAction {
  label: string;
  requirement: string;
  /** Production-impacting actions need MFA re-verification on top of authorisation. */
  production: boolean;
}

export interface AssistantAnswer {
  id: string;
  question: string;
  keywords: string[];
  summary: string;
  facts: { text: string; cite: AssistantSource }[];
  suggestions: string[];
  actions: AssistantAction[];
}

export const assistantAnswers: AssistantAnswer[] = [
  {
    id: 'q1',
    question: 'What is blocking the RenewBerry v2.4 release?',
    keywords: ['renewberry', 'release', 'block', 'v2.4'],
    summary:
      'Three things stand between v2.4 and production. Two are engineering, one is operational.',
    facts: [
      {
        text: 'PR #148 (password reset) has CI passing but 0 of 2 required reviews.',
        cite: { label: 'PR #148', to: '/pull-requests/148', kind: 'PR' },
      },
      {
        text: 'The staging deploy of e90d315 failed at “Run migrations” 5 hours ago.',
        cite: { label: 'dp-206', to: '/deployments/dp-206', kind: 'Deploy' },
      },
      {
        text: 'PR #152 (retry failed payments) has changes requested by Lena Fischer.',
        cite: { label: 'PR #152', to: '/pull-requests/152', kind: 'PR' },
      },
      {
        text: 'INC-31 is open on production: API 5xx rate is 6.2%.',
        cite: { label: 'INC-31', to: '/incidents/INC-31', kind: 'Incident' },
      },
    ],

    suggestions: [
      'Ask Kofi Mensah to review PR #148 — he has the most context on auth middleware.',
      'Fix the migration and redeploy staging before requesting release approval.',
      'Hold the production release until INC-31 is resolved. The link to a41f9c2 is a correlation, not a confirmed cause.',
    ],

    actions: [
      {
        label: 'Request review from Kofi on PR #148',
        requirement: 'Sends a GitHub review request',
        production: false,
      },
      { label: 'Deploy v2.4 to production', requirement: 'Owner approval + MFA', production: true },
    ],
  },
  {
    id: 'q2',
    question: 'Who is overloaded right now?',
    keywords: ['overload', 'workload', 'capacity', 'who'],
    summary: 'One person is over capacity. Two have room this week.',
    facts: [
      {
        text: 'Kofi Mensah has 12 open tasks against a capacity of 10.',
        cite: { label: 'Kofi Mensah', to: '/team/m4', kind: 'Person' },
      },
      {
        text: 'Sam Carter has 3 open tasks and Tomás Silva has 5.',
        cite: { label: 'Assignments', to: '/assignments', kind: 'Person' },
      },
      {
        text: '2 of Kofi’s tasks are urgent RenewBerry billing work.',
        cite: { label: 'RB-221', to: '/tasks/RB-221', kind: 'Task' },
      },
    ],

    suggestions: [
      'Move RB-230 Invoice export from Kofi’s queue to someone with RenewBerry access and spare capacity.',
    ],
    actions: [
      {
        label: 'Open rebalance preview',
        requirement: 'Nothing changes until you apply it',
        production: false,
      },
    ],
  },
  {
    id: 'q3',
    question: 'Summarize Mirror Acture this week',
    keywords: ['mirror', 'summary', 'summarize', 'week'],
    summary: 'Beta launch is slipping and one health check is flaky; nothing is user-facing yet.',
    facts: [
      {
        text: '3 Beta launch tasks are overdue, led by MA-38 onboarding screens (3 days late).',
        cite: { label: 'MA-38', to: '/tasks/MA-38', kind: 'Task' },
      },
      {
        text: 'The /health check failed intermittently overnight (INC-30, SEV3).',
        cite: { label: 'INC-30', to: '/incidents/INC-30', kind: 'Incident' },
      },
      {
        text: 'A staging deploy of 51b8a07 is waiting for approval.',
        cite: { label: 'dp-205', to: '/deployments/dp-205', kind: 'Deploy' },
      },
    ],

    suggestions: [
      'Unblock MA-40 invite emails by splitting MA-38 into two smaller design handoffs.',
    ],
    actions: [
      {
        label: 'Approve staging deploy 51b8a07',
        requirement: 'Deploy approval rights',
        production: false,
      },
    ],
  },
];
