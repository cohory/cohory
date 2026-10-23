#!/usr/bin/env bash
# Run integration tests against this checkout's own database on the shared test services
# stack. Creates the database if it is missing and drops it at the end
# (TESTINFRA_KEEP_DB=1 keeps it). Takes one slot of the machine wide test budget
# (scripts/lib/slots.sh), and holds a machine wide lock so two integration runs never share the
# cluster at once: tests create cluster wide roles.
# Extra arguments go to `turbo run test:integration`, for example --filter=@cohory/posts.
set -euo pipefail

source "$(dirname "$0")/testinfra-env.sh"
source "$(dirname "$0")/lib/slots.sh"
cd "$TESTINFRA_ROOT"

cohory_slots_acquire 1 "integration run from $TESTINFRA_ROOT" "$$"
trap 'cohory_slots_release "$$"' EXIT
bash scripts/testinfra-up.sh >/dev/null
cohory_lock_acquire "$INTEGRATION_LOCK_DIR" "integration run from $TESTINFRA_ROOT" "$$"

db="$(testinfra_db_name)"
cleanup() {
  if [ "${TESTINFRA_KEEP_DB:-0}" != "1" ]; then
    testinfra_drop_db "$db" || echo "could not drop $db; drop it with scripts/testinfra-down.sh" >&2
  fi
  cohory_lock_release "$INTEGRATION_LOCK_DIR" "$$"
  cohory_slots_release "$$"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

testinfra_create_db "$db"
DATABASE_URL="$(testinfra_url "$db")"
export DATABASE_URL DATABASE_ADMIN_URL="$DATABASE_URL"
echo "integration database $db on 127.0.0.1:$TESTINFRA_PG_PORT"

pnpm --silent turbo run test:integration --concurrency="${INTEGRATION_CONCURRENCY:-2}" "$@"
