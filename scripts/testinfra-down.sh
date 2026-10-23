#!/usr/bin/env bash
# Stop the shared test services stack and delete its volume (test databases only).
# Leaves every other Compose project and volume alone.
set -euo pipefail

source "$(dirname "$0")/testinfra-env.sh"

testinfra_compose down -v --remove-orphans
