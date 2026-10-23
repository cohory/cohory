#!/usr/bin/env bash
# Delete turbo cache entries older than TURBO_CACHE_MAX_AGE_DAYS (default 3), then the oldest
# entries until the cache fits TURBO_CACHE_MAX_MB (default 3072; web build outputs are 300 to
# 700 MB each). Worktrees share the cache of the main checkout, so this cleans that folder and
# any local one. Run by the verify scripts; safe to run any time.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
days="${TURBO_CACHE_MAX_AGE_DAYS:-3}"
max_kb=$((${TURBO_CACHE_MAX_MB:-3072} * 1024))
common="$(git -C "$root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"

mtime_size_path() {
  if stat -f '%m %z %N' "$0" >/dev/null 2>&1; then
    find "$1" -type f -exec stat -f '%m %z %N' {} +
  else
    find "$1" -type f -printf '%T@ %s %p\n'
  fi
}

for dir in "$root/.turbo/cache" ${common:+"$(dirname "$common")/.turbo/cache"}; do
  [ -d "$dir" ] || continue
  dir="$(cd "$dir" && pwd -P)"
  case " ${seen:-} " in *" $dir "*) continue ;; esac
  seen="${seen:-} $dir"
  before="$(du -sk "$dir" | cut -f1)"
  find "$dir" -type f -mtime "+$days" -delete
  used="$(du -sk "$dir" | cut -f1)"
  if [ "$used" -gt "$max_kb" ]; then
    mtime_size_path "$dir" | sort -n | while read -r _ size path; do
      [ "$used" -le "$max_kb" ] && break
      rm -f "$path"
      used=$((used - size / 1024))
    done || true
  fi
  after="$(du -sk "$dir" | cut -f1)"
  echo "turbo cache $dir: $((before / 1024)) MB -> $((after / 1024)) MB"
done
