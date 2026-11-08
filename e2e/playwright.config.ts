import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Two modes:
 *  - E2E_BASE_URL set → reuse servers that are already running (e.g. the Docker
 *    Compose stack or `npm run dev`), nothing is started.
 *  - otherwise → start a fresh backend + Vite on fresh ports with fresh state
 *    (in-memory store, new audit/backup dirs). Ports are chosen once in the main
 *    process and inherited by workers through the environment.
 */
const reuse = !!process.env.E2E_BASE_URL;
if (!reuse) {
  process.env.E2E_API_PORT ??= String(18000 + Math.floor(Math.random() * 1000));
  process.env.E2E_WEB_PORT ??= String(19000 + Math.floor(Math.random() * 1000));
  process.env.E2E_STATE_DIR ??= mkdtempSync(join(tmpdir(), 'devhq-e2e-'));
}
const apiPort = process.env.E2E_API_PORT;
const webPort = process.env.E2E_WEB_PORT;
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${webPort}`;
const apiURL = process.env.E2E_API_URL ?? `http://127.0.0.1:${apiPort}`;
process.env.E2E_API_URL = apiURL;

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const state = process.env.E2E_STATE_DIR ?? '';
/**
 * E2E_TURNSTILE=1 starts the API with Cloudflare Turnstile on, using Cloudflare's published
 * always-pass test keys (the widget solves itself, siteverify accepts its dummy token).
 * Needs internet: the widget and siteverify are on challenges.cloudflare.com. The default
 * run keeps it off. Journeys that sign in through the API (signInViaApi) need it off.
 */
const turnstileEnv: Record<string, string> =
  process.env.E2E_TURNSTILE === '1'
    ? {
        TURNSTILE_MODE: 'on',
        TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
        TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
      }
    : { TURNSTILE_MODE: 'off' };

export default defineConfig({
  testDir: '.',
  outputDir: './test-results',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Never retry: a flake is a defect in the test or the app, and must be investigated.
  retries: 0,
  // The auth limiter allows 60 sign-ins per IP then 1/s; keep parallelism modest.
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 3,
  reporter: [
    ['list'],
    ['html', { outputFolder: './playwright-report', open: 'never' }],
    ['json', { outputFile: './test-results/results.json' }],
  ],
  globalSetup: './support/global-setup.ts',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    navigationTimeout: 60_000,
    actionTimeout: 15_000,
    locale: 'en-GB',
    timezoneId: 'UTC',
    // E2E_CHANNEL=chrome runs the suite in the installed Google Chrome instead of bundled Chromium.
    ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}),
  },
  projects: [
    {
      // Real onboarding screens. Run as a separate invocation (`npm run test:onboarding`) so it
      // gets its own fresh server before any journey onboards the Tester through the API.
      name: 'onboarding',
      testDir: './tests',
      testMatch: /onboarding\.flow\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'chromium',
      testDir: './tests',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'firefox',
      testDir: './tests',
      grep: /@smoke/,
      use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'webkit',
      testDir: './tests',
      grep: /@smoke/,
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
    },
    {
      // Scripted exploratory pass: crawls every route as every persona at 375/768/1280 and
      // writes docs/qa/evidence. Not a pass/fail gate; run it with `npm run explore`.
      name: 'explore',
      testDir: './explore',
      testMatch: /.*\.explore\.ts/,
      timeout: 15 * 60_000,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: reuse
    ? undefined
    : [
        {
          name: 'backend',
          command: 'node --experimental-strip-types server.ts',
          cwd: join(repo, 'Backend'),
          url: `${apiURL}/api/health`,
          timeout: 60_000,
          reuseExistingServer: false,
          stdout: 'ignore',
          stderr: 'pipe',
          env: {
            NODE_ENV: 'development',
            PORT: String(apiPort),
            APP_ORIGIN: baseURL,
            PUBLIC_URL: apiURL,
            AUDIT_LOG_FILE: join(state, 'audit.log'),
            BACKUP_DIR: join(state, 'backups'),
            LOG_LEVEL: 'warn',
            ...turnstileEnv,
          },
        },
        {
          name: 'frontend',
          // Default: a production build served by `vite preview` (same /api proxy as dev) —
          // ~10x faster page loads than the dev server and no dependency re-optimisation
          // reloads mid-test. E2E_DEV=1 uses the dev server instead.
          command: process.env.E2E_DEV
            ? `npx vite --host 127.0.0.1 --port ${webPort} --strictPort`
            : `npx vite build --outDir ${join(state, 'dist')} --emptyOutDir --logLevel warn && npx vite preview --outDir ${join(state, 'dist')} --host 127.0.0.1 --port ${webPort} --strictPort`,
          cwd: join(repo, 'Frontend'),
          url: baseURL,
          timeout: 240_000,
          reuseExistingServer: false,
          stdout: 'ignore',
          stderr: 'pipe',
          env: { DEVHQ_API_URL: apiURL },
        },
      ],
});
