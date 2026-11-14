# Security Policy

## Supported Versions

Currently, only the latest version of TavetaHQ is supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| 1.0.0   | :white_check_mark: |

## Reporting a Vulnerability

**IMPORTANT: Do NOT report security vulnerabilities through public GitHub
issues.**

### How to Report

To report a security vulnerability, please email us at:

**security@tavetahq.io**

Please include the following information in your report:

- A description of the vulnerability
- Steps to reproduce the issue
- Potential impact of the vulnerability
- Any proof-of-concept code or screenshots (if applicable)
- Your suggested fix (if known)

### What to Expect

- **Response Time**: We will acknowledge receipt of your report within 48 hours
- **Initial Assessment**: We will provide an initial assessment and estimated
  timeline within 7 days
- **Coordination**: We will work with you to understand and validate the
  vulnerability
- **Disclosure**: We will disclose the vulnerability after a fix is released,
  giving you credit (unless you prefer to remain anonymous)

### Security Best Practices for Reporters

1. **Responsible Disclosure**: Please give us reasonable time to address the
   vulnerability before disclosing it publicly
2. **No Exploitation**: Do not exploit the vulnerability in production systems
   or access user data
3. **Limited Scope**: Only access data necessary to demonstrate the
   vulnerability
4. **Keep it Confidential**: Do not share details about the vulnerability with
   others until we address it

## Security Features

This section describes what the code does today. The threat model is in
[docs/security/THREAT_MODEL.md](docs/security/THREAT_MODEL.md), and
[docs/security/CONTROLS.md](docs/security/CONTROLS.md) maps every control to
the file and the test that cover it.

### Authentication & Authorization

- Password (scrypt), then a second factor: a **passkey** (WebAuthn, preferred
  and phishing-resistant) or a TOTP authenticator app. SMS is not supported.
- Passwordless passkey sign-in. Passkeys also handle step-up and lock-screen
  unlock.
- Browsers hold **cookie-only sessions**: an HMAC-signed id in a `__Host-`,
  HttpOnly, Secure, SameSite=Strict cookie. The session id is rotated on every
  privilege change, bound to the device context, and has idle and absolute
  timeouts. Page script never sees a session token.
- **Personal access tokens** (`dhq_pat_…`) for CLIs and CI. They are stored as
  SHA-256 hashes and shown once. Each one is scoped per permission area and
  intersected with the member's live role. Expiry is required (≤ 90 days).
  They are revoked when the member is deactivated, and they can never perform
  step-up actions.
- Role × area RBAC with product scoping. Out-of-scope records return 404.
  Sensitive actions require step-up (re-verification within 5 minutes).
  Production access is granted through just-in-time elevation.
- Demo accounts exist only outside production. The shared demo code never
  works for a member who has a real TOTP secret or passkey, and a production
  process refuses to start if any `DEMO_*` credential variable is set.

### Data Protection

- **Encryption at rest:** TOTP secrets and stored third-party tokens are
  sealed with AES-256-GCM (`DATA_ENCRYPTION_KEY`). Each value carries a key id
  for rotation and is bound to its record by authenticated data. Production
  refuses to boot without the key.
- One-way hashes for passwords (scrypt), PATs and invite tokens (SHA-256).
- TLS 1.3 at the edge, plus HSTS (2 years, preload) in production.
- Allow-list input validation that rejects unknown fields. Bodies must be
  JSON. The query runner cannot select secret fields.

### Network & Browser Security

- Per-IP, per-account and per-member rate limits on every credential check.
  The store is pluggable, so a shared store can back multiple replicas.
- A CSRF origin guard on every state-changing method, plus a Fetch Metadata
  (`Sec-Fetch-Site`) check as a second, independent layer. CORS is open only
  to allow-listed origins.
- Headers: a strict CSP (`default-src 'none'` for the API; a nonce policy for
  HTML), `Cache-Control: no-store`, COOP/CORP/COEP, Permissions-Policy,
  `X-Frame-Options: DENY` and `nosniff`.

### Monitoring & Auditing

- A hash-chained, verifiable audit log (`GET /api/audit/verify`) records every
  state change, including every credential and token event.
- Sign-in location risk scoring (impossible travel, Tor/VPN/datacenter).
- Passkey clone detection: a sign-count regression suspends the key.

### Reporting a suspected token leak

PATs start with `dhq_pat_`, so secret scanners can find them. If you find a
leaked token, report it to security@tavetahq.io. The owner, or any
Administration admin, can revoke it at once with `DELETE /api/tokens/:id`.

### Dependency Security

- Automated dependency scanning (Dependabot)
- Regular security audits
- Locked dependency versions
- Minimum age requirement for new packages (7 days)

## Security Best Practices for Contributors

### Code Security

- Never commit secrets, API keys, or credentials
- Use environment variables for sensitive configuration
- Validate all user inputs
- Follow OWASP security guidelines
- Use parameterized queries to prevent SQL injection
- Sanitize output to prevent XSS attacks

### Git Security

- Enable branch protection
- Require pull request reviews
- Use signed commits
- Never commit `.env` files
- Review `.gitignore` to ensure sensitive files are excluded

### Dependency Management

- Review security advisories before adding dependencies
- Prefer packages with active maintenance
- Keep dependencies up to date
- Use `npm audit` regularly
- Lock dependency versions in package-lock.json

### Secrets Management

- Use secret scanning tools
- Rotate secrets regularly
- Use environment-specific secrets
- Never hardcode credentials
- Use secret management services in production

## Security Audits

We conduct regular security audits including:

- Automated dependency vulnerability scanning
- Static application security testing (SAST)
- Dynamic application security testing (DAST)
- Penetration testing
- Code security reviews

## Contact

For general security questions or inquiries:

- Email: security@tavetahq.io
- PGP Key: [Add PGP key for encrypted communication]

## Acknowledgments

We thank all security researchers who have helped make TavetaHQ more secure through
responsible vulnerability disclosure.
