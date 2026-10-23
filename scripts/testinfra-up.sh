#!/usr/bin/env bash
# Start the shared test services stack (PostgreSQL on 127.0.0.1:55432) if it is not running,
# and wait until it is healthy. Safe to run any number of times.
# Prints the database URL this checkout uses.
set -euo pipefail

source "$(dirname "$0")/testinfra-env.sh"

if ! out="$(testinfra_compose up -d --wait --quiet-pull postgres 2>&1)"; then
  echo "$out" >&2
  exit 1
fi
echo "testinfra up (project $TESTINFRA_PROJECT); this checkout uses $(testinfra_url "$(testinfra_db_name)")"
