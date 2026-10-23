#!/usr/bin/env bash
# The daily local stack in development mode: `next dev` for the web app and the worker with
# --watch, both on the host, against the Postgres (127.0.0.1:5433) and Mailpit of the Docker
# Compose project `cohory`. Code changes show up without building an image. The production
# image (`docker compose up`) stays for checking releases and for self hosting.
#
#   docker compose stop web worker              # free port 3000, keep postgres running
#   docker compose --profile mail up -d postgres mailpit
#   pnpm db:migrate                             # when the branch adds migrations
#   pnpm stack:dev
#
# Reads the root .env. Mail goes to Mailpit on 127.0.0.1:1025 unless SMTP_HOST is set to
# something other than the Compose host name `mailpit`.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

smtp_host="${SMTP_HOST:-$(sed -n 's/^SMTP_HOST=//p' .env 2>/dev/null | tail -n 1)}"
if [ "${smtp_host:-mailpit}" = "mailpit" ]; then
  export SMTP_HOST=127.0.0.1 SMTP_PORT="${MAILPIT_SMTP_PORT:-1025}"
fi

if curl -s -o /dev/null --max-time 2 http://127.0.0.1:3000/; then
  echo "port 3000 is in use; stop the Compose web and worker first: docker compose stop web worker" >&2
  exit 1
fi

exec pnpm turbo run dev --filter=@cohory/web --filter=@cohory/worker
