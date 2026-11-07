import type { AuthStage } from '../contexts/AuthContext';
import type { DemoRole } from '../data/roles';

/** Where a session at a given stage belongs. */
export function pathForStage(stage: AuthStage, role: DemoRole | null) {
  switch (stage) {
    case 'signed-out':
      return '/sign-in';
    case 'mfa':
      return '/verify';
    case 'nda':
      return '/onboarding/nda';
    case 'profile':
      return '/onboarding/profile';
    default:
      return role?.home ?? '/';
  }
}

// ── Return-to after sign-in (QA-006) ─────────────────────────────
// A deep link opened while signed out is remembered for this tab and replayed
// once the session is fully ready. In-app paths only, and only for 10 minutes.

const RETURN_KEY = 'devhq.returnTo';
const RETURN_TTL_MS = 10 * 60_000;
const AUTH_PATHS =
  /^\/(sign-in|verify|onboarding|accept-invite|forgot-password|reset-password)(\/|$)/;

/**
 * Same-origin, in-app paths only. Backslashes and control characters are refused
 * outright: browsers read `/\\evil.com` like `//evil.com` (React Router open-redirect
 * advisory, CVE-2025-68470 bypass).
 */
function safePath(p: unknown): p is string {
  if (typeof p !== 'string' || p.length > 2048) return false;
  if (!p.startsWith('/') || p.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(p)) return false;
  try {
    if (new URL(p, 'https://devhq.invalid').origin !== 'https://devhq.invalid') return false;
  } catch {
    return false;
  }
  return !AUTH_PATHS.test(p);
}

export function rememberReturnTo(path: string) {
  if (!safePath(path) || path === '/') return;
  try {
    sessionStorage.setItem(RETURN_KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    /* storage unavailable: the user lands on their home instead */
  }
}

export function peekReturnTo(): string | null {
  try {
    const raw = sessionStorage.getItem(RETURN_KEY);
    if (!raw) return null;
    const { path, at } = JSON.parse(raw) as { path?: unknown; at?: number };
    if (!safePath(path) || typeof at !== 'number' || Date.now() - at > RETURN_TTL_MS) {
      sessionStorage.removeItem(RETURN_KEY);
      return null;
    }
    return path;
  } catch {
    return null;
  }
}

export function clearReturnTo() {
  try {
    sessionStorage.removeItem(RETURN_KEY);
  } catch {
    /* ignore */
  }
}
