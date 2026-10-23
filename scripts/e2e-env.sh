#!/usr/bin/env bash
# Shared settings for the end to end stack. Sourced by the other e2e scripts.
# Every value can be overridden from the environment.

E2E_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-cohorye2e}"
export APP_PORT="${APP_PORT:-3310}"
export E2E_COMMUNITY_PORT="${E2E_COMMUNITY_PORT:-3311}"
export E2E_FAKE_STRIPE_PORT="${E2E_FAKE_STRIPE_PORT:-3312}"
export E2E_FAKE_POLAR_PORT="${E2E_FAKE_POLAR_PORT:-3313}"
export E2E_WEBHOOK_RECEIVER_PORT="${E2E_WEBHOOK_RECEIVER_PORT:-3314}"
export E2E_BETA_PORT="${E2E_BETA_PORT:-3315}"
export POSTGRES_HOST_PORT="${POSTGRES_HOST_PORT:-127.0.0.1:55310}"
export COHORY_IMAGE="${COHORY_IMAGE:-cohory}"
export E2E_KEEP_IMAGES="${E2E_KEEP_IMAGES:-2}"
export BUILD_CACHE_MAX="${BUILD_CACHE_MAX:-3gb}"

# The image tag is a hash of every file that can change the image, so a checkout whose diff
# only touches tests, docs, or scripts reuses the image another run already built.
e2e_image_hash() {
  local files
  files="$(git -C "$E2E_ROOT" ls-files --cached --others --exclude-standard -- \
    Dockerfile .dockerignore .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json \
    apps/web apps/worker apps/e2e/package.json packages \
    ':(exclude,glob)**/*.test.ts' ':(exclude,glob)**/*.test.tsx' 2>/dev/null | sort -u)" || return 1
  [ -n "$files" ] || return 1
  files="$(cd "$E2E_ROOT" && while IFS= read -r f; do [ -f "$f" ] && printf '%s\n' "$f"; done <<<"$files")"
  (cd "$E2E_ROOT" && paste <(printf '%s\n' "$files") <(printf '%s\n' "$files" | git hash-object --stdin-paths)) |
    shasum -a 256 | cut -c1-12
}

if [ -z "${COHORY_VERSION:-}" ]; then
  if image_hash="$(e2e_image_hash)"; then
    export COHORY_VERSION="e2e-${image_hash}"
    export E2E_IMAGE_HASHED=1
  else
    export COHORY_VERSION="e2e"
  fi
  unset image_hash
fi
export E2E_IMAGE_HASHED="${E2E_IMAGE_HASHED:-0}"
export E2E_BASE_URL="${E2E_BASE_URL:-http://localhost:${APP_PORT}}"
export E2E_COMMUNITY_URL="${E2E_COMMUNITY_URL:-http://localhost:${E2E_COMMUNITY_PORT}}"
export E2E_BETA_URL="${E2E_BETA_URL:-http://localhost:${E2E_BETA_PORT}}"
# The Cloud beta web service lets only this address create communities (ADR 0050).
export E2E_BETA_OPERATOR_EMAIL="${E2E_BETA_OPERATOR_EMAIL:-beta-operator@e2e.example.test}"
export E2E_FAKE_STRIPE_URL="${E2E_FAKE_STRIPE_URL:-http://127.0.0.1:${E2E_FAKE_STRIPE_PORT}}"
export E2E_FAKE_POLAR_URL="${E2E_FAKE_POLAR_URL:-http://127.0.0.1:${E2E_FAKE_POLAR_PORT}}"
export E2E_WEBHOOK_RECEIVER_URL="${E2E_WEBHOOK_RECEIVER_URL:-http://127.0.0.1:${E2E_WEBHOOK_RECEIVER_PORT}}"
export E2E_STRIPE_WEBHOOK_SECRET="${E2E_STRIPE_WEBHOOK_SECRET:-whsec_e2e_only_not_a_real_secret}"
export E2E_DATABASE_URL="${E2E_DATABASE_URL:-postgres://cohory:cohory@${POSTGRES_HOST_PORT}/cohory}"

e2e_compose() {
  docker compose \
    --project-name "$COMPOSE_PROJECT_NAME" \
    --project-directory "$E2E_ROOT" \
    -f "$E2E_ROOT/docker-compose.yml" \
    -f "$E2E_ROOT/apps/e2e/compose.e2e.yml" \
    "$@"
}

# Keeps the build cache under BUILD_CACHE_MAX instead of dropping it, so the next build still
# finds the pnpm store, the Next.js cache, and the turbo cache. Never touches volumes.
e2e_prune_build_cache() {
  docker builder prune -f --max-used-space "$BUILD_CACHE_MAX" >/dev/null 2>&1 ||
    echo "could not prune the build cache to $BUILD_CACHE_MAX" >&2
}

# Removes hashed e2e images beyond the newest E2E_KEEP_IMAGES. Images a container still uses
# are refused by Docker and kept.
e2e_remove_old_images() {
  docker image ls "$COHORY_IMAGE" --format '{{.CreatedAt}}\t{{.Tag}}' |
    awk -F '\t' '$2 ~ /^e2e-[0-9a-f]+$/' | sort -r | cut -f2 |
    tail -n "+$((E2E_KEEP_IMAGES + 1))" | while IFS= read -r tag; do
      [ "$tag" = "$COHORY_VERSION" ] && continue
      docker image rm "$COHORY_IMAGE:$tag" >/dev/null 2>&1 || true
    done
}

e2e_wait_for() {
  local url="$1" label="$2" deadline=$((SECONDS + 180))
  until curl -fsS "$url" >/dev/null 2>&1; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "$label did not answer $url within 180 seconds" >&2
      return 1
    fi
    sleep 1
  done
}

# Puts the seeded Cohory Pro plan on sale through the fake Stripe, on a connected account the
# fake creates, so the paid About page shows its price. Needs DATABASE_URL and
# DATABASE_ADMIN_URL in the environment.
e2e_seed_paid() {
  local account
  account="$(curl -fsS -X POST -H 'content-type: application/json' \
    -d '{"identity":{"country":"US"}}' "$E2E_FAKE_STRIPE_URL/v2/core/accounts" |
    node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>console.log(JSON.parse(s).id))')" ||
    return 1
  PAID_SEED_ACCOUNT_ID="$account" STRIPE_SECRET_KEY=sk_test_e2e_fake_key \
    STRIPE_API_BASE_URL="$E2E_FAKE_STRIPE_URL" COHORY_EDITION=cloud PLATFORM_FEE_BPS=200 \
    pnpm --silent db:seed:paid
}

# The seed runs on the host, so it writes the seeded images to a temporary folder that is then
# copied into the uploads volume the web container reads.
e2e_seed() {
  local uploads
  uploads="$(mktemp -d)"
  DATABASE_URL="$E2E_DATABASE_URL" DATABASE_ADMIN_URL="$E2E_DATABASE_URL" \
    STORAGE_DRIVER=local STORAGE_LOCAL_PATH="$uploads" pnpm --silent db:seed
  if [ -n "$(ls -A "$uploads")" ]; then
    e2e_compose cp "$uploads/." web:/data/uploads/
    e2e_compose exec -T -u 0 web chown -R cohory:cohory /data/uploads
  fi
  rm -rf "$uploads"
}

# The seed writes outbox rows like real activity does, and the worker turns them into jobs
# (points, notifications, the creators invitation) that it takes one at a time per queue. A
# spec that starts while that backlog drains waits behind it, so the stack is ready only once
# the outbox is relayed and no queue has a due job left. Scheduled queues are left out because
# their next run is always waiting. $1 names a function that runs psql on the e2e database.
e2e_wait_for_seed_jobs() {
  local sql="$1" timeout="${E2E_SEED_DRAIN_TIMEOUT:-120}" pending
  local deadline=$((SECONDS + timeout))
  local due="state in ('created', 'retry', 'active') and start_after <= now()
    and name not in (select name from pgboss.schedule)"
  "$sql" -c "insert into pgboss.job (name, data) values ('outbox.relay', '{}')" >/dev/null || return 1
  while :; do
    pending="$("$sql" -c "select (select count(*) from outbox where published_at is null)
      + (select count(*) from pgboss.job where $due)")" || return 1
    [ "$pending" = "0" ] && return 0
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "the seeded outbox rows and their jobs did not finish within $timeout seconds; still waiting:" >&2
      "$sql" -c "select 'outbox ' || topic || ': ' || count(*) from outbox
          where published_at is null group by topic
        union all select 'job ' || name || ' (' || state || '): ' || count(*) from pgboss.job
          where $due group by name, state" >&2
      return 1
    fi
    sleep 1
  done
}
