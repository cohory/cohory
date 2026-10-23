#!/usr/bin/env bash
# Back up a cohory Compose stack: the database as a pg_dump custom format file and the uploads
# volume as a tar archive, both stamped with the same UTC time, plus a SHA-256 checksum file.
#
#   scripts/backup.sh [backup-dir]
#
# BACKUP_DIR (default ./backups) and BACKUP_KEEP (default 7, the number of backup sets to keep)
# can be set in the environment. Docker Compose settings come from the usual variables, so set
# COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml for the production overlay and
# COMPOSE_PROJECT_NAME when the project is not called cohory (the name Compose resolves, including
# a value in .env, is used). Run it from the repository root.
set -euo pipefail

cd "$(dirname "$0")/.."

dir="${1:-${BACKUP_DIR:-./backups}}"
keep="${BACKUP_KEEP:-7}"
project="$(docker compose config 2>/dev/null | sed -n 's/^name: *//p' | head -n 1)"
project="${project:-${COMPOSE_PROJECT_NAME:-cohory}}"
helper_image="${BACKUP_HELPER_IMAGE:-postgres:17.11}"

case "$keep" in
  '' | *[!0-9]* | 0) echo "BACKUP_KEEP must be a whole number above 0" >&2; exit 2 ;;
esac

mkdir -p "$dir"
dir="$(cd "$dir" && pwd)"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump="$dir/cohory-$stamp.dump"
uploads="$dir/cohory-$stamp-uploads.tar.gz"
volume="${project}_uploads"

if ! docker compose ps --status running --services | grep -qx postgres; then
  echo "postgres is not running in Compose project $project" >&2
  exit 1
fi

echo "dumping the database to $dump"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' >"$dump.partial"
docker compose exec -T postgres pg_restore --list <"$dump.partial" >/dev/null
mv "$dump.partial" "$dump"

if docker volume inspect "$volume" >/dev/null 2>&1; then
  echo "archiving volume $volume to $uploads"
  docker run --rm -v "$volume":/data/uploads:ro -v "$dir":/backup "$helper_image" \
    tar czf "/backup/$(basename "$uploads").partial" -C /data uploads
  mv "$uploads.partial" "$uploads"
else
  echo "volume $volume does not exist, so no uploads archive (expected with STORAGE_DRIVER=s3)"
fi

(
  cd "$dir"
  files=("$(basename "$dump")")
  [ -f "$uploads" ] && files+=("$(basename "$uploads")")
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${files[@]}" >"cohory-$stamp.sha256"
  else
    shasum -a 256 "${files[@]}" >"cohory-$stamp.sha256"
  fi
)

find "$dir" -maxdepth 1 -name 'cohory-*.dump' -print | sort -r | tail -n "+$((keep + 1))" |
  while IFS= read -r old; do
    base="${old%.dump}"
    echo "removing old backup $(basename "$base")"
    rm -f "$old" "$base-uploads.tar.gz" "$base.sha256"
  done

echo "backup $stamp done in $dir"
