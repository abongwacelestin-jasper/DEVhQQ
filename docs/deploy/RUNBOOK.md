# TavetaHQ operations runbook

Single-host Docker Compose deployment. Architecture and trust boundaries:
[ARCHITECTURE.md](ARCHITECTURE.md). Hosting on Railway with Cloudflare R2
instead: [RAILWAY.md](RAILWAY.md). All commands run as the `deploy` user in
`/opt/devhq` unless a step says `sudo`.

---

## 1. First deploy on a fresh Ubuntu VM (24.04 LTS)

Sizing to start with: 2 vCPU, 4 GB RAM, 40 GB SSD (plus room for Postgres and
MinIO data).

### 1.1 Base hardening (as root / sudo)

```bash
sudo apt-get update && sudo apt-get -y full-upgrade
sudo apt-get -y install ca-certificates curl git ufw fail2ban unattended-upgrades openssl python3

# Automatic security updates (reboot window 04:30 when required)
sudo dpkg-reconfigure -f noninteractive unattended-upgrades
sudo tee /etc/apt/apt.conf.d/52devhq-unattended >/dev/null <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
EOF

# Non-root deploy user (SSH key only)
sudo adduser --disabled-password --gecos "" deploy
sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
sudo tee /home/deploy/.ssh/authorized_keys >/dev/null < deploy_key.pub   # the public half of DEPLOY_SSH_KEY
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys && sudo chmod 600 /home/deploy/.ssh/authorized_keys

# SSH: keys only, no root login
sudo tee /etc/ssh/sshd_config.d/10-devhq.conf >/dev/null <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
AllowUsers deploy
EOF
sudo systemctl reload ssh

# fail2ban for sshd (default jail is enough)
sudo tee /etc/fail2ban/jail.d/sshd.local >/dev/null <<'EOF'
[sshd]
enabled = true
maxretry = 5
bantime = 1h
EOF
sudo systemctl enable --now fail2ban
```

### 1.2 Firewall: 22, 80, 443 only

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp      # HTTP/3
sudo ufw enable
```

> **Docker bypasses ufw for published ports.** That is why only the edge
> publishes anything in `docker-compose.yml`. Never add `ports:` to postgres,
> minio or models in production; `make smoke` checks this.

### 1.3 Docker Engine + Compose plugin

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker deploy      # docker group = root-equivalent; deploy is the only member

# Daemon defaults: log rotation for anything not in compose, no inter-container
# traffic on the default bridge, live-restore across daemon upgrades.
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" },
  "icc": false,
  "live-restore": true,
  "no-new-privileges": true
}
EOF
sudo systemctl restart docker
```

### 1.4 Checkout and registry access (as `deploy`)

```bash
sudo install -d -o deploy -g deploy /opt/devhq
sudo -iu deploy
git clone https://github.com/<owner>/<repo>.git /opt/devhq    # read-only deploy key if private
cd /opt/devhq
# GHCR pull access (fine-grained PAT with read:packages only)
echo "$GHCR_READ_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin
```

### 1.5 Configuration and secrets

```bash
make secrets               # infra/secrets/* (0700/0640) + .env with DEVHQ_SECRETS_GID
$EDITOR .env               # DEVHQ_DOMAIN, ACME_EMAIL, DEVHQ_IMAGE_PREFIX, SMTP_*, GITHUB_APP_ID ...
```

Paste external credentials into their files (no trailing newline needed; one
value per file): `anthropic_api_key`, `smtp_password`,
`github_app_private_key` (PEM), `github_webhook_secret`,
`github_client_secret`, `github_token`. An empty file = integration off.

**Copy `infra/secrets/backup_encryption_key` to your password manager now.**
Without it, backups cannot be decrypted.

### 1.6 DNS and TLS

1. Create `A` (and `AAAA` if the host has IPv6) records for `DEVHQ_DOMAIN`
   pointing at the host. Wait until `dig +short $DEVHQ_DOMAIN` returns it.
2. Ports 80 and 443 must be reachable from the internet: Caddy uses HTTP-01 /
   TLS-ALPN-01 to get a Let's Encrypt certificate automatically on first
   request and renews it in the background.
3. While testing DNS, avoid rate limits by uncommenting `acme_ca` (staging) in
   `infra/edge/Caddyfile`, then rebuild the edge; remove it afterwards.
4. Certificates and the ACME account live in the `edge_data` volume — include
   it in host backups.
5. HSTS is sent with `preload`. Only submit the domain to hstspreload.org once
   every subdomain serves HTTPS.

### 1.7 Start, verify

```bash
DEVHQ_TAG=sha-<full commit sha>   # set in .env, or use `make up` to build locally
docker compose pull
docker compose up -d --wait --wait-timeout 300 edge
make smoke                         # all checks must pass
```

Then configure the GitHub Environment for `deploy.yml` (secrets
`DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`; vars `DEPLOY_HOST`, `DEPLOY_USER`,
`DEPLOY_PATH`, `DEPLOY_URL`; required reviewers for `production`).

---

## 2. Routine deploys

Branch model: `develop` → **staging**, release tags `vX.Y.Z` on `main` →
**production**. Dependabot PRs target `develop`.

Actions → **Deploy** → `ref`, `environment`. The workflow refuses production
refs that are not release tags on `main` and staging refs that are not on
`develop`, verifies cosign signatures for every image, then runs
`infra/scripts/deploy.sh <sha>` on the host:

1. encrypted DB backup (skip with `PRE_DEPLOY_BACKUP=0`),
2. checkout of the commit's compose/infra files, `DEVHQ_TAG=sha-<sha>`,
3. `pull` + `up -d` (`migrate` runs before `backend`),
4. gate: backend/frontend/edge healthy **and** `/api/health` + `/api/ready`
   200 through the edge within `GATE_TIMEOUT` (180 s),
5. on failure: previous commit + tag restored automatically, workflow fails.

Migrations must be **expand/contract**: a rollback runs the previous backend
against the already-migrated schema. Destructive changes ship one release
after the code that stops using the old shape.

Manual rollback to any earlier build: re-run Deploy with the older ref.
History: `~/.local/state/devhq/history` on the host.

---

## 3. Backups and restore

| What | How | Where |
|---|---|---|
| Postgres | `make backup` (`infra/scripts/backup-db.sh`): `pg_dump -Fc` → AES-256-CBC (PBKDF2-SHA256, 600k) → HMAC-SHA256 | `s3://$S3_BUCKET_BACKUPS/postgres/` |
| MinIO data | volume `minio_data` (host-level snapshot) + bucket versioning | host / off-site |
| TLS state | volume `edge_data` | host snapshot |
| Secrets | `infra/secrets/` | password manager / sealed off-site copy |

Schedule (deploy user's crontab, `crontab -e`):

```cron
17 2 * * *  cd /opt/devhq && infra/scripts/backup-db.sh >> /home/deploy/devhq-backup.log 2>&1
```

Off-site: the backups bucket is on the same host. Mirror it nightly to an
external S3 provider (`mc mirror --overwrite`) or set `BACKUP_LOCAL_DIR` and
ship that directory with your host backup tooling. Object lock / retention on
the bucket is configured by STORAGE's `infra/minio/bootstrap.sh`.

### Restore drill (monthly, and after any backup change)

```bash
make restore-drill       # latest backup → scratch DB → table count → drop
```

Record date, backup key and result. A drill that fails is a Sev-2 incident.

### Real restore

```bash
infra/scripts/restore-db.sh --list
infra/scripts/restore-db.sh postgres/devhq-<UTC>.dump.enc --yes
```

Stops `edge` and `backend`, verifies the HMAC before decrypting, runs
`pg_restore --clean --if-exists --single-transaction`, restarts. Check
`/api/ready`, then announce.

---

## 4. Rotation

| Secret | Procedure |
|---|---|
| `session_secret` | [`infra/scripts/rotate-session-secret.md`](../../infra/scripts/rotate-session-secret.md) (two-phase, no sign-out) |
| `data_encryption_key` | needs app-side re-encryption support (SEC); do not change the file alone, existing ciphertext would become unreadable |
| `app_db_password` | `gen-secrets.sh --rotate app_db_password`, then `docker compose exec postgres psql -U devhq -d devhq -c "ALTER ROLE devhq_app PASSWORD '…'"` reading the new file, then `up -d --force-recreate backend` |
| `postgres_password` (owner) | `gen-secrets.sh --rotate postgres_password`, `ALTER ROLE devhq PASSWORD …`, recreate `migrate` on next deploy |
| `s3_secret_access_key` | `gen-secrets.sh --rotate s3_secret_access_key`, `mc admin user add` with the new secret (as root alias), recreate backend + models |
| `minio_root_password` | rotate file, recreate `minio` (MinIO re-reads root creds at start), re-run `minio-init` |
| `ml_service_token` | `gen-secrets.sh --rotate ml_service_token`, recreate backend **and** models together |
| GitHub / SMTP / Anthropic | replace the file, recreate the consuming service |
| `backup_encryption_key` | new key applies to new backups only; keep the old key as long as old backups are retained |

Rotate everything after staff changes with host access, or any suspected
compromise. `--force-recreate` is required: secrets are read at container
start.

---

## 5. Scaling notes

- **Vertical first.** Raise `deploy.resources.limits` in compose; Postgres
  gains most from RAM (`shared_buffers` ≈ 25 % of its limit via
  `command: postgres -c shared_buffers=…`).
- **Backend replicas.** Collections are hydrated in memory at boot (WAVE4 §3),
  so multiple replicas would diverge without cross-instance invalidation:
  stay at one replica until B-DATA provides it. After that,
  `docker compose up -d --scale backend=N` works behind Caddy (it balances
  across DNS answers for `backend`); SSE (`/api/_events`) then needs sticky
  sessions or a shared broker.
- **Managed services.** Point `database_url`/`database_url_migrator` at a
  managed Postgres (`DATABASE_SSL=true`) and the `S3_*` settings at a managed
  S3; drop the `postgres`/`minio` services.
- **Multiple hosts.** Move to an orchestrator; images, healthchecks and
  `*_FILE` secrets carry over unchanged.

---

## 6. Incident checklist

1. **Declare** — open an incident (TavetaHQ Incidents page or ops channel),
   name an incident lead and a scribe, note start time (UTC).
2. **Stabilise** — `docker compose ps`, `make logs SERVICE=backend`,
   `curl -fsS https://$DEVHQ_DOMAIN/api/ready`. Bad deploy? Re-run **Deploy**
   with the last good ref (automatic rollback already ran if the gate failed).
3. **Contain (security)** — suspected compromise:
   - `sudo ufw deny 443/tcp` / `443/udp` only if active exploitation (full outage);
   - emergency session-secret rotation (kills all sessions);
   - rotate every secret in `infra/secrets/` (section 4) and the GHCR/SSH keys;
   - preserve evidence first: `docker compose logs > incident-<ts>.log`,
     copy `backend_state` (audit chain) and the audit bucket before changes.
4. **Verify integrity** — `/api/ready` reports `auditChain: intact`; compare
   running image digests with signed ones
   (`docker compose images --format json` vs. `cosign verify`).
5. **Data loss** — restore drill into a scratch DB first, then live restore
   (section 3) once the right backup is identified.
6. **Communicate** — status updates every 30 min to stakeholders; user notice
   if sessions were revoked or data was exposed (legal timelines apply).
7. **Close** — blameless post-incident review within 5 working days; action
   items get owners and dates.

### Useful commands

```bash
docker compose ps -a                         # status + health
docker compose logs -f --tail 200 backend    # follow one service
docker compose exec postgres psql -U devhq -d devhq
docker compose run --rm migrate              # re-run migrations
docker compose up -d --force-recreate <svc>  # re-read secrets/config
docker system df && docker image prune -f    # disk pressure
```
