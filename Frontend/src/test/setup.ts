/**
 * Global test setup: DOM matchers, DOM cleanup and clean storage per test.
 * Anything stubbed with vi.stubGlobal / vi.spyOn is restored by vitest.config.ts
 * (restoreMocks + unstubGlobals), so tests never leak state into each other.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  sessionStorage.clear();
  localStorage.clear();
});
