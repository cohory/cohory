#!/usr/bin/env bash
# Run the end to end suite on the host instead of in the Docker image: a fresh database on the
# shared test services stack (127.0.0.1:55432), the fake Stripe, fake Polar, and webhook receiver
# as plain Node processes, the turbo cached web build served by `next start` twice (Cloud on
# 3310, Community Edition on 3311, the Cloud beta with restricted community creation on 3315), and the worker from its built bundle. Faster to start than
# `pnpm e2e` because nothing is built twice, and lighter because nothing runs in the Docker VM.
# `pnpm e2e` stays the gate before landing and the release check.
#
#   pnpm e2e:host tests/step10-joining.spec.ts
#   E2E_MOBILE=1 pnpm e2e:host journey-03
#
# Takes every slot of the machine wide test budget (scripts/lib/slots.sh), like `pnpm e2e`, so it
# never runs next to another e2e run on the same ports. Extra arguments go to `playwright test`.
# Playwright runs with E2E_WORKERS (default 2) workers and only the desktop project unless
# E2E_MOBILE=1 or a --project argument is given.
set -uo pipefail

source "$(dirname "$0")/e2e-env.sh"
source "$(dirname "$0")/testinfra-env.sh"
source "$(dirname "$0")/lib/slots.sh"
cd "$E2E_ROOT"

cohory_slots_acquire all "e2e:host from $E2E_ROOT" "$$"

db="$(testinfra_db_name)_e2e"
admin_url="$(testinfra_url "$db")"
app_url="postgres://cohory_app:cohory_app@127.0.0.1:${TESTINFRA_PG_PORT}/$db"
work="$(mktemp -d)"
logs="$work/logs"
uploads="$work/uploads"
mkdir -p "$logs" "$uploads"
pids=()

teardown() {
  local pid
  for pid in "${pids[@]+"${pids[@]}"}"; do
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
  done
  wait 2>/dev/null
  if [ "${status:-1}" -ne 0 ]; then
    mkdir -p "$E2E_ROOT/apps/e2e/test-results/host-logs"
    cp "$logs"/*.log "$E2E_ROOT/apps/e2e/test-results/host-logs/" 2>/dev/null
    echo "service logs are in apps/e2e/test-results/host-logs" >&2
  fi
  testinfra_drop_db "$db" 2>/dev/null || echo "could not drop $db; drop it with scripts/testinfra-down.sh" >&2
  rm -rf "$work"
  cohory_slots_release "$$"
}
trap teardown EXIT
trap 'exit 130' INT TERM

for port in "$APP_PORT" "$E2E_COMMUNITY_PORT" "$E2E_BETA_PORT" "$E2E_FAKE_STRIPE_PORT" "$E2E_FAKE_POLAR_PORT" "$E2E_WEBHOOK_RECEIVER_PORT"; do
  curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$port/"
  if [ "$?" -ne 7 ]; then
    echo "port $port is already in use; stop whatever listens there first" >&2
    exit 1
  fi
done

echo "== build (replayed from the turbo cache when nothing changed)"
pnpm --silent turbo run build --filter=@cohory/web --filter=@cohory/worker \
  --concurrency="${VERIFY_CONCURRENCY:-2}" --output-logs=errors-only || exit 1

echo "== database $db on 127.0.0.1:$TESTINFRA_PG_PORT"
bash scripts/testinfra-up.sh >/dev/null || exit 1
{ testinfra_drop_db "$db" 2>/dev/null && testinfra_create_db "$db"; } || exit 1
DATABASE_URL="$app_url" DATABASE_ADMIN_URL="$admin_url" pnpm --silent db:migrate >"$logs/migrations.log" 2>&1 || {
  cat "$logs/migrations.log" >&2
  exit 1
}

# The same values as x-e2e-env in apps/e2e/compose.e2e.yml, with host addresses. Like the
# Compose stack, the app also reads the root .env for anything not set here.
export BETTER_AUTH_SECRET=e2e-only-secret-not-for-production-use-0123456789
export DATABASE_URL="$app_url"
export COHORY_EDITION=cloud PLATFORM_FEE_BPS=200
export STRIPE_SECRET_KEY=sk_test_e2e_fake_key STRIPE_WEBHOOK_SECRET="$E2E_STRIPE_WEBHOOK_SECRET"
export STRIPE_API_BASE_URL="$E2E_FAKE_STRIPE_URL" POLAR_API_BASE_URL="$E2E_FAKE_POLAR_URL"
export PAYMENTS_ENCRYPTION_KEY=ZTJlLW9ubHktcGF5bWVudHMta2V5LTMyLWJ5dGVzISE=
export RATE_LIMIT_DISABLED=true EGRESS_ALLOW_PRIVATE_HOSTS=127.0.0.1
export EMAIL_DRIVER=log STORAGE_DRIVER=local STORAGE_LOCAL_PATH="$uploads"
export CONTACT_EMAIL=contact@e2e.example.test CREATORS_COMMUNITY_SLUG=e2e-creators
export WORKER_HEARTBEAT_FILE="$work/worker.heartbeat"

set -m
start() {
  local name="$1"
  shift
  "$@" >"$logs/$name.log" 2>&1 &
  pids+=("$!")
}
next_start() {
  local port="$1" url="$2"
  shift 2
  (cd apps/web && APP_URL="$url" BETTER_AUTH_URL="$url" NEXT_PUBLIC_APP_URL="$url" PORT="$port" "$@" \
    node node_modules/next/dist/bin/next start --port "$port")
}

echo "== services"
start fake-stripe env FAKE_STRIPE_PORT="$E2E_FAKE_STRIPE_PORT" \
  node --experimental-strip-types --no-warnings apps/e2e/support/fake-stripe/server.mts
start fake-polar env FAKE_POLAR_PORT="$E2E_FAKE_POLAR_PORT" FAKE_POLAR_PUBLIC_URL="$E2E_FAKE_POLAR_URL" \
  node --experimental-strip-types --no-warnings packages/payments/support/fake-polar/server.mts
start webhook-receiver env WEBHOOK_RECEIVER_PORT="$E2E_WEBHOOK_RECEIVER_PORT" \
  node --experimental-strip-types --no-warnings apps/e2e/support/webhook-receiver/server.mts
start web next_start "$APP_PORT" "$E2E_BASE_URL" env COHORY_ENABLE_POLAR=true
start web-community next_start "$E2E_COMMUNITY_PORT" "$E2E_COMMUNITY_URL" env COHORY_EDITION=community CREATORS_COMMUNITY_SLUG=
start worker env NODE_ENV=production APP_URL="$E2E_BASE_URL" BETTER_AUTH_URL="$E2E_BASE_URL" NEXT_PUBLIC_APP_URL="$E2E_BASE_URL" \
  node --env-file-if-exists="$E2E_ROOT/.env" apps/worker/dist/index.js
start web-beta next_start "$E2E_BETA_PORT" "$E2E_BETA_URL" env COMMUNITY_CREATION=operators \
  OPERATOR_EMAILS="$E2E_BETA_OPERATOR_EMAIL"
set +m

for target in "$E2E_BASE_URL/api/v1/health web" "$E2E_COMMUNITY_URL/api/v1/health web-community" \
  "$E2E_BETA_URL/api/v1/health web-beta" "$E2E_FAKE_STRIPE_URL/__control/health fake-stripe" \
  "$E2E_FAKE_POLAR_URL/__fixtures/health fake-polar" "$E2E_WEBHOOK_RECEIVER_URL/__health webhook-receiver"; do
  read -r url service <<<"$target"
  if ! e2e_wait_for "$url" "$service"; then
    tail -n 80 "$logs/$service.log" >&2
    exit 1
  fi
done
if ! kill -0 "${pids[5]}" 2>/dev/null; then
  echo "worker is not running" >&2
  tail -n 80 "$logs/worker.log" >&2
  exit 1
fi

echo "== seed"
{
  DATABASE_URL="$admin_url" DATABASE_ADMIN_URL="$admin_url" pnpm --silent db:seed &&
    DATABASE_URL="$admin_url" DATABASE_ADMIN_URL="$admin_url" e2e_seed_paid
} >"$logs/seed.log" 2>&1 || {
  cat "$logs/seed.log" >&2
  exit 1
}
e2e_host_sql() {
  testinfra_compose exec -T postgres psql -U cohory -d "$db" -v ON_ERROR_STOP=1 -Atq "$@"
}
echo "== seeded jobs"
e2e_wait_for_seed_jobs e2e_host_sql || {
  tail -n 40 "$logs/worker.log" >&2
  exit 1
}

project=(--project=desktop)
if [ "${E2E_MOBILE:-0}" = "1" ] || printf '%s\n' "$@" | grep -q '^--project'; then
  project=()
fi

echo "e2e host stack ready at $E2E_BASE_URL, Community Edition at $E2E_COMMUNITY_URL, Cloud beta at $E2E_BETA_URL, database $db, after ${SECONDS}s"
COMPOSE_PROJECT_NAME="$TESTINFRA_PROJECT" E2E_POSTGRES_DB="$db" E2E_LOG_DIR="$logs" \
  E2E_WEBHOOK_RECEIVER_APP_URL="$E2E_WEBHOOK_RECEIVER_URL" E2E_POLAR_APP_URL="$E2E_BASE_URL" E2E_WORKERS="${E2E_WORKERS:-2}" \
  pnpm --filter @cohory/e2e exec playwright test ${project[@]+"${project[@]}"} "$@"
status=$?
exit "$status"
