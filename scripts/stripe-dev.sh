#!/usr/bin/env bash
# Forward Stripe test mode webhooks to a local server with the Stripe CLI.
# Reads STRIPE_SECRET_KEY from the environment or from .env in the repository root and never
# prints it. Put the signing secret the CLI prints into STRIPE_WEBHOOK_SECRET and
# STRIPE_CONNECT_WEBHOOK_SECRET (one listener covers platform and Connect events), then start
# the app. Usage: scripts/stripe-dev.sh [port]   (default 3000)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-${APP_PORT:-3000}}"
STRIPE_BIN="${STRIPE_BIN:-stripe}"

if [ -z "${STRIPE_SECRET_KEY:-}" ] && [ -f "$ROOT/.env" ]; then
  STRIPE_SECRET_KEY="$(grep -E '^STRIPE_SECRET_KEY=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"' || true)"
fi
if [ -z "${STRIPE_SECRET_KEY:-}" ]; then
  echo "STRIPE_SECRET_KEY is not set. Add a test mode key (sk_test_ or rk_test_) to .env first." >&2
  exit 1
fi
case "$STRIPE_SECRET_KEY" in
  sk_test_*|rk_test_*) ;;
  *) echo "Refusing to forward webhooks for a key that is not a test mode key." >&2; exit 1 ;;
esac
if ! command -v "$STRIPE_BIN" >/dev/null 2>&1; then
  echo "The Stripe CLI is not installed. See https://docs.stripe.com/stripe-cli" >&2
  exit 1
fi

URL="http://localhost:${PORT}/api/webhooks/stripe"
echo "Forwarding Stripe test mode events (platform and Connect) to $URL"
echo "Copy the whsec_ value printed below into STRIPE_WEBHOOK_SECRET and STRIPE_CONNECT_WEBHOOK_SECRET"
echo "in .env, then start the web app and the worker. Start this listener after Connect is enabled"
echo "in the sandbox, otherwise connected account events are not forwarded. Stop it with Ctrl-C."
exec "$STRIPE_BIN" listen --skip-update --api-key "$STRIPE_SECRET_KEY" \
  --forward-to "$URL" --forward-connect-to "$URL"
