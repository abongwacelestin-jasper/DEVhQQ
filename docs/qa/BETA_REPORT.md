# TavetaHQ beta report

Lane **QA**, wave 4. Plan: [`BETA_TEST_PLAN.md`](./BETA_TEST_PLAN.md). Manual pass:
[`UAT_CHECKLIST.md`](./UAT_CHECKLIST.md).

## Verdict

**Ready for release, pending the owner's manual UAT pass.** Every exit criterion in the plan
(§6) is met. There are no open S1, S2 or S3 defects, no axe critical violations, and two
consecutive fresh runs gave identical results with 0 flakes. One documented limitation remains:
French and Spanish cover navigation and page headings only, not body copy
([known limits](../operations/known-limits.md)).

## Runs (final branch, fresh processes)

| Run | Onboarding project | Chromium project | Unexpected | Flaky |
|---|---|---|---|---|
| 1 | 1/1 | 104/104 | 0 | 0 |
| 2 | 1/1 | 104/104 | 0 | 0 |

`cd e2e && npm test` (onboarding, then the Chromium journeys). Each run starts its own backend
with an in-memory store and a production build served by `vite preview`. `retries: 0`.

## Defects

| ID | Sev | Summary | Status |
|---|---|---|---|
| QA-001 | S2 | No UI to change a member's role | Fixed in wave 4 (role select behind step-up) |
| QA-002 | S1 | Password + MFA sign-in impossible: the verify screen signed the user out | Fixed (F-SEC keeps partial sessions alive; explicit Verify button) |
| QA-003 | S2 | Member permission edits not saved | Fixed in wave 4 |
| QA-004 | S1 | Lock screen dropped by a reload | Fixed in wave 4 |
| QA-005 | S3 | No 404 page; unknown URLs silently went home | Fixed: 404 inside the app shell, URL kept |
| QA-006 | S3 | Deep link lost across sign-in | Fixed: requested path replayed after sign-in (tab-scoped, 10 min, in-app paths only) |
| QA-007 | S2 | Approve offered to Deployment:view | Fixed in wave 4 |
| QA-010 | S2 | "Request access" never reached an admin | Fixed: `POST /api/access/requests`, audited, notifies Administration:manage |
| QA-011 | S2 | Tester "Pass" left the task In review | Fixed: Pass moves the task to Done, server-confirmed |
| QA-012 | S2 | Onboarding state only in sessionStorage | Fixed in wave 4 (server is the authority) |
| QA-013 | S2 | Incident "Post update" / "Escalate" were local only | Closed: the buttons were removed; every remaining incident action persists |
| QA-014 | S3 | Translation covered navigation only | Partly fixed: page headings translate; body copy is a documented limit |
| QA-020 | S1 | New members could not enrol a first factor on the verify screen | Fixed (F-SEC) |
| QA-026 | S2 | Onboarding "backup codes" were a fixed formula, never stored | Fixed: 10 random one-time codes, hashed server-side, usable on the verify screen, regenerable from Security |
| QA-027 | S2 | White screen on reload while the API is down | Fixed (error state with retry) |
| QA-028 | S1 | Any member could read the audit trail and console data | Fixed: Administration:view required |
| QA-029 | S3 | "Done" toast shown before the API answered | Fixed |
| QA-031 | S2 | Assistant panel sent a scope the API rejects | Fixed: panel sends `{product?}` |
| QA-032 | S3 | axe critical `aria-required-children` on Messages | Fixed: filter is a group of pressed buttons |

## Coverage

Six persona journeys (Owner, Project manager, Developer, Designer, Tester, Operations); identity
(password + code, wrong code and retry, backup code, lock screen, step-up with retry, sign out
everywhere, no token in web storage); first-member enrolment; onboarding (NDA, profile, backup
codes); permissions (UI gating, no-access page, API refusal, product scope); routing (404, deep
links, sign-in detour); preferences; mobile; keyboard; axe WCAG 2.1 A/AA on every main route in
light and dark; resilience (API refused or 502, slow API, failed write); wave-4 features
(messaging, doc comments and versions, notifications, repositories, PRs, monitors with sample
labels, assistant unavailable state, deploy-risk and task-insight badges, tokens, recovery).

Not covered here: load, penetration testing (see the CYBER report), real GitHub, SMTP, S3 and a
trained ML model (each was left unconfigured on purpose to check graceful degradation).
