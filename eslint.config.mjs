/**
 * Shared ESLint configuration for TavetaHQ.
 *
 * This file is the single source of truth for *rules*; each package has a thin
 * `eslint.config.mjs` that composes it with its own dependencies, because
 * plugins resolve from the package that declares them (the repository root has
 * no package.json on purpose — the two apps install independently).
 *
 * Targets: ESLint 9 flat config, @typescript-eslint 8.
 */

/** Generated and vendored content — never linted. */
export const ignores = [
  '**/node_modules/**',
  '**/dist/**',
  '**/coverage/**',
  '**/.audit/**',
  '**/.backups/**',
  '**/*.min.js',
  '**/public/**',
];

/** Rules shared by both packages. */
export const sharedRules = {
  // `catch {}` with a comment is deliberate in a few places; an empty block is not.
  'no-empty': ['error', { allowEmptyCatch: true }],
  eqeqeq: ['error', 'smart'],
  'no-var': 'error',
  'prefer-const': ['error', { destructuring: 'all' }],
  // Shadowing the global `event`/`name` is a recurring source of bugs.
  'no-shadow-restricted-names': 'error',
  'no-console': 'off', // the backend logs through lib/logger.ts, the sandbox terminal prints on purpose
};

/** Rule tweaks on top of `@typescript-eslint/recommended`. */
export const typescriptRules = {
  // Unused args are fine when they document a signature (e.g. `_body` destructuring to drop a field).
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
  ],
  // `any` is a last resort, not a lint failure: a few interop points (Monaco globals) genuinely have no types.
  '@typescript-eslint/no-explicit-any': 'error',
};

/** Browser globals for the web app (kept explicit instead of pulling in the `globals` package). */
export const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  crypto: 'readonly',
  fetch: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  DOMException: 'readonly',
  Blob: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  FormData: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  Headers: 'readonly',
  AbortController: 'readonly',
  HTMLElement: 'readonly',
  HTMLInputElement: 'readonly',
  HTMLButtonElement: 'readonly',
  HTMLFormElement: 'readonly',
  KeyboardEvent: 'readonly',
  MouseEvent: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  MutationObserver: 'readonly',
  ResizeObserver: 'readonly',
  IntersectionObserver: 'readonly',
  getComputedStyle: 'readonly',
  matchMedia: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  PublicKeyCredential: 'readonly',
  AuthenticatorAttestationResponse: 'readonly',
  performance: 'readonly',
  structuredClone: 'readonly',
};
