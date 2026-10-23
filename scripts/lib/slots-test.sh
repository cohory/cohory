#!/usr/bin/env bash
# Tests for scripts/lib/slots.sh on a private pool in a temporary folder.
#
#   bash scripts/lib/slots-test.sh
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
export COHORY_SLOTS_DIR="$work/pool" COHORY_TEST_SLOTS=2 COHORY_SLOTS_POLL_SECONDS=0.1
unset COHORY_SLOTS_HELD
failures=0
children=()

cleanup() {
  for pid in "${children[@]+"${children[@]}"}"; do
    kill "$pid" 2>/dev/null
  done
  wait 2>/dev/null
  rm -rf "$work"
}
trap cleanup EXIT

check() {
  if eval "$2"; then
    echo "ok   $1"
  else
    echo "FAIL $1"
    failures=$((failures + 1))
  fi
}

# Starts a holder that takes $2 slots, writes "<name> start" to the event log, waits until the
# file $work/<name>.stop exists, then writes "<name> end" and exits.
holder() {
  local name="$1" count="$2"
  bash -c '
    source "$1/slots.sh"
    cohory_slots_acquire "$3" "holder $2" "$$" 2>>"$4/$2.err"
    echo "$2 start" >>"$4/events"
    until [ -f "$4/$2.stop" ]; do sleep 0.05; done
    echo "$2 end" >>"$4/events"
    cohory_slots_release "$$"
  ' holder "$here" "$name" "$count" "$work" &
  children+=($!)
  last_pid=$!
}

started() { grep -qx "$1 start" "$work/events" 2>/dev/null; }
wait_until() {
  local deadline=$((SECONDS + 10))
  until eval "$1"; do
    [ "$SECONDS" -ge "$deadline" ] && return 1
    sleep 0.05
  done
}
reset() {
  for pid in "${children[@]+"${children[@]}"}"; do kill "$pid" 2>/dev/null; done
  wait 2>/dev/null
  children=()
  rm -rf "$COHORY_SLOTS_DIR" "$work"/events "$work"/*.stop "$work"/*.err
}

# Two of three single slot holders run, the third waits until one ends.
holder a 1
holder b 1
wait_until "started a && started b"
holder c 1
wait_until "[ -s '$work/c.err' ]"
check "a third holder waits while two slots are taken" "! started c"
check "the waiting holder prints one line naming the holders" \
  "[ \"\$(wc -l <'$work/c.err' | tr -d ' ')\" = 1 ] && grep -q 'holder a' '$work/c.err' && grep -q 'holder b' '$work/c.err'"
touch "$work/a.stop"
check "the third holder starts once a slot is free" "wait_until 'started c'"
reset

# A holder that dies without releasing leaves a stale slot that the next waiter takes over.
holder a 1
dead_pid=$last_pid
holder b 1
wait_until "started a && started b"
holder c 1
wait_until "[ -s '$work/c.err' ]"
kill -9 "$dead_pid" 2>/dev/null
wait "$dead_pid" 2>/dev/null
check "a slot whose holder was killed is taken over" "wait_until 'started c'"
reset

# all takes every slot, so it waits for both single holders.
holder a 1
holder b 1
wait_until "started a && started b"
holder e all
wait_until "[ -s '$work/e.err' ]"
touch "$work/a.stop"
wait_until "grep -qx 'a end' '$work/events'"
sleep 0.5
check "all waits while any slot is taken" "! started e"
touch "$work/b.stop"
check "all starts once every slot is free" "wait_until 'started e'"
reset

# Waiters are served in order: a single slot request behind an all request does not overtake it.
holder a 1
wait_until "started a"
holder e all
wait_until "[ -s '$work/e.err' ]"
holder c 1
wait_until "[ -s '$work/c.err' ]"
sleep 0.5
check "a later single slot request does not overtake a waiting all request" "! started c"
touch "$work/a.stop"
wait_until "started e"
check "the all request runs alone" "! started c"
touch "$work/e.stop"
check "the single request runs after it" "wait_until 'started c'"
reset

# A script started by a holder does not take slots again.
bash -c '
  source "$1/slots.sh"
  cohory_slots_acquire 1 "outer" "$$"
  bash -c "source \"\$1/slots.sh\"; cohory_slots_acquire all nested \$\$; echo nested >>\"\$2/events\"" nested "$1" "$2"
  cohory_slots_release "$$"
' outer "$here" "$work" &
children+=($!)
check "a nested script inside a holder does not wait for slots" "wait_until 'grep -qx nested \"$work/events\" 2>/dev/null'"
reset

# Release frees exactly the caller's slots, and a handover to pid 0 keeps them taken.
bash -c 'source "$1/slots.sh"; cohory_slots_acquire all "kept stack" "$$"; cohory_slots_handover "$$" 0' kept "$here"
check "a handover to pid 0 keeps the slots after the process exits" \
  "[ -d '$COHORY_SLOTS_DIR/slot-1' ] && [ -d '$COHORY_SLOTS_DIR/slot-2' ]"
(
  source "$here/slots.sh"
  cohory_slots_release 0
)
check "releasing pid 0 frees the handed over slots" \
  "[ ! -d '$COHORY_SLOTS_DIR/slot-1' ] && [ ! -d '$COHORY_SLOTS_DIR/slot-2' ]"
reset

if [ "$failures" -gt 0 ]; then
  echo "$failures failed"
  exit 1
fi
echo "all passed"
