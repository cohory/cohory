#!/usr/bin/env bash
# The full check the coordinator runs before landing: every package, every suite except e2e
# (run `pnpm e2e` after it). Turbo replays results whose inputs did not change, so a rerun on
# the same tree is fast and never needs --force. Takes one slot of the machine wide test budget
# (scripts/lib/slots.sh) for the whole run.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
concurrency="${VERIFY_CONCURRENCY:-2}"
source scripts/lib/slots.sh
cohory_slots_acquire 1 "pnpm verify from $root" "$$"
trap 'cohory_slots_release "$$"' EXIT

bash scripts/turbo-cache-clean.sh

echo "== typecheck, lint, test, check, build (all packages)"
pnpm --silent turbo run typecheck lint test check build --concurrency="$concurrency"

echo "== prettier"
pnpm --silent format:check

echo "== integration (all packages)"
bash scripts/test-integration.sh
