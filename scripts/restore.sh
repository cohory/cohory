#!/usr/bin/env bash
# Restore a backup made by scripts/backup.sh into a Compose stack, then start the stack.
#
#   scripts/restore.sh [--force] backups/cohory-<stamp>.dump [backups/cohory-<stamp>-uploads.tar.gz]
#
# The database must be empty (a fresh stack) unless --force is given. With --force the existing
# database is dropped and created again and the uploads volume is emptied before the archive is
# unpacked. The uploads archive defaults to the one next to the dump with the same stamp.
# Docker Compose settings come from COMPOSE_FILE and COMPOSE_PROJECT_NAME as for backup.sh.
set -euo pipefail

cd "$(dirname "$0")/.."

force=0
args=()
for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    -h | --help) sed -n '2,9p' "$0"; exit 0 ;;
    *) args+=("$arg") ;;
  esac
done
[ "${#args[@]}" -ge 1 ] || { echo "usage: scripts/restore.sh [--force] <dump> [uploads.tar.gz]" >&2; exit 2; }

dump="${args[0]}"
uploads="${args[1]:-${dump%.dump}-uploads.tar.gz}"
project="$(docker compose config 2>/dev/null | sed -n 's/^name: *//p' | head -n 1)"
project="${project:-${COMPOSE_PROJECT_NAME:-cohory}}"
helper_image="${BACKUP_HELPER_IMAGE:-postgres:17.11}"
volume="${project}_uploads"
env_value() { if [ -f .env ]; then sed -n "s/^$1=//p" .env | tail -n 1; fi; }
app_user="${POSTGRES_APP_USER:-$(env_value POSTGRES_APP_USER)}"
app_user="${app_user:-cohory_app}"

[ -f "$dump" ] || { echo "no such dump: $dump" >&2; exit 2; }
case "$app_user" in *[!a-z0-9_]* | [0-9]*) echo "invalid POSTGRES_APP_USER: $app_user" >&2; exit 2 ;; esac

psql_admin() { docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -Atq -U "$POSTGRES_USER" -d "$1"' sh "$1"; }
target_db() { docker compose exec -T postgres sh -c 'printf %s "$POSTGRES_DB"'; }

echo "starting postgres in Compose project $project"
docker compose up -d postgres
deadline=$((SECONDS + 120))
until docker compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; do
  [ "$SECONDS" -lt "$deadline" ] || { echo "postgres did not become ready" >&2; exit 1; }
  sleep 1
done
db="$(target_db)"

tables="$(echo "select count(*) from pg_tables where schemaname not in ('pg_catalog', 'information_schema');" | psql_admin "$db")"
if [ "$tables" != "0" ]; then
  if [ "$force" != "1" ]; then
    echo "database $db already has $tables tables. Refusing to restore over it; pass --force to replace it." >&2
    exit 3
  fi
  echo "--force: stopping web and worker and recreating database $db"
  docker compose stop web worker >/dev/null 2>&1 || true
  printf 'drop database %s with (force);\ncreate database %s;\n' "\"$db\"" "\"$db\"" | psql_admin postgres
fi

echo "making sure the application role $app_user exists before the restore"
psql_admin "$db" <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = '$app_user') then
    create role "$app_user" nologin nosuperuser nobypassrls;
  end if;
end \$\$;
SQL

echo "restoring $dump into $db"
docker compose exec -T postgres sh -c 'pg_restore --exit-on-error -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <"$dump"

if [ -f "$uploads" ]; then
  echo "restoring uploads from $uploads into volume $volume"
  docker compose stop web worker >/dev/null 2>&1 || true
  if ! docker volume inspect "$volume" >/dev/null 2>&1; then
    docker volume create --label com.docker.compose.project="$project" \
      --label com.docker.compose.volume=uploads "$volume" >/dev/null
  fi
  archive_dir="$(cd "$(dirname "$uploads")" && pwd)"
  docker run --rm -v "$volume":/data/uploads -v "$archive_dir":/backup:ro "$helper_image" sh -c \
    'find /data/uploads -mindepth 1 -delete && tar xzf "/backup/$1" -C /data && chown -R 1001:1001 /data/uploads' \
    sh "$(basename "$uploads")"
else
  echo "no uploads archive at $uploads, so the uploads volume is left as it is"
fi

echo "starting migrations, web, and worker"
docker compose up -d --no-build
echo "restore done. Check: docker compose ps, then the health endpoint."
