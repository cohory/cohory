#!/usr/bin/env bash
# The check a worker runs while iterating: typecheck, lint, and unit tests for the packages
# changed since VERIFY_BASE (default main) and everything that depends on them, Prettier on
# the changed files, then integration tests for the same packages on this checkout's own
# database in the shared test services stack. Changes to root config run everything.
# The coordinator runs scripts/verify.sh (all packages) before landing. Takes one slot of the
# machine wide test budget (scripts/lib/slots.sh) for the whole run.
#
#   pnpm verify:changed
#   VERIFY_BASE=s18/other-branch VERIFY_SKIP_INTEGRATION=1 pnpm verify:changed
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
base="${VERIFY_BASE:-main}"
concurrency="${VERIFY_CONCURRENCY:-2}"

changed="$( (git diff --name-only "$base"...HEAD; git diff --name-only HEAD; git ls-files --others --exclude-standard) | sort -u)"
if [ -z "$changed" ]; then
  echo "nothing changed since $base"
  exit 0
fi

source scripts/lib/slots.sh
cohory_slots_acquire 1 "pnpm verify:changed from $root" "$$"
trap 'cohory_slots_release "$$"' EXIT

filter=(--filter="...[$base]")
scope="packages changed since $base and their dependents"
if grep -qxE 'turbo\.json|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|eslint\.config\.js|\.prettierrc|\.nvmrc|tsconfig[^/]*\.json' <<<"$changed"; then
  echo "root config changed since $base, checking every package"
  filter=()
  scope="all packages"
fi

# Root files that turbo.json declares as inputs of one package's tasks. `...[base]` only sees
# files inside package folders, so a change to these selects the package that reads them.
if [ "${#filter[@]}" -gt 0 ]; then
  if grep -qx 'assets/brand/colors\.json' <<<"$changed"; then
    filter+=(--filter=@cohory/ui)
  fi
  if grep -qx 'docs/operations/mcp\.md' <<<"$changed"; then
    filter+=(--filter=@cohory/mcp)
  fi
fi

bash scripts/turbo-cache-clean.sh

echo "== typecheck, lint, test, check ($scope)"
pnpm --silent turbo run typecheck lint test check ${filter[@]+"${filter[@]}"} --concurrency="$concurrency"

echo "== prettier on changed files"
files=()
while IFS= read -r f; do
  [ -f "$f" ] && files+=("$f")
done <<<"$changed"
if [ "${#files[@]}" -gt 0 ]; then
  pnpm --silent exec prettier --check --ignore-unknown "${files[@]}"
fi

if [ "${VERIFY_SKIP_INTEGRATION:-0}" = "1" ]; then
  echo "VERIFY_SKIP_INTEGRATION=1, skipping integration tests"
  exit 0
fi
echo "== integration ($scope)"
bash scripts/test-integration.sh ${filter[@]+"${filter[@]}"}
