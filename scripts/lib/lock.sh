#!/usr/bin/env bash
# A machine wide lock built on mkdir, which is atomic. Sourced by scripts that must not run
# twice at the same time on one machine (integration runs on testinfra), and by slots.sh for its
# stale checks.
#
#   cohory_lock_acquire /tmp/cohory-integration.lock "integration run" "$$"
#   cohory_lock_release /tmp/cohory-integration.lock "$$"
#
# The holder writes its pid into the lock. A lock whose pid is no longer running is stale and
# is taken over. A lock without a live pid (pid 0, or one made by hand with plain mkdir) is
# stale after COHORY_LOCK_STALE_MINUTES (default 240).

cohory_lock_holder_pid() {
  local pid=""
  if [ -f "$1/pid" ]; then
    pid="$(head -n 1 "$1/pid" 2>/dev/null || true)"
  fi
  case "$pid" in
    '' | *[!0-9]*) echo 0 ;;
    *) echo "$pid" ;;
  esac
}

cohory_lock_is_stale() {
  local dir="$1" pid
  pid="$(cohory_lock_holder_pid "$dir")"
  if [ "$pid" -gt 0 ]; then
    ! kill -0 "$pid" 2>/dev/null
    return
  fi
  [ -n "$(find "$dir" -maxdepth 0 -mmin "+${COHORY_LOCK_STALE_MINUTES:-240}" 2>/dev/null)" ]
}

cohory_lock_acquire() {
  local dir="$1" label="$2" pid="${3:-$$}" poll="${COHORY_LOCK_POLL_SECONDS:-30}" announced=0
  until mkdir "$dir" 2>/dev/null; do
    if cohory_lock_is_stale "$dir"; then
      echo "removing stale lock $dir ($(cat "$dir/label" 2>/dev/null || echo "no label"))" >&2
      rm -rf "$dir"
      continue
    fi
    if [ "$announced" = 0 ]; then
      echo "waiting for $dir, held by $(cat "$dir/label" 2>/dev/null || echo "an unknown holder") (pid $(cohory_lock_holder_pid "$dir")); checking every ${poll}s" >&2
      announced=1
    fi
    sleep "$poll"
  done
  echo "$pid" >"$dir/pid"
  echo "$label, since $(date '+%Y-%m-%d %H:%M:%S')" >"$dir/label"
}

cohory_lock_release() {
  local dir="$1" pid="${2:-$$}"
  if [ -f "$dir/pid" ] && [ "$(cohory_lock_holder_pid "$dir")" = "$pid" ]; then
    rm -rf "$dir"
  fi
}
