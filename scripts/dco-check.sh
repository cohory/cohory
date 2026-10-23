#!/usr/bin/env bash
# Usage: scripts/dco-check.sh <base-ref> <head-ref>
# Fails when a non merge commit in base..head lacks a Signed-off-by line for its author email.
set -euo pipefail

base="${1:?base ref required}"
head="${2:?head ref required}"
missing=0

for commit in $(git rev-list --no-merges "${base}..${head}"); do
  email="$(git log -1 --format='%ae' "$commit")"
  if git log -1 --format='%B' "$commit" | grep -qiE "^Signed-off-by: .+ <${email//./\\.}>\s*$"; then
    continue
  fi
  echo "Missing DCO sign-off for ${email} on $(git log -1 --format='%h %s' "$commit")"
  missing=1
done

if [ "$missing" -ne 0 ]; then
  echo "Add the sign-off with: git rebase --signoff ${base}"
  exit 1
fi
echo "Every commit is signed off."
