import type { SecurityPillar } from '../types/securityFramework';

/**
 * Defense-in-depth framework the platform is measured against.
 * Evidence points at the UI surface or the backend module (backend/src/…) that implements each control.
 */
export const securityPillars: SecurityPillar[] = [
  {
    id: 'identity',
    name: 'Identity-first authentication',
    summary:
      'Phishing-resistant sign-in, just-in-time privilege and continuous session verification.',
    controls: [
      {
        id: 'passkeys',
        title: 'Passkeys (FIDO2 / WebAuthn)',
        detail:
          'Origin-bound credentials that AI-generated phishing can’t replay. SMS is not accepted as a second factor.',
        status: 'partial',
        evidence: 'backend/src/auth/webauthn.ts',
        action: 'register-passkey',
      },
      {
        id: 'totp',
        title: 'TOTP fallback with lockout',
        detail: 'RFC 6238 codes, ±1 step drift window, 5 failures → temporary lock.',
        status: 'enforced',
        evidence: 'backend/src/auth/totp.ts',
        to: '/security',
      },
      {
        id: 'jit',
        title: 'Just-in-time production access',
        detail:
          'No standing admin rights. Grants are time-boxed, MFA re-verified and revoked automatically on expiry.',
        status: 'enforced',
        evidence: 'backend/src/auth/jit.ts',
        to: '/team',
      },
      {
        id: 'continuous',
        title: 'Continuous session verification',
        detail:
          'Device context is re-checked on focus and every minute; drift locks the session until MFA re-verification.',
        status: 'enforced',
        evidence: 'hooks/useContinuousVerification.ts · backend/src/auth/sessions.ts',
      },
    ],
  },
  {
    id: 'waap',
    name: 'Web application & API protection',
    summary: 'API-aware rate limiting, bot mitigation and strict input/output hygiene.',
    controls: [
      {
        id: 'rate',
        title: 'Per-identity rate limiting',
        detail: 'Token-bucket limits per IP and per session; auth endpoints are throttled hardest.',
        status: 'enforced',
        evidence: 'backend/src/security/rateLimit.ts',
      },
      {
        id: 'validation',
        title: 'Allow-list input validation',
        detail:
          'Every request body is parsed against a schema; unknown fields are rejected, sizes are capped.',
        status: 'enforced',
        evidence: 'backend/src/lib/validate.ts',
      },
      {
        id: 'prompt',
        title: 'Prompt-injection guard for AI features',
        detail:
          'Assistant inputs are delimited and stripped of instruction-like control sequences before reaching an LLM.',
        status: 'partial',
        evidence: 'backend/src/lib/validate.ts',
      },
      {
        id: 'discovery',
        title: 'API inventory & abuse monitoring',
        detail:
          'Every route is registered centrally, so undocumented “shadow” endpoints can’t exist.',
        status: 'enforced',
        evidence: 'backend/src/lib/http.ts',
      },
    ],
  },
  {
    id: 'zero-trust',
    name: 'Zero trust architecture',
    summary: 'Every request is authenticated, authorized and scoped — no implicit network trust.',
    controls: [
      {
        id: 'authz',
        title: 'Per-request authorization',
        detail: 'Role × area × action checks on every route, plus product and project scope.',
        status: 'enforced',
        evidence: 'backend/src/auth/rbac.ts',
        to: '/team',
      },
      {
        id: 'scope',
        title: 'Project-scoped data access',
        detail:
          'Queries are filtered to the products a member is assigned to before anything leaves the server.',
        status: 'enforced',
        evidence: 'backend/src/routes/projects.routes.ts',
      },
      {
        id: 'segmentation',
        title: 'Service micro-segmentation',
        detail:
          'Service-to-service calls carry signed, short-lived tokens; databases are not reachable from the edge.',
        status: 'planned',
        evidence: 'backend/src/security/crypto.ts',
      },
    ],
  },
  {
    id: 'supply-chain',
    name: 'Supply chain hardening',
    summary: 'Dependency scanning and strict control of third-party scripts.',
    controls: [
      {
        id: 'sca',
        title: 'Software composition analysis',
        detail: 'Dependencies are scanned on every PR; unmaintained packages are flagged.',
        status: 'enforced',
        evidence: 'Code security',
        to: '/code-security',
      },
      {
        id: 'csp',
        title: 'Strict Content Security Policy',
        detail: 'Nonce-based script-src, no inline eval, frame-ancestors none.',
        status: 'enforced',
        evidence: 'backend/src/security/headers.ts',
      },
      {
        id: 'sri',
        title: 'Subresource integrity for third-party scripts',
        detail: 'Analytics and payment SDKs are pinned by hash.',
        status: 'partial',
        evidence: 'backend/src/security/headers.ts',
      },
    ],
  },
  {
    id: 'crypto',
    name: 'Cryptographic agility',
    summary: 'Modern transport encryption today, and a migration path to post-quantum algorithms.',
    controls: [
      {
        id: 'tls',
        title: 'TLS 1.3 + HSTS preload',
        detail: 'Strict-Transport-Security with includeSubDomains and preload on every response.',
        status: 'enforced',
        evidence: 'backend/src/security/headers.ts',
      },
      {
        id: 'hashing',
        title: 'Memory-hard password hashing',
        detail: 'scrypt (N=2^15) with per-user salt and constant-time comparison.',
        status: 'enforced',
        evidence: 'backend/src/security/crypto.ts',
      },
      {
        id: 'pq',
        title: 'Post-quantum readiness',
        detail:
          'Algorithms are referenced by identifier so keys can rotate to ML-KEM / ML-DSA without code changes.',
        status: 'planned',
        evidence: 'backend/src/config/env.ts',
      },
    ],
  },
  {
    id: 'resilience',
    name: 'Cyber resilience',
    summary: 'Assume breach — detect fast, recover faster, keep recovery points out of reach.',
    controls: [
      {
        id: 'audit',
        title: 'Tamper-evident audit log',
        detail: 'Hash-chained entries; any edit or deletion breaks verification.',
        status: 'enforced',
        evidence: 'backend/src/audit/auditLog.ts',
        to: '/audit',
      },
      {
        id: 'backups',
        title: 'Immutable backups',
        detail: 'Write-once snapshots with retention locks and checksum verification.',
        status: 'enforced',
        evidence: 'backend/src/resilience/backups.ts',
      },
      {
        id: 'drills',
        title: 'Restore drills',
        detail:
          'Monthly restore of the latest snapshot into an isolated environment; MTTR tracked.',
        status: 'partial',
        evidence: 'backend/src/resilience/backups.ts',
      },
    ],
  },
];
