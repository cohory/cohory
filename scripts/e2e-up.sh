#!/usr/bin/env bash
# Start an isolated Compose stack for the end to end suite, wait for health, then seed.
# The image tag defaults to a hash of the files that go into it (see e2e-env.sh), and an image
# with that tag is reused without a build. Set E2E_SKIP_BUILD=1 to reuse any image that is
# already tagged ${COHORY_IMAGE}:${COHORY_VERSION}.
#
# Run on its own (to keep a stack for spec work), it takes every test slot until
# scripts/e2e-down.sh releases them. Under scripts/e2e-run.sh it uses the slots the run holds.
set -euo pipefail

source "$(dirname "$0")/e2e-env.sh"
source "$(dirname "$0")/lib/slots.sh"
cd "$E2E_ROOT"

cohory_slots_acquire all "e2e-up $COMPOSE_PROJECT_NAME from $E2E_ROOT (manual, released by scripts/e2e-down.sh)" 0

if [ "${E2E_SKIP_BUILD:-0}" = "1" ]; then
  echo "E2E_SKIP_BUILD=1, using $COHORY_IMAGE:$COHORY_VERSION"
elif [ "$E2E_IMAGE_HASHED" = "1" ] && docker image inspect "$COHORY_IMAGE:$COHORY_VERSION" >/dev/null 2>&1; then
  echo "reusing $COHORY_IMAGE:$COHORY_VERSION, built from the same inputs"
else
  DOCKER_BUILDKIT=1 e2e_compose build web
  e2e_remove_old_images
fi

e2e_compose up -d --no-build fake-stripe fake-polar webhook-receiver web worker web-community web-beta

for target in "$E2E_BASE_URL/api/v1/health web" "$E2E_COMMUNITY_URL/api/v1/health web-community" \
  "$E2E_BETA_URL/api/v1/health web-beta" "$E2E_FAKE_STRIPE_URL/__control/health fake-stripe" "$E2E_FAKE_POLAR_URL/__fixtures/health fake-polar" \
  "$E2E_WEBHOOK_RECEIVER_URL/__health webhook-receiver"; do
  set -- $target
  if ! e2e_wait_for "$1" "$2"; then
    e2e_compose logs --tail 80 migrations "$2" >&2 || true
    exit 1
  fi
done

if ! e2e_compose ps --status running --services | grep -qx worker; then
  echo "worker is not running" >&2
  e2e_compose logs --tail 80 worker >&2 || true
  exit 1
fi

e2e_seed
DATABASE_URL="$E2E_DATABASE_URL" DATABASE_ADMIN_URL="$E2E_DATABASE_URL" e2e_seed_paid >/dev/null
e2e_compose_sql() {
  e2e_compose exec -T postgres psql -U cohory -d cohory -v ON_ERROR_STOP=1 -Atq "$@"
}
if ! e2e_wait_for_seed_jobs e2e_compose_sql; then
  e2e_compose logs --tail 40 worker >&2 || true
  exit 1
fi

echo "e2e stack ready at $E2E_BASE_URL, Community Edition at $E2E_COMMUNITY_URL, Cloud beta at $E2E_BETA_URL, fake Stripe at $E2E_FAKE_STRIPE_URL, fake Polar at $E2E_FAKE_POLAR_URL, webhook receiver at $E2E_WEBHOOK_RECEIVER_URL (project $COMPOSE_PROJECT_NAME, postgres $POSTGRES_HOST_PORT)"
