-- Append-only copy of the tamper-evident audit chain (audit/auditLog.ts).
-- Rows can be inserted and read, never changed: UPDATE, DELETE and TRUNCATE
-- are rejected by triggers, and the runtime role is granted INSERT + SELECT
-- only (see db/README.md). Each boot starts a new in-memory chain, so `seq`
-- is only unique per `chain_id`; `hash` is globally unique.

CREATE TABLE audit_entries (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain_id    text        NOT NULL,
  seq         bigint      NOT NULL,
  at          timestamptz NOT NULL,
  actor       text        NOT NULL,
  action      text        NOT NULL,
  target      text        NOT NULL,
  sensitive   boolean     NOT NULL DEFAULT false,
  request_id  text,
  prev_hash   text        NOT NULL,
  hash        text        NOT NULL UNIQUE,
  inserted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_id, seq)
);

CREATE INDEX audit_entries_at ON audit_entries (at DESC);
CREATE INDEX audit_entries_actor_at ON audit_entries (actor, at DESC);

CREATE FUNCTION audit_entries_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_entries is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_entries_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_entries
  FOR EACH ROW EXECUTE FUNCTION audit_entries_reject_change();

CREATE TRIGGER audit_entries_no_truncate
  BEFORE TRUNCATE ON audit_entries
  FOR EACH STATEMENT EXECUTE FUNCTION audit_entries_reject_change();
