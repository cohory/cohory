#!/usr/bin/env bash
# Clean cohory development Docker leftovers. Safe to run anytime.
# Touches only: the cohory compose project, dangling images, the whole build
# cache (cheap to rebuild), and volumes no container references.
set -euo pipefail

cd "$(dirname "$0")/.."

docker compose down -v --remove-orphans 2>/dev/null || true
docker ps -aq --filter "name=cohory-" --filter "status=exited" | xargs -r docker rm -fv >/dev/null
docker image prune -f >/dev/null
docker builder prune -af >/dev/null
docker volume ls -q --filter dangling=true | xargs -r docker volume rm >/dev/null

docker system df
