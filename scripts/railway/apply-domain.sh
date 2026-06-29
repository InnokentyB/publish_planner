#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <service-name> <domain> [port]" >&2
  exit 1
fi

SERVICE_NAME="$1"
DOMAIN="$2"
PORT="${3:-}"

ARGS=(domain --service "$SERVICE_NAME")
if [[ -n "$PORT" ]]; then
  ARGS+=(--port "$PORT")
fi
ARGS+=("$DOMAIN")

echo "Applying domain '$DOMAIN' to Railway service '$SERVICE_NAME'"
railway "${ARGS[@]}"

