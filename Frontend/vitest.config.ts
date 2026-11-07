/**
 * Vitest configuration (unit + component tests).
 *
 * Kept separate from vite.config.ts so the dev server/proxy settings never leak
 * into tests. Coverage thresholds are enforced per module for the code that has
 * tests, not as one global number: a module with tests must stay covered, and
 * untested modules are reported (not hidden) until a lane adds tests for them.
 */
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const src = fileURLToPath(new URL('./src', import.meta.url));

// Date helpers work in local time; pin the zone so results never depend on the machine.
// Workers inherit this environment variable.
process.env.TZ = 'UTC';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': src } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: [
        'src/utils/**',
        'src/api/**',
        'src/components/ui/**',
        'src/components/auth/**',
        'src/components/engineering/data/**',
        'src/components/work/**',
        'src/components/messaging/**',
      ],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/api/types.ts',
        'src/components/engineering/data/types.ts',
      ],
      thresholds: {
        // Measured at 97-100%. Thresholds leave a little headroom, not a lot:
        // a module that has tests must stay covered.
        'src/utils/{fuzzy,date,slug,status,secretScan,audit,authRoutes,snippets,metrics}.ts': {
          lines: 95,
          functions: 95,
          branches: 90,
          statements: 95,
        },
        'src/api/{client,capabilities,adapters}.ts': {
          lines: 95,
          functions: 95,
          branches: 90,
          statements: 95,
        },
        'src/components/ui/{Button,Modal,SearchInput,Segmented,MultiSelect,UnderlineTabs,StatusBadge,ProgressBar,Avatar,StatCard,Panel}.tsx':
          { lines: 95, functions: 95, branches: 85, statements: 95 },
        // Phase 2 (merged branch). Measured: adapt 100/96.6, sessionModel 100/100,
        // RichText 100/92.5, useTaskInsights 96/98 (lines/branches).
        'src/components/engineering/data/adapt.ts': {
          lines: 95,
          functions: 95,
          branches: 90,
          statements: 95,
        },
        'src/api/auth/sessionModel.ts': { lines: 95, functions: 95, branches: 90, statements: 95 },
        'src/components/messaging/RichText.tsx': {
          lines: 95,
          functions: 95,
          branches: 85,
          statements: 95,
        },
        'src/components/work/useTaskInsights.ts': {
          lines: 90,
          functions: 95,
          branches: 90,
          statements: 90,
        },
        'src/components/auth/CodeInput.tsx': {
          lines: 95,
          functions: 95,
          branches: 90,
          statements: 95,
        },
      },
    },
  },
});
