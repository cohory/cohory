#!/usr/bin/env bash
# The machine wide test budget: one pool of COHORY_TEST_SLOTS slots (default 2) shared by every
# checkout and worktree on the machine. Typecheck, lint, unit and integration runs take one slot,
# an e2e run takes all of them. Sourced by the scripts behind pnpm verify, verify:changed,
# test:integration:local, e2e and e2e:host.
#
#   cohory_slots_acquire 1 "verify:changed from $root" "$$"
#   cohory_slots_release "$$"
#
# Each slot is a directory made with mkdir, which is atomic, holding the pid and label of its
# holder. Waiters queue in arrival order, so a run that needs every slot is not overtaken by
# later single slot runs. A slot or queue entry whose pid is gone is removed by the next waiter.
# A slot handed to pid 0 (a stack kept for spec work) is stale after COHORY_LOCK_STALE_MINUTES.
# A script started by a holder inherits COHORY_SLOTS_HELD and does not take slots again.

source "$(dirname "${BASH_SOURCE[0]}")/lock.sh"

COHORY_SLOTS_DIR="${COHORY_SLOTS_DIR:-/tmp/cohory-slots}"

cohory_slots_total() {
  case "${COHORY_TEST_SLOTS:-2}" in
    '' | *[!0-9]* | 0) echo 2 ;;
    *) echo "${COHORY_TEST_SLOTS:-2}" ;;
  esac
}

cohory_slots_gate_enter() {
  local gate="$COHORY_SLOTS_DIR/gate"
  until mkdir "$gate" 2>/dev/null; do
    if [ "$(cohory_lock_holder_pid "$gate")" -gt 0 ]; then
      if cohory_lock_is_stale "$gate"; then rm -rf "$gate"; fi
    elif COHORY_LOCK_STALE_MINUTES=1 cohory_lock_is_stale "$gate"; then
      rm -rf "$gate"
    fi
    sleep 0.05
  done
  echo "$$" >"$gate/pid"
}

cohory_slots_gate_leave() {
  rm -rf "$COHORY_SLOTS_DIR/gate"
}

cohory_slots_remove_stale() {
  local entry pid
  for entry in "$COHORY_SLOTS_DIR"/slot-*; do
    if [ -d "$entry" ] && cohory_lock_is_stale "$entry"; then rm -rf "$entry"; fi
  done
  for entry in "$COHORY_SLOTS_DIR"/queue/*; do
    [ -f "$entry" ] || continue
    pid="$(head -n 1 "$entry" 2>/dev/null)"
    if ! kill -0 "${pid:-0}" 2>/dev/null; then rm -f "$entry"; fi
  done
}

cohory_slots_holders() {
  local entry list=""
  for entry in "$COHORY_SLOTS_DIR"/slot-*; do
    [ -d "$entry" ] || continue
    list="${list:+$list; }$(cat "$entry/label" 2>/dev/null || echo "unknown") (pid $(cohory_lock_holder_pid "$entry"))"
  done
  echo "${list:-nobody, waiting for an earlier request}"
}

# cohory_slots_acquire <count|all> <label> [pid]
cohory_slots_acquire() {
  local want="$1" label="$2" pid="${3:-$$}" total ticket first free i announced=0
  if [ -n "${COHORY_SLOTS_HELD:-}" ]; then
    return 0
  fi
  total="$(cohory_slots_total)"
  if [ "$want" = all ] || [ "$want" -gt "$total" ]; then
    want="$total"
  fi
  mkdir -p "$COHORY_SLOTS_DIR/queue"

  cohory_slots_gate_enter
  ticket=$(($(cat "$COHORY_SLOTS_DIR/next" 2>/dev/null || echo 0) + 1))
  echo "$ticket" >"$COHORY_SLOTS_DIR/next"
  ticket="$(printf '%012d' "$ticket")"
  echo "$$" >"$COHORY_SLOTS_DIR/queue/$ticket"
  cohory_slots_gate_leave

  while :; do
    cohory_slots_gate_enter
    cohory_slots_remove_stale
    first="$(ls "$COHORY_SLOTS_DIR/queue" | sort | head -n 1)"
    free=()
    for i in $(seq 1 "$total"); do
      [ -d "$COHORY_SLOTS_DIR/slot-$i" ] || free+=("$i")
    done
    if [ "$first" = "$ticket" ] && [ "${#free[@]}" -ge "$want" ]; then
      for i in "${free[@]:0:$want}"; do
        mkdir "$COHORY_SLOTS_DIR/slot-$i"
        echo "$pid" >"$COHORY_SLOTS_DIR/slot-$i/pid"
        echo "$label, since $(date '+%Y-%m-%d %H:%M:%S')" >"$COHORY_SLOTS_DIR/slot-$i/label"
      done
      rm -f "$COHORY_SLOTS_DIR/queue/$ticket"
      cohory_slots_gate_leave
      export COHORY_SLOTS_HELD="$want"
      return 0
    fi
    cohory_slots_gate_leave
    if [ "$announced" = 0 ]; then
      echo "waiting for $want of $total test slots, held by $(cohory_slots_holders)" >&2
      announced=1
    fi
    sleep "${COHORY_SLOTS_POLL_SECONDS:-5}"
  done
}

# cohory_slots_release [pid]: frees every slot the pid holds.
cohory_slots_release() {
  local pid="${1:-$$}" entry
  [ -d "$COHORY_SLOTS_DIR" ] || return 0
  cohory_slots_gate_enter
  for entry in "$COHORY_SLOTS_DIR"/slot-*; do
    if [ -d "$entry" ] && [ "$(cohory_lock_holder_pid "$entry")" = "$pid" ]; then rm -rf "$entry"; fi
  done
  cohory_slots_gate_leave
  unset COHORY_SLOTS_HELD
}

# cohory_slots_handover <from pid> <to pid>: moves the slots to another holder, for example to
# pid 0 when a stack outlives the script that started it.
cohory_slots_handover() {
  local from="$1" to="$2" entry
  cohory_slots_gate_enter
  for entry in "$COHORY_SLOTS_DIR"/slot-*; do
    if [ -d "$entry" ] && [ "$(cohory_lock_holder_pid "$entry")" = "$from" ]; then echo "$to" >"$entry/pid"; fi
  done
  cohory_slots_gate_leave
}
