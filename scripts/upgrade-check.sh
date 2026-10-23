#!/usr/bin/env bash
# Prove the self hosting upgrade path: a database created by an older release is migrated
# to the current schema, the app starts on it, and the old data is still readable.
#
#   UPGRADE_FROM=0004 scripts/upgrade-check.sh
#
# Uses its own Compose project (cohoryupgrade), host port 3311, and Postgres on
# 127.0.0.1:55311. Reuses the e2e image for the current inputs when it exists, otherwise builds
# it. Holds every test slot (scripts/lib/slots.sh) while its stack runs.
set -euo pipefail

export COMPOSE_PROJECT_NAME="${UPGRADE_PROJECT:-cohoryupgrade}"
export APP_PORT="${UPGRADE_APP_PORT:-3311}"
export POSTGRES_HOST_PORT="${UPGRADE_POSTGRES_HOST_PORT:-127.0.0.1:55311}"
export E2E_BASE_URL="http://localhost:${APP_PORT}"
source "$(dirname "$0")/e2e-env.sh"
source "$(dirname "$0")/lib/slots.sh"
cd "$E2E_ROOT"

from="${UPGRADE_FROM:-0004}"
journal="packages/db/migrations/meta/_journal.json"
work="$(mktemp -d)"
slug="upgrade-garden"
email="upgrade-owner@example.test"
secret="upgrade-check-password"
post_text="Written before the upgrade"

cleanup() {
  e2e_compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work"
  cohory_slots_release "$$"
}

cohory_slots_acquire all "upgrade check $COMPOSE_PROJECT_NAME from $E2E_ROOT" "$$"
trap cleanup EXIT
trap 'exit 130' INT TERM

step() { printf '\n== %s\n' "$*"; }
fail() {
  echo "FAIL: $*" >&2
  e2e_compose logs --tail 60 migrations web >&2 || true
  exit 1
}
psql_admin() { e2e_compose exec -T postgres psql -U cohory -d cohory -v ON_ERROR_STOP=1 -Atq "$@"; }

if ! docker image inspect "${COHORY_IMAGE}:${COHORY_VERSION}" >/dev/null 2>&1; then
  step "build ${COHORY_IMAGE}:${COHORY_VERSION}"
  e2e_compose build web
fi

step "start an empty PostgreSQL"
e2e_compose up -d --wait postgres

step "apply migrations up to ${from} only"
mkdir -p "$work/meta"
node --input-type=module -e '
  import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
  const [journalPath, target, out] = process.argv.slice(1);
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  const limit = Number(target);
  if (!journal.entries.some((e) => e.idx === limit)) throw new Error(`no migration ${target}`);
  journal.entries = journal.entries.filter((e) => e.idx <= limit);
  writeFileSync(`${out}/meta/_journal.json`, JSON.stringify(journal));
  for (const e of journal.entries) copyFileSync(`packages/db/migrations/${e.tag}.sql`, `${out}/${e.tag}.sql`);
  console.log(journal.entries.map((e) => e.tag).join("\n"));
' "$journal" "$from" "$work"
(
  cd packages/db
  MIGRATIONS_DIR="$work" DATABASE_URL="$E2E_DATABASE_URL" node --input-type=module -e '
    import { drizzle } from "drizzle-orm/node-postgres";
    import { migrate } from "drizzle-orm/node-postgres/migrator";
    import pg from "pg";
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await migrate(drizzle(pool), { migrationsFolder: process.env.MIGRATIONS_DIR });
    await pool.end();
  '
)
applied="$(psql_admin -c 'select count(*) from drizzle.__drizzle_migrations')"
[ "$applied" = "$((10#$from + 1))" ] || fail "expected $((10#$from + 1)) migrations, found $applied"
echo "applied $applied migrations"

step "insert data the way the older release stored it"
hash="$(cd packages/db && node --input-type=module -e '
  import { hashPassword } from "better-auth/crypto";
  console.log(await hashPassword(process.argv[1]));
' "$secret")"
psql_admin <<SQL
with u as (
  insert into users (id, name, email, email_verified) values (gen_random_uuid(), 'Upgrade Owner', '$email', true)
  returning id
), a as (
  insert into accounts (id, user_id, account_id, provider_id, password)
  select gen_random_uuid(), id, id::text, 'credential', '$hash' from u
), c as (
  insert into communities (id, slug, name, privacy, appearance, level_names)
  values (gen_random_uuid(), '$slug', 'Upgrade garden', 'public', '{}'::jsonb,
    '["Level 1","Level 2","Level 3","Level 4","Level 5","Level 6","Level 7","Level 8","Level 9"]'::jsonb)
  returning id
), m as (
  insert into memberships (id, community_id, user_id, role, status, joined_at)
  select gen_random_uuid(), c.id, u.id, 'owner', 'active', now() from c, u
)
insert into posts (id, community_id, author_id, body, body_html, body_text, excerpt)
select gen_random_uuid(), c.id, u.id,
  '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"$post_text"}]}]}'::jsonb,
  '<p>$post_text</p>', '$post_text', '$post_text'
from c, u;
SQL

base_index=$((10#$from))
if [ "$base_index" -ge 10 ]; then
  step "add a Stripe connection the way the older release stored it"
  psql_admin <<SQL
insert into payment_connections (id, community_id, provider, external_account_id, status)
select gen_random_uuid(), id, 'stripe_connect', 'acct_upgradecheck', 'active' from communities where slug = '$slug';
SQL
fi

step "upgrade: run the current migrations service, web, and worker"
e2e_compose up -d --no-build web worker
deadline=$((SECONDS + 180))
until curl -fsS "$E2E_BASE_URL/api/v1/health" >/dev/null 2>&1; do
  [ "$SECONDS" -lt "$deadline" ] || fail "web did not become healthy"
  sleep 1
done
exit_code="$(docker inspect --format '{{.State.ExitCode}}' "$(e2e_compose ps -a -q migrations)")"
[ "$exit_code" = "0" ] || fail "migrations exited with $exit_code"
total="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).entries.length)' "$journal")"
applied="$(psql_admin -c 'select count(*) from drizzle.__drizzle_migrations')"
[ "$applied" = "$total" ] || fail "expected $total migrations after the upgrade, found $applied"
echo "applied $applied of $total migrations"

step "seed on top of the upgraded database"
e2e_seed >/dev/null

step "check the old data through the app"
health="$(curl -fsS "$E2E_BASE_URL/api/v1/health")"
echo "health: $health"
echo "$health" | grep -q '"status":"ok"' || fail "health is not ok"
curl -fsS "$E2E_BASE_URL/api/v1/communities/$slug" | grep -q '"name":"Upgrade garden"' ||
  fail "the old community is not readable through the API"
jar="$work/cookies.txt"
status="$(curl -sS -o /dev/null -w '%{http_code}' -c "$jar" -H "origin: $E2E_BASE_URL" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$email\",\"password\":\"$secret\"}" "$E2E_BASE_URL/api/auth/sign-in/email")"
[ "$status" = "200" ] || fail "the old account cannot sign in (HTTP $status)"
curl -fsS -b "$jar" "$E2E_BASE_URL/api/v1/communities/$slug/posts" | grep -q "$post_text" ||
  fail "the old post is not listed for its author"
rows="$(e2e_compose exec -T -e PGPASSWORD=cohory_app postgres psql -h 127.0.0.1 -U cohory_app -d cohory -Atq <<SQL
begin;
select set_config('app.community_id', (select id::text from communities where slug = '$slug'), true);
select count(*) from posts where body_text = '$post_text';
commit;
SQL
)"
echo "$rows" | grep -qx 1 || fail "the application role cannot read the old post under row level security ($rows)"

if [ "$base_index" -ge 10 ] && [ "$base_index" -lt 29 ]; then
  accepted="$(psql_admin -c "select count(*) from payment_connections c join users u on u.id = c.accepted_owner_id where c.external_account_id = 'acct_upgradecheck' and u.email = '$email'")"
  [ "$accepted" = "1" ] || fail "migration 0029 did not record the owner who accepted the old Stripe connection"
  echo "the old Stripe connection records its owner as the one who accepted it"
fi

echo
echo "PASS: upgraded from migration $from to $total migrations; old account, community, and post are intact"
