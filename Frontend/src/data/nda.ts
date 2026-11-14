/** Version of the mutual NDA the server records a signature against. */
export const NDA_VERSION = '3.3';

export type NdaSectionId = 'confidentiality' | 'code' | 'data' | 'security' | 'commitment' | 'sign';

export interface NdaSection {
  id: Exclude<NdaSectionId, 'commitment' | 'sign'>;
  label: string;
  summary: string;
  clauses: { h: string; p: string }[];
  /** One confirmation per section — the clauses carry the detail. */
  acks: string[];
}

export const ndaSections: NdaSection[] = [
  {
    id: 'confidentiality',
    label: 'Confidentiality',
    summary: 'What counts as confidential and how you may use it.',
    clauses: [
      {
        h: 'Purpose',
        p: 'You will access source code, product plans, customer data and infrastructure details for RenewBerry, Blog and Mirror Acture (“Confidential Information”) solely to perform your role.',
      },
      {
        h: 'What counts as confidential',
        p: 'All non-public information you see in TavetaHQ or connected systems — repositories, deployment logs, incident records, credentials, roadmaps and personal data — whether marked confidential or not.',
      },
      {
        h: 'Duration',
        p: 'These obligations continue for 3 years after your access ends, and indefinitely for trade secrets and personal data.',
      },
    ],

    acks: [
      'I’ll use and share Confidential Information only as my role allows, during and after my access.',
    ],
  },
  {
    id: 'code',
    label: 'Code & IP',
    summary: 'Who owns what you build, and where code may live.',
    clauses: [
      {
        h: 'Ownership',
        p: 'Code, designs and documents you contribute to these products are assigned to Tech Organization. You keep ownership of tools and knowledge you brought with you.',
      },
      {
        h: 'Where code may live',
        p: 'Clone repositories only to devices with full-disk encryption. Do not push to personal remotes, public gists or paste code into third-party AI tools that are not approved in TavetaHQ.',
      },
      {
        h: 'Open source',
        p: 'Adding a new dependency with a copyleft licence needs approval in Code security before it is merged.',
      },
    ],

    acks: [
      'I assign my contributions to Tech Organization and keep code off personal remotes, unapproved AI tools and unencrypted devices.',
    ],
  },
  {
    id: 'data',
    label: 'Data & privacy',
    summary: 'Handling customer and personal data.',
    clauses: [
      {
        h: 'Personal data',
        p: 'Customer records are accessed only to resolve an assigned task or incident. Never export production data to a local machine or spreadsheet.',
      },
      {
        h: 'Exposure',
        p: 'Report suspected exposure of personal data within 24 hours through Incidents → Declare, even if you are unsure.',
      },
      {
        h: 'Return & deletion',
        p: 'When your access ends you will delete all Confidential Information, including local clones and exported files, and confirm deletion in writing.',
      },
    ],

    acks: [
      'I won’t export production data, I’ll report exposure within 24 hours, and I’ll delete everything when my access ends.',
    ],
  },
  {
    id: 'security',
    label: 'Access & security',
    summary: 'Your account, devices and production access.',
    clauses: [
      {
        h: 'Credentials',
        p: 'Never share your account, MFA device or API tokens. Tokens are personal and revoked on offboarding.',
      },
      {
        h: 'Production',
        p: 'Production access is time-limited and every action is audited. Attempting to bypass permissions is a breach of this agreement.',
      },
      {
        h: 'Records',
        p: 'Your typed signature, timestamp and network address are stored with this agreement and in the workspace audit log.',
      },
    ],

    acks: [
      'I won’t share my account, MFA device or tokens, and I accept that production actions and my signature are recorded.',
    ],
  },
];

export const commitmentAcks = [
  'I understand this is voluntary and unpaid, and I’ll give two weeks’ notice before stepping back.',
];

export const hourOptions = [2, 5, 10, 15, 20];
export const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const durationOptions = ['1 month', '3 months', '6 months', '12 months', 'Ongoing'];
export const contributionAreas = [
  'Engineering',
  'Design',
  'Testing',
  'Docs',
  'Operations',
  'Mentoring',
];
