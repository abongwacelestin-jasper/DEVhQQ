#!/bin/sh
# Runs once, on first initialisation of the pg_data volume (official image
# /docker-entrypoint-initdb.d hook), as the bootstrap owner role `devhq`.
#
# Two roles:
#   devhq      owner / migrator: owns the schema, runs DDL. Used only by the
#              one-shot `migrate` service (secret: database_url_migrator).
#   devhq_app  runtime role for the backend: DML only, no DDL, cannot create
#              roles or databases (secret: database_url).
#
# Tables created later by `devhq` are granted to devhq_app via default
# privileges, so migrations never need to GRANT explicitly.
#
# Existing volume (created before this script existed)? Run it by hand:
#   docker compose exec -T postgres sh /docker-entrypoint-initdb.d/10-app-role.sh
set -eu

[ -s /run/secrets/app_db_password ] || { echo "app_db_password is empty" >&2; exit 1; }

# The password is read by psql itself (backtick \set), never placed on argv.
psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-devhq}" -d "${POSTGRES_DB:-devhq}" <<'SQL'
\set app_pw `cat /run/secrets/app_db_password`
SELECT format('CREATE ROLE devhq_app LOGIN PASSWORD %L', :'app_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'devhq_app') \gexec
SELECT format('ALTER ROLE devhq_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'app_pw') \gexec

REVOKE ALL ON DATABASE devhq FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE devhq TO devhq_app;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO devhq_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO devhq_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO devhq_app;
ALTER DEFAULT PRIVILEGES FOR ROLE devhq IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO devhq_app;
ALTER DEFAULT PRIVILEGES FOR ROLE devhq IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO devhq_app;
SQL
echo "initdb: devhq_app runtime role ready"
