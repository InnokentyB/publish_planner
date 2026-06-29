#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 4 ]]; then
  echo "Usage: $0 <remote-mcp-url> <mcp-auth-token> <user-id> <project-id> [parser-api-base-url]" >&2
  exit 1
fi

REMOTE_MCP_URL="$1"
MCP_AUTH_TOKEN="$2"
USER_ID="$3"
PROJECT_ID="$4"
PARSER_API_BASE_URL="${5:-${PARSER_API_BASE_URL:-}}"

echo "Running remote MCP smoke"
node scripts/test_remote_mcp.js \
  --url "$REMOTE_MCP_URL" \
  --auth-token "$MCP_AUTH_TOKEN" \
  --user-id "$USER_ID" \
  --project-id "$PROJECT_ID"

if [[ -n "$PARSER_API_BASE_URL" ]]; then
  echo "Running parser chain smoke"
  PARSER_API_BASE_URL="$PARSER_API_BASE_URL" \
  PARSER_SERVICE_TOKEN="${PARSER_SERVICE_TOKEN:-}" \
  APP_DATABASE_URL="${APP_DATABASE_URL:-${DATABASE_URL:-}}" \
  DATABASE_URL="${DATABASE_URL:-${APP_DATABASE_URL:-}}" \
  node scripts/test_parser_chain.js \
    --user-id "$USER_ID" \
    --project-id "$PROJECT_ID" \
    --skip-search
fi

