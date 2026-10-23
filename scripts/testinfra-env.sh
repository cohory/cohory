#!/usr/bin/env bash
# Shared settings for the test services stack. Sourced by the testinfra and verify scripts.

TESTINFRA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export TESTINFRA_PROJECT="${TESTINFRA_PROJECT:-cohory-testinfra}"
export TESTINFRA_PG_PORT="${TESTINFRA_PG_PORT:-55432}"
export INTEGRATION_LOCK_DIR="${INTEGRATION_LOCK_DIR:-/tmp/cohory-integration.lock}"

testinfra_compose() {
  docker compose --project-name "$TESTINFRA_PROJECT" -f "$TESTINFRA_ROOT/docker/testinfra.compose.yml" "$@"
}

# One database per checkout: the folder name plus a short hash of its full path, so two
# worktrees never share a database.
testinfra_db_name() {
  local top base hash
  top="$(git -C "$TESTINFRA_ROOT" rev-parse --show-toplevel 2>/dev/null || echo "$TESTINFRA_ROOT")"
  base="$(basename "$top" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9\n' '_' | cut -c1-32)"
  hash="$(printf '%s' "$top" | shasum -a 256 | cut -c1-6)"
  echo "cohory_test_${base}_${hash}"
}

testinfra_url() {
  echo "postgres://cohory:cohory@127.0.0.1:${TESTINFRA_PG_PORT}/$1"
}

testinfra_psql() {
  testinfra_compose exec -T postgres psql -U cohory -d postgres -v ON_ERROR_STOP=1 -Atq "$@"
}

testinfra_create_db() {
  if [ -z "$(testinfra_psql -c "select 1 from pg_database where datname = '$1'")" ]; then
    testinfra_psql -c "create database \"$1\"" >/dev/null
  fi
}

testinfra_drop_db() {
  testinfra_psql -c "drop database if exists \"$1\" with (force)" >/dev/null
}
