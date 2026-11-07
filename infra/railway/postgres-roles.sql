-- DevHQ least-privilege roles for the Railway PostgreSQL service.
--
-- Run as the plugin's superuser (`postgres`), once before the first deploy and
-- again after it (step 2 needs the tables the first migration creates). Safe
-- to re-run: roles are created if missing and their passwords re-applied.
--
--   railway connect Postgres          # opens psql as postgres (needs psql >= 15)
--   \i infra/railway/postgres-roles.sql
--
-- infra/railway/setup.sh --db-roles does the same and passes the passwords
-- through the environment (never argv). The passwords are the shared Railway
-- variables APP_DB_PASSWORD, MIGRATOR_DB_PASSWORD and JOBS_DB_PASSWORD.
--
-- Roles (same split as infra/postgres/initdb and Backend/db/README.md):
--   devhq_migrator  owns the schema, runs DDL. Used only by the backend's
--                   pre-deploy `node --run migrate` (DATABASE_MIGRATION_URL).
--   devhq_app       the API (DATABASE_URL on backend): DML only, no DDL.
--   devhq_jobs      the cron service: read rows, append audit rows, nothing
--                   else, so a one-shot backup can never write collections.
-- The plugin's own `postgres` user and DATABASE_URL are never given to an
-- application service.

\set ON_ERROR_STOP on
\getenv app_pw DEVHQ_APP_DB_PASSWORD
\getenv migrator_pw DEVHQ_MIGRATOR_DB_PASSWORD
\getenv jobs_pw DEVHQ_JOBS_DB_PASSWORD
-- An unset variable leaves the literal :'name' in the query, which fails here.
SELECT length(:'app_pw') >= 24 AND length(:'migrator_pw') >= 24 AND length(:'jobs_pw') >= 24
  AS passwords_ok \gset
\if :passwords_ok
\else
  \echo 'Set DEVHQ_APP_DB_PASSWORD, DEVHQ_MIGRATOR_DB_PASSWORD and DEVHQ_JOBS_DB_PASSWORD (>= 24 chars each)'
  \quit
\endif

-- ---- step 1: roles, database and schema privileges -------------------------

SELECT format('CREATE ROLE %I LOGIN', r) FROM unnest(ARRAY['devhq_migrator', 'devhq_app', 'devhq_jobs']) AS r
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) \gexec

SELECT format('ALTER ROLE devhq_migrator WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'migrator_pw') \gexec
SELECT format('ALTER ROLE devhq_app      WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'app_pw') \gexec
SELECT format('ALTER ROLE devhq_jobs     WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'jobs_pw') \gexec

-- Statement timeout for the runtime roles even if the client forgets.
ALTER ROLE devhq_app  SET statement_timeout = '30s';
ALTER ROLE devhq_jobs SET statement_timeout = '120s';

SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database()) \gexec
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO devhq_migrator, devhq_app', current_database()) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO devhq_jobs', current_database()) \gexec

-- The migrator owns the schema; nobody else may create objects in it.
ALTER SCHEMA public OWNER TO devhq_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO devhq_app, devhq_jobs;

-- Everything the migrator creates is usable (not ownable) by the others.
ALTER DEFAULT PRIVILEGES FOR ROLE devhq_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO devhq_app;
ALTER DEFAULT PRIVILEGES FOR ROLE devhq_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO devhq_app;
ALTER DEFAULT PRIVILEGES FOR ROLE devhq_migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO devhq_jobs;

-- ---- step 2: after the first migration (no-op before it) -------------------

-- Tables created by hand as `postgres` before this script existed move to the migrator.
SELECT format('ALTER TABLE public.%I OWNER TO devhq_migrator', tablename)
FROM pg_tables WHERE schemaname = 'public' AND tableowner <> 'devhq_migrator' \gexec

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO devhq_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO devhq_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO devhq_jobs;

-- Append-only and bookkeeping tables (Backend/db/README.md): the trigger
-- already blocks changes; this removes the privilege as well.
SELECT 'REVOKE UPDATE, DELETE, TRUNCATE ON audit_entries FROM devhq_app'
WHERE to_regclass('public.audit_entries') IS NOT NULL \gexec
SELECT 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON schema_migrations FROM devhq_app'
WHERE to_regclass('public.schema_migrations') IS NOT NULL \gexec
-- The cron process mirrors its own audit entries (db/auditSink.ts).
SELECT 'GRANT INSERT ON audit_entries TO devhq_jobs'
WHERE to_regclass('public.audit_entries') IS NOT NULL \gexec

\echo 'devhq roles ready: devhq_migrator (DDL), devhq_app (DML), devhq_jobs (read + audit append)'
