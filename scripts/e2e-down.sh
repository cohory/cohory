#!/usr/bin/env bash
# Stop the end to end stack and delete its volumes, then cap the build cache and release the
# test slots a manual scripts/e2e-up.sh took. Leaves other Compose projects and all other volumes alone.
set -euo pipefail

source "$(dirname "$0")/e2e-env.sh"
source "$(dirname "$0")/lib/slots.sh"
cd "$E2E_ROOT"

e2e_compose down -v --remove-orphans
docker image prune -f >/dev/null
e2e_prune_build_cache
if [ -z "${COHORY_SLOTS_HELD:-}" ]; then
  cohory_slots_release 0
fi
