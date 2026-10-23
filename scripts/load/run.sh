#!/usr/bin/env bash
# Seed the reference load (REQ-NFR-PERF-005: 5,000 members) into a running Compose stack, then
# run cohory.js with the pinned k6 image on the stack's network.
#
#   COMPOSE_PROJECT_NAME=cohoryload APP_URL=http://127.0.0.1:3940 scripts/load/run.sh
#
# The stack must already run with the dev seed (pnpm db:seed) and with RATE_LIMIT_DISABLED=true,
# or the sign in limit refuses the virtual users. Never point this at a production server: it
# writes 5,000 users and thousands of posts. Settings: MEMBERS (5000), POSTS (2000), VUS (100),
# DURATION (3m), THINK_SECONDS (1), OUT_DIR (scripts/load/out).
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

project="${COMPOSE_PROJECT_NAME:-cohory}"
members="${MEMBERS:-5000}"
posts="${POSTS:-2000}"
k6_image="grafana/k6:1.3.0"
out_dir="${OUT_DIR:-$root/scripts/load/out}"
secret="${LOAD_PASSWORD:-cohory-load-password}"
origin="${APP_URL:?Set APP_URL to the public URL the stack was started with}"
target="${LOAD_TARGET:-http://web:3000}"

mkdir -p "$out_dir"

psql_admin() {
  docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -Atq -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

hash="$(cd packages/db && node --input-type=module -e '
  import { hashPassword } from "better-auth/crypto";
  console.log(await hashPassword(process.argv[1]));
' "$secret")"

echo "seeding $members members and $posts posts into cohory"
psql_admin <<SQL
with community as (select id from communities where slug = 'cohory-creators'),
new_users as (
  insert into users (id, name, email, email_verified, username)
  select gen_random_uuid(), 'Load member ' || n, 'load-' || lpad(n::text, 4, '0') || '@example.test',
    true, 'load-' || lpad(n::text, 4, '0')
  from generate_series(1, $members) as n
  on conflict do nothing
  returning id
),
new_accounts as (
  insert into accounts (id, user_id, account_id, provider_id, password)
  select gen_random_uuid(), id, id::text, 'credential', '$hash' from new_users
)
insert into memberships (id, community_id, user_id, role, status, joined_at)
select gen_random_uuid(), community.id, new_users.id, 'member', 'active', now() - random() * interval '90 days'
from community, new_users;

with community as (select id from communities where slug = 'cohory-creators'),
authors as (
  select array_agg(id) as ids from users where email like 'load-%@example.test'
)
insert into posts (id, community_id, author_id, body, body_html, body_text, excerpt, created_at, updated_at)
select gen_random_uuid(), community.id, authors.ids[1 + (n % array_length(authors.ids, 1))],
  jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object('type', 'paragraph',
    'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'Seeded load post ' || n))))),
  '<p>Seeded load post ' || n || '</p>', 'Seeded load post ' || n, 'Seeded load post ' || n,
  now() - n * interval '1 minute', now() - n * interval '1 minute'
from community, authors, generate_series(1, $posts) as n;

analyze;
select 'members', count(*) from memberships m join communities c on c.id = m.community_id
  where c.slug = 'cohory-creators' and m.status = 'active';
select 'posts', count(*) from posts p join communities c on c.id = p.community_id where c.slug = 'cohory-creators';
SQL

echo "running k6 ($k6_image) against $target with ${VUS:-100} virtual users"
docker run --rm --network "${project}_default" \
  -v "$root/scripts/load:/scripts:ro" -v "$out_dir:/out" \
  -e BASE_URL="$target" -e ORIGIN="$origin" -e LOAD_PASSWORD="$secret" \
  -e VUS="${VUS:-100}" -e DURATION="${DURATION:-3m}" -e THINK_SECONDS="${THINK_SECONDS:-1}" \
  -e SUMMARY_PATH=/out/summary.json \
  "$k6_image" run --quiet /scripts/cohory.js | tee "$out_dir/result.json"
