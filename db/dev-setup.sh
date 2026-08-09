#!/usr/bin/env bash
#
# Create a local development database and the login role the application uses.
#
# Separate from db/test.sh, which drops its database on every run. This one is
# persistent: you sign up once and stay signed up across restarts, which is the whole
# point of having it.
#
# The role matters more than it looks. `app_login` inherits `app_user`, which is
# NOLOGIN and NOBYPASSRLS — so a bug in application code cannot bypass a row level
# security policy. Connecting as the database owner instead would silently disable
# every policy in the product while all the tests still passed, which is precisely the
# failure src/db/client.ts exists to prevent. Development must run under the same
# constraint as production or the constraint is not being tested.
#
# Usage:   ./db/dev-setup.sh
#          DB_NAME=other ./db/dev-setup.sh
set -euo pipefail

DB_NAME="${DB_NAME:-angebot_dev}"
APP_ROLE="${APP_ROLE:-app_login}"
APP_PASSWORD="${APP_PASSWORD:-dev-only-password}"
MIGRATIONS_DIR="$(cd "$(dirname "$0")" && pwd)/migrations"

if ! command -v psql >/dev/null 2>&1; then
  PGAPP="/Applications/Postgres.app/Contents/Versions/latest/bin"
  if [ -d "$PGAPP" ]; then
    export PATH="$PGAPP:$PATH"
  else
    echo "psql not found. Install PostgreSQL 15+ or set PATH." >&2
    exit 1
  fi
fi

if psql -d postgres -tAc "select 1 from pg_database where datname = '${DB_NAME}'" | grep -q 1; then
  echo "→ ${DB_NAME} already exists; applying any new migrations"
else
  echo "→ creating ${DB_NAME}"
  psql -d postgres -qc "create database ${DB_NAME};"
fi

for migration in "${MIGRATIONS_DIR}"/*.sql; do
  echo "→ applying $(basename "${migration}")"
  # Migrations are written to be idempotent where they can be; a re-run of an already
  # applied one is expected to fail on "already exists" and is not an error here.
  psql -d "${DB_NAME}" -q -f "${migration}" 2>&1 | grep -v "already exists" || true
done

echo "→ ensuring login role ${APP_ROLE}"
psql -d "${DB_NAME}" -q <<SQL
do \$\$
begin
  if not exists (select 1 from pg_roles where rolname = '${APP_ROLE}') then
    create role ${APP_ROLE} login password '${APP_PASSWORD}';
  end if;
end \$\$;

grant ${APP_ROLE} to current_user;
grant app_user to ${APP_ROLE};
grant connect on database ${DB_NAME} to ${APP_ROLE};
grant usage on schema public to ${APP_ROLE};
SQL

echo
echo "✓ ready. Put this in .env.local:"
echo
echo "  DATABASE_URL=postgresql://${APP_ROLE}:${APP_PASSWORD}@localhost:5432/${DB_NAME}"
echo
