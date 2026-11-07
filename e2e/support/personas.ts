/**
 * Demo personas, mirrored from Frontend/src/data/roles.ts and the backend seed.
 * The suite never imports application code: if these drift, the tests should fail
 * loudly rather than silently follow the app.
 */
export type RoleKey = 'admin' | 'pm' | 'developer' | 'designer' | 'tester' | 'operations';

export interface Persona {
  key: RoleKey;
  /** Label on the sign-in demo button. */
  label: string;
  memberId: string;
  name: string;
  email: string;
  /** Backend role name (Backend/auth/rbac.ts). */
  role: string;
  /** Landing route after sign-in. */
  home: string;
  needsOnboarding: boolean;
}

export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'devhq-demo';
export const DEMO_MFA_CODE = process.env.DEMO_MFA_CODE ?? '246810';

export const personas: Record<RoleKey, Persona> = {
  admin: {
    key: 'admin',
    label: 'Admin demo',
    memberId: 'm1',
    name: 'Amara Okafor',
    email: 'amara@techorg.io',
    role: 'Owner',
    home: '/',
    needsOnboarding: false,
  },
  pm: {
    key: 'pm',
    label: 'Project manager',
    memberId: 'm2',
    name: 'Daniel Reyes',
    email: 'daniel@techorg.io',
    role: 'Project manager',
    home: '/',
    needsOnboarding: true,
  },
  developer: {
    key: 'developer',
    label: 'Developer',
    memberId: 'm4',
    name: 'Kofi Mensah',
    email: 'kofi@techorg.io',
    role: 'Developer',
    home: '/my-work',
    needsOnboarding: true,
  },
  designer: {
    key: 'designer',
    label: 'Designer',
    memberId: 'm9',
    name: 'Inès Moreau',
    email: 'ines@techorg.io',
    role: 'Designer',
    home: '/my-work',
    needsOnboarding: true,
  },
  tester: {
    key: 'tester',
    label: 'Tester',
    memberId: 'm10',
    name: 'Ravi Patel',
    email: 'ravi@techorg.io',
    role: 'Tester',
    home: '/test-queue',
    needsOnboarding: true,
  },
  operations: {
    key: 'operations',
    label: 'Operations',
    memberId: 'm11',
    name: 'Grace Liu',
    email: 'grace@techorg.io',
    role: 'Operations',
    home: '/incidents',
    needsOnboarding: true,
  },
};

export type ProductId = 'renewberry' | 'blog' | 'mirror';

/** Product assignments from the backend seed (Backend/store/db.ts). */
export const productsOf: Record<RoleKey, ProductId[]> = {
  admin: ['renewberry', 'blog', 'mirror'],
  pm: ['renewberry'],
  developer: ['renewberry'],
  designer: ['renewberry', 'mirror'],
  tester: ['renewberry', 'mirror'],
  operations: ['renewberry', 'blog', 'mirror'],
};

/** Every top-level route in Frontend/src/App.tsx that renders inside the app shell. */
export const MAIN_ROUTES = [
  '/',
  '/my-work',
  '/inbox',
  '/test-queue',
  '/messages',
  '/docs',
  '/code-security',
  '/dev-tools',
  '/projects',
  '/assignments',
  '/activity',
  '/workspaces',
  '/repositories',
  '/pull-requests',
  '/deployments',
  '/incidents',
  '/monitors',
  '/team',
  '/security',
  '/integrations',
  '/audit',
  '/products/renewberry',
  '/products/renewberry/work',
  '/products/renewberry/code',
  '/products/renewberry/deployments',
  '/products/renewberry/incidents',
  '/products/renewberry/analytics',
  '/products/renewberry/people',
] as const;

export const AUTH_ROUTES = ['/sign-in', '/forgot-password', '/reset-password', '/accept-invite'] as const;
