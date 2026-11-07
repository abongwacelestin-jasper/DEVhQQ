# Rotating `SESSION_SECRET`

The backend signs session tokens with `SESSION_SECRET` and also *verifies*
with `SESSION_SECRET_PREVIOUS` when it is set (`Backend/config/env.ts`). That
gives a two-phase rotation with no forced sign-out. Both values reach the
container as files (`infra/secrets/session_secret`,
`infra/secrets/session_secret_previous`) and are read once at container
start, so every step ends with recreating the backend.

Run everything as the deploy user from the checkout (e.g. `/opt/devhq`).

## Planned rotation (users stay signed in)

1. **Promote the current key to "previous".**
   ```bash
   cd /opt/devhq
   cp -p infra/secrets/session_secret infra/secrets/session_secret_previous
   ```
2. **Write a new key** (32 random bytes, 64 hex chars — the production minimum).
   ```bash
   (umask 077; openssl rand -hex 32 | tr -d '\n' > infra/secrets/session_secret.new)
   chmod 0640 infra/secrets/session_secret.new
   mv infra/secrets/session_secret.new infra/secrets/session_secret
   ```
3. **Recreate the backend** so it reads both files, and confirm health.
   ```bash
   docker compose up -d --no-deps --force-recreate backend
   docker compose ps backend          # (healthy)
   curl -fsS https://$DEVHQ_DOMAIN/api/ready
   ```
   The console's config page (`/console`) reports
   `SESSION_SECRET_PREVIOUS: set`.
4. **Wait out the absolute session lifetime** (`SESSION_ABSOLUTE_MS`, default
   12 h). Every session signed with the old key has expired by then.
5. **Retire the old key.**
   ```bash
   : > infra/secrets/session_secret_previous
   docker compose up -d --no-deps --force-recreate backend
   ```
6. Record the rotation (date, operator) in the ops log. The audit chain logs
   `server.started` for each recreate.

## Emergency rotation (key suspected leaked)

Skip the grace period: every existing session must die.

```bash
: > infra/secrets/session_secret_previous
(umask 077; openssl rand -hex 32 | tr -d '\n' > infra/secrets/session_secret.new)
chmod 0640 infra/secrets/session_secret.new
mv infra/secrets/session_secret.new infra/secrets/session_secret
docker compose up -d --no-deps --force-recreate backend
```

Then follow the incident checklist in `docs/deploy/RUNBOOK.md` (review the
audit log for sessions created with the old key, rotate any other secret
that shared the host, notify users that they must sign in again).

## Notes

- Never put the secret in `.env`, shell history or a ticket. `openssl … >
  file` keeps it off the command line.
- With multiple backend replicas, recreate them all in step 3 before anyone
  can be issued a token they cannot verify elsewhere.
- `make secrets` never overwrites an existing `session_secret`, and
  `gen-secrets.sh --rotate session_secret` deliberately refuses and points here.
