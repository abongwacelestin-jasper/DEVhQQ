-- Phase 1 of the relational data layer (ADR 0011).
--
-- Typed tables for the data every replica must agree on: members (with their
-- credentials), sessions, tasks, task events, task comments and notifications.
-- These rows are read on demand by the repositories in Backend/data/; they are
-- no longer hydrated into memory.
--
--  * Every row carries `org_id` (single tenant today: 'default') and every
--    primary key starts with it, so the tables can later be sharded or
--    distributed by organisation without changing a key.
--  * `extra` holds any field a newer build wrote that this schema has no
--    column for, so a row never loses data on a round trip.
--  * Append-heavy tables (task_events, notifications) are range-partitioned
--    by time, monthly, with a DEFAULT partition so an insert never fails for
--    lack of a partition. devhq_ensure_monthly_partitions() creates months
--    ahead; boot calls it through the migration role.
--  * Secrets stay sealed exactly as before: members.totp_secret holds the
--    AES-GCM envelope from security/crypto.ts seal(), never plaintext;
--    password_hash is scrypt; backup codes and invite tokens are SHA-256.
--    Sessions are keyed by SHA-256 of the token's random id, never the token.

-- ─── members ──────────────────────────────────────────────────────────────
CREATE SEQUENCE members_seq;

CREATE TABLE members (
  org_id            text        NOT NULL DEFAULT 'default',
  id                text        NOT NULL,
  -- Insertion order: member lists keep the order they always had.
  seq               bigint      NOT NULL DEFAULT nextval('members_seq'),
  name              text        NOT NULL,
  email             text        NOT NULL,
  role              text        NOT NULL,
  products          text[]      NOT NULL DEFAULT '{}',
  status            text        NOT NULL,
  password_hash     text        NOT NULL,
  totp_secret       text,
  backup_codes      jsonb,
  passkeys          jsonb       NOT NULL DEFAULT '[]',
  failed_logins     integer     NOT NULL DEFAULT 0,
  locked_until      bigint,
  invite_token_hash text,
  invite_expires_at bigint,
  nda_signed_at     text,
  nda_version       text,
  profile           jsonb,
  offboarding       jsonb,
  extra             jsonb       NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  CONSTRAINT members_status_valid CHECK (status IN ('active', 'invited', 'deactivated')),
  CONSTRAINT members_id_len CHECK (char_length(id) BETWEEN 1 AND 64),
  CONSTRAINT members_passkeys_array CHECK (jsonb_typeof(passkeys) = 'array')
);

CREATE UNIQUE INDEX members_email_unique ON members (org_id, lower(email));
CREATE INDEX members_status ON members (org_id, status);
CREATE UNIQUE INDEX members_invite_token ON members (org_id, invite_token_hash)
  WHERE invite_token_hash IS NOT NULL;
-- Passkey sign-in looks a credential id up across every member.
CREATE INDEX members_passkeys_gin ON members USING gin (passkeys jsonb_path_ops);

-- ─── sessions ─────────────────────────────────────────────────────────────
CREATE TABLE sessions (
  org_id            text    NOT NULL DEFAULT 'default',
  id                text    NOT NULL,
  member_id         text    NOT NULL,
  stage             text    NOT NULL,
  method            text    NOT NULL,
  created_at        bigint  NOT NULL,
  last_seen_at      bigint  NOT NULL,
  verified_at       bigint  NOT NULL DEFAULT 0,
  ua_hash           text    NOT NULL,
  client            text    NOT NULL,
  ip                text    NOT NULL,
  location          jsonb   NOT NULL,
  last_totp_counter bigint  NOT NULL DEFAULT -1,
  extra             jsonb   NOT NULL DEFAULT '{}',
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES members (org_id, id) ON DELETE CASCADE,
  CONSTRAINT sessions_stage_valid CHECK (stage IN ('password', 'verified'))
);

CREATE INDEX sessions_member ON sessions (org_id, member_id, last_seen_at DESC);
CREATE INDEX sessions_created ON sessions (org_id, created_at);

-- ─── tasks ────────────────────────────────────────────────────────────────
CREATE SEQUENCE tasks_seq;

CREATE TABLE tasks (
  org_id      text        NOT NULL DEFAULT 'default',
  key         text        NOT NULL,
  -- Insertion order: the tie-breaker for every ordering, like the old Map.
  seq         bigint      NOT NULL DEFAULT nextval('tasks_seq'),
  title       text        NOT NULL,
  product     text        NOT NULL,
  project_id  text        NOT NULL,
  type        text        NOT NULL,
  status      text        NOT NULL,
  priority    text        NOT NULL,
  assignee    text        NOT NULL,
  reviewer    text,
  due         date        NOT NULL,
  estimate    integer     NOT NULL,
  description text,
  pr          integer,
  blocked_by  text,
  created_by  text        NOT NULL,
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL,
  extra       jsonb       NOT NULL DEFAULT '{}',
  PRIMARY KEY (org_id, key),
  FOREIGN KEY (org_id, assignee) REFERENCES members (org_id, id),
  FOREIGN KEY (org_id, reviewer) REFERENCES members (org_id, id)
);

CREATE INDEX tasks_product_due ON tasks (org_id, product, due, seq);
CREATE INDEX tasks_assignee ON tasks (org_id, assignee);
CREATE INDEX tasks_project ON tasks (org_id, project_id);

-- Task keys (RB-231) are allocated atomically per prefix, so two replicas
-- creating tasks at the same moment never pick the same key.
CREATE TABLE task_key_counters (
  org_id text    NOT NULL DEFAULT 'default',
  prefix text    NOT NULL,
  last   integer NOT NULL,
  PRIMARY KEY (org_id, prefix)
);

-- ─── partition helper ─────────────────────────────────────────────────────
-- Creates the monthly partitions of `parent` covering [from, from + months).
-- Idempotent; a month that cannot be created (for instance because the
-- DEFAULT partition already holds rows for it) is skipped with a notice.
CREATE FUNCTION devhq_ensure_monthly_partitions(parent regclass, start_month date, months integer)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  created integer := 0;
  m date;
  part text;
BEGIN
  FOR i IN 0 .. months - 1 LOOP
    m := (date_trunc('month', start_month) + make_interval(months => i))::date;
    part := format('%s_%s', parent::text, to_char(m, 'YYYYMM'));
    IF to_regclass(part) IS NULL THEN
      BEGIN
        EXECUTE format(
          'CREATE TABLE %I PARTITION OF %s FOR VALUES FROM (%L) TO (%L)',
          part, parent::text, m, (m + interval '1 month')::date);
        created := created + 1;
      EXCEPTION WHEN others THEN
        RAISE NOTICE 'partition % skipped: %', part, SQLERRM;
      END;
    END IF;
  END LOOP;
  RETURN created;
END;
$$;

-- ─── task events (append-heavy, partitioned) ──────────────────────────────
CREATE SEQUENCE task_events_seq;

CREATE TABLE task_events (
  org_id     text        NOT NULL DEFAULT 'default',
  id         text        NOT NULL,
  task_key   text        NOT NULL,
  seq        bigint      NOT NULL DEFAULT nextval('task_events_seq'),
  actor      text        NOT NULL,
  at         timestamptz NOT NULL,
  kind       text        NOT NULL,
  from_value text,
  to_value   text,
  note       text,
  extra      jsonb       NOT NULL DEFAULT '{}',
  PRIMARY KEY (org_id, id, at),
  FOREIGN KEY (org_id, task_key) REFERENCES tasks (org_id, key) ON DELETE CASCADE
) PARTITION BY RANGE (at);

CREATE TABLE task_events_default PARTITION OF task_events DEFAULT;
CREATE INDEX task_events_task_at ON task_events (org_id, task_key, at, seq);
CREATE INDEX task_events_id ON task_events (org_id, id);

-- ─── task comments ────────────────────────────────────────────────────────
CREATE SEQUENCE task_comments_seq;

CREATE TABLE task_comments (
  org_id   text        NOT NULL DEFAULT 'default',
  id       text        NOT NULL,
  task_key text        NOT NULL,
  seq      bigint      NOT NULL DEFAULT nextval('task_comments_seq'),
  author   text        NOT NULL,
  text     text        NOT NULL,
  at       timestamptz NOT NULL,
  extra    jsonb       NOT NULL DEFAULT '{}',
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, task_key) REFERENCES tasks (org_id, key) ON DELETE CASCADE
);

CREATE INDEX task_comments_task_at ON task_comments (org_id, task_key, at, seq);

-- ─── notifications (append-heavy, partitioned) ────────────────────────────
CREATE TABLE notifications (
  org_id     text        NOT NULL DEFAULT 'default',
  -- Sortable ids (ntf-<time><random>) are the inbox cursor: byte order, not locale order.
  id         text        COLLATE "C" NOT NULL,
  member_id  text        NOT NULL,
  kind       text        NOT NULL,
  title      text        NOT NULL,
  body       text        NOT NULL,
  link       text        NOT NULL,
  ref_id     text        NOT NULL,
  actor      text        NOT NULL,
  at         timestamptz NOT NULL,
  read_at    timestamptz,
  emailed_at timestamptz,
  extra      jsonb       NOT NULL DEFAULT '{}',
  PRIMARY KEY (org_id, id, at),
  FOREIGN KEY (org_id, member_id) REFERENCES members (org_id, id) ON DELETE CASCADE
) PARTITION BY RANGE (at);

CREATE TABLE notifications_default PARTITION OF notifications DEFAULT;
-- Inbox: newest first by sortable id (the keyset cursor).
CREATE INDEX notifications_inbox ON notifications (org_id, member_id, id DESC);
CREATE INDEX notifications_unread ON notifications (org_id, member_id) WHERE read_at IS NULL;
CREATE INDEX notifications_ref_unread ON notifications (org_id, kind, ref_id) WHERE read_at IS NULL;
CREATE INDEX notifications_digest ON notifications (org_id, at)
  WHERE read_at IS NULL AND emailed_at IS NULL;
CREATE INDEX notifications_id ON notifications (org_id, id);

-- A year back (backfilled history) and a year ahead.
SELECT devhq_ensure_monthly_partitions('task_events', (now() - interval '12 months')::date, 25);
SELECT devhq_ensure_monthly_partitions('notifications', (now() - interval '12 months')::date, 25);
