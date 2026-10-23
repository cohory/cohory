#!/usr/bin/env bash
# Take every slot of the machine wide test budget (scripts/lib/slots.sh), start the stack, run
# Playwright, always tear down, release the slots, and exit with the Playwright status. Only one
# e2e stack runs at a time, and nothing else heavy runs next to it, because an e2e stack next to
# other test runs pushes an 8 core laptop into swap.
# Extra arguments go to `playwright test`, for example `pnpm e2e --project=desktop`.
set -uo pipefail

source "$(dirname "$0")/e2e-env.sh"
source "$(dirname "$0")/lib/slots.sh"
cd "$E2E_ROOT"

cohory_slots_acquire all "e2e run $COMPOSE_PROJECT_NAME from $E2E_ROOT" "$$"

teardown() {
  if [ "${E2E_KEEP_STACK:-0}" = "1" ]; then
    echo "E2E_KEEP_STACK=1, leaving $COMPOSE_PROJECT_NAME running; stop it with scripts/e2e-down.sh"
    echo "the test slots move to that stack; scripts/e2e-down.sh releases them"
    cohory_slots_handover "$$" 0
    return
  fi
  bash scripts/e2e-down.sh || echo "teardown failed; run scripts/e2e-down.sh" >&2
  cohory_slots_release "$$"
}
trap teardown EXIT
trap 'exit 130' INT TERM

if ! bash scripts/e2e-up.sh; then
  e2e_compose logs --tail 120 >&2 || true
  exit 1
fi

pnpm --filter @cohory/e2e exec playwright test "$@"
status=$?
if [ "$status" -ne 0 ]; then
  mkdir -p "$E2E_ROOT/apps/e2e/test-results"
  e2e_compose logs --no-color > "$E2E_ROOT/apps/e2e/test-results/compose.log" 2>&1 || true
fi
exit "$status"
