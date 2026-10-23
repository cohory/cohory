#!/usr/bin/env bash
# Reset the local development database and seed it from scratch: drop the schemas of the
# database in DATABASE_URL (DATABASE_ADMIN_URL when set), wipe the local uploads folder, run the
# migrations, the dev seed, and the paid seed. Reads the root .env like the other db scripts.
#
#   pnpm db:reset:local --yes
#
# Refuses when NODE_ENV is production, when the database is not on localhost or 127.0.0.1, and
# without --yes. The paid seed needs a Stripe sandbox key; without one Cohory Pro stays unpriced.
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm --silent --filter @cohory/db db:reset:local "$@"
pnpm --silent db:migrate
pnpm --silent db:seed
if ! pnpm --silent db:seed:paid; then
  echo "The paid seed did not run, so Cohory Pro has no price. See docs/architecture/payments.md." >&2
fi
echo "Local database reset and seeded."
