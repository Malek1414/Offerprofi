#!/usr/bin/env bash
#
# Apply every migration to a scratch database and run the assertions in
# db/tests/ against it (FEATURE_INVENTORY F0.8).
#
# A scratch database each run, dropped afterwards: these tests create roles, walk
# inquiries through terminal states and deliberately violate constraints. Run twice
# against a persistent database and the second run fails on leftovers from the
# first, which would train everyone to ignore the result.
#
# Usage:   ./db/test.sh
#          PGHOST=... PGUSER=... ./db/test.sh
set -euo pipefail

DB_NAME="${DB_NAME:-angebot_db_test}"
MIGRATIONS_DIR="$(cd "$(dirname "$0")" && pwd)/migrations"
TESTS_DIR="$(cd "$(dirname "$0")" && pwd)/tests"

# Postgres.app is the common macOS install and is not on PATH by default.
if ! command -v psql >/dev/null 2>&1; then
  PGAPP="/Applications/Postgres.app/Contents/Versions/latest/bin"
  if [ -d "$PGAPP" ]; then
    export PATH="$PGAPP:$PATH"
  else
    echo "psql not found. Install PostgreSQL 15+ or set PATH." >&2
    exit 1
  fi
fi

cleanup() {
  psql -d postgres -qc "drop database if exists ${DB_NAME};" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "→ creating scratch database ${DB_NAME}"
cleanup
psql -d postgres -qc "create database ${DB_NAME};"

for migration in "${MIGRATIONS_DIR}"/*.sql; do
  echo "→ applying $(basename "${migration}")"
  psql -d "${DB_NAME}" -v ON_ERROR_STOP=1 -q -f "${migration}"
done

for test_file in "${TESTS_DIR}"/*.sql; do
  echo "→ running $(basename "${test_file}")"
  psql -d "${DB_NAME}" -v ON_ERROR_STOP=1 -q -f "${test_file}"
done

echo "✓ database assertions passed"
