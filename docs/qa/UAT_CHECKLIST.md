# DevHQ user acceptance checklist

For the owner (or a delegate) to tick through by hand before release. Use a **fresh** browser
profile, demo mode, desktop at ~1280 px unless stated. Demo password `devhq-demo`, code `246810`.
Defect IDs refer to [`BETA_REPORT.md`](./BETA_REPORT.md); an item with an open defect is expected
to fail until that defect is fixed.

Mark each item ✅ pass · ❌ fail (note what you saw) · ➖ not applicable.

## A. Sign-in and identity

- [ ] A1. `/sign-in`: email `amara@techorg.io` + password → **Continue** opens the 6-digit screen and **stays there** (QA-002)
- [ ] A2. Entering `246810` lands on Overview with "Good morning/afternoon/evening, Amara"
- [ ] A3. Wrong password shows the same message as an unknown email (no hint which one was wrong)
- [ ] A4. Wrong 6-digit code shows "didn't match" and lets you retry
- [ ] A5. Reload the page while signed in: you stay signed in
- [ ] A6. DevTools → Application: no session token in Local Storage or Session Storage. The cookie `__Host-devhq_session` is HttpOnly + SameSite=Strict
- [ ] A7. Account menu → **Sign out** goes to sign-in. Going back or reloading does not re-enter the app
- [ ] A8. Security → sign out everywhere: a second browser signed in as the same person is signed out too
- [ ] A9. A demo button signs in each of the six roles and lands on that role's home
- [ ] A10. On the 6-digit screen, **Lost your authenticator? Use a backup code** accepts one of the codes shown at onboarding (or generated under Security → Backup codes) once, and refuses it the second time (QA-026)
- [ ] A11. As a Developer, open `/audit`: the no-access page appears; **Request access** shows "Request sent" and the Owner gets a notification linking to that member (QA-010)

## B. New member enrolment (Owner + a second browser)

- [ ] B1. Team & roles → **Invite**: email, role, at least one product → **Create invite** shows a one-time link
- [ ] B2. The invited person appears in the directory as *Invited*, and the audit log shows the invite
- [ ] B3. Open the link in a private window: set a strong password → "Your account is active"
- [ ] B4. Sign in with that email/password: the verify screen offers **authenticator setup** (QR/secret) because the account has no factor yet (QA-020)
- [ ] B5. The demo code `246810` does **not** work for the new member
- [ ] B6. After enrolling, a fresh code from the authenticator completes sign-in, then the NDA and profile steps

## C. Owner

- [ ] C1. Team → member → change their **role** behind a code prompt (QA-001)
- [ ] C2. Member page: product access toggles, production grant, deactivate. After a reload the change is still there and matches the server (QA-003)
- [ ] C3. Deployments: a production deploy requested by someone else → **Approve** → code → "Deployment approved", and the status moves to running/succeeded
- [ ] C4. Approving your **own** production request is refused with a clear message
- [ ] C5. **Reject** on a pending deploy rejects it and does not report a "rollback" (QA-008)
- [ ] C6. Audit log: the invite and the approval are listed. Client-only rows are not mixed in as if they were server-verified (QA-009)

## D. Project manager (Daniel)

- [ ] D1. My work → **New task for me**: title, assignee Kofi, due date → created toast with a key
- [ ] D2. Task page: add a comment, a subtask, **Log time** 1h
- [ ] D3. Reload: title, assignee, due date, comment, subtask and time are all still there
- [ ] D4. Deployments: the **Approve** button is not offered, or approving is refused politely (QA-007)
- [ ] D5. Team / Audit / Security pages show the no-access page, not data

## E. Developer (Kofi)

- [ ] E1. Lands on My work. Own task status Backlog → In progress → In review → Done, persisted after reload
- [ ] E2. Typing `/audit`, `/security`, `/integrations`, `/workspaces` shows "403 · No access"
- [ ] E3. **Request access** on that page reaches an admin, who can see the request (QA-010)
- [ ] E4. Docs: open a doc → **Edit** → change → **Save version** → reload shows the change
- [ ] E5. `/products/blog` (not assigned) shows no Blog data

## F. Designer, Tester, Operations

- [ ] F1. Designer: My work, create a design task. `/deployments` is closed
- [ ] F2. Tester: Test queue → **Fail** sends the task back to In progress
- [ ] F3. Tester: **Pass** takes the task out of the queue (QA-011)
- [ ] F4. Tester: **Report bug** creates a bug
- [ ] F5. Operations: **Declare incident** → add a timeline note → **Mitigated · monitor** → **Resolve**. Each step persists after reload
- [ ] F6. Operations: **Post update** / **Escalate** reach a real channel, or are clearly labelled as not wired (QA-013)
- [ ] F7. Operations approves a production deploy. A wrong code shows an error and a retry works

## G. Everyone

- [ ] G1. Leave the app idle (set idle to 1 min in Security): a warning appears, then the lock screen. Unlock with the code
- [ ] G2. Lock the session, then **reload**: still locked (QA-004)
- [ ] G3. A made-up URL shows a 404 page (QA-005)
- [ ] G4. Signed out, open a task link: after sign-in you land on that task (QA-006)
- [ ] G5. Scope picker → Blog: other products' rows disappear from Deployments, Projects, My work
- [ ] G6. Account menu: theme Dark + language FR survive a reload. Page content is translated, not only the menu (QA-014)
- [ ] G7. ⌘K / Ctrl+K opens search. Arrow keys + Enter navigate. Esc closes
- [ ] G8. Sign-in can be completed with the keyboard only, with a visible focus ring on every control
- [ ] G9. Phone (375 px): bottom nav, **More** sheet reaches every section, no sideways scrolling
- [ ] G10. Tablet (768 px): pages readable, no clipped tables

## H. Wave-4 features

- [ ] H1. Messages: post in a channel, reload, the message is still there
- [ ] H2. Docs: comment on a doc, reload, the comment is still there. The version history lists saved versions
- [ ] H3. Assigning a task to someone shows up in **their** notifications
- [ ] H4. Repositories, Pull requests, Monitors show real rows or a visible **Sample data** badge
- [ ] H5. **Ask DevHQ** without the ML service says "Assistant unavailable" and makes up no answer
- [ ] H6. Deployment detail shows a risk badge marked *heuristic* when ML is down. Assignments show "% risk" with its source in the tooltip
- [ ] H7. Forgot password gives the same answer for real and unknown emails

## I. Resilience

- [ ] I1. Stop the backend while signed in: the app shows an "unavailable / try again" state, not a white screen and not a silent sign-out
- [ ] I2. Throttle the network (DevTools "Slow 3G"): loading skeletons until data arrives

Sign-off: name ____________ date ________ verdict ☐ accept ☐ accept with waivers ☐ reject
