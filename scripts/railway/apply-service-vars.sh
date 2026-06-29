#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <service-name> <env-file> [environment]" >&2
  exit 1
fi

SERVICE_NAME="$1"
ENV_FILE="$2"
ENVIRONMENT="${3:-}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file not found: $ENV_FILE" >&2
  exit 1
fi

ARGS=(variables --service "$SERVICE_NAME" --skip-deploys)
if [[ -n "$ENVIRONMENT" ]]; then
  ARGS+=(--environment "$ENVIRONMENT")
fi

while IFS= read -r line || [[ -n "$line" ]]; do
  trimmed="${line#"${line%%[![:space:]]*}"}"
  if [[ -z "$trimmed" || "$trimmed" == \#* ]]; then
    continue
  fi
  ARGS+=(--set "$trimmed")
done < "$ENV_FILE"

echo "Applying variables to Railway service '$SERVICE_NAME' from '$ENV_FILE'"
railway "${ARGS[@]}"

