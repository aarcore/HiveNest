#!/usr/bin/env bash
# Smoke MCP connectivity.
# - HTTP/SSE: set HIVENEST_MCP_URL (e.g. streamable HTTP endpoint) and optional Bearer token.
# - Stdio/command: requires HiveNest desktop (Tauri) mcp_start bridge — not exercised here.
set -euo pipefail
URL="${HIVENEST_MCP_URL:-}"
if [[ -z "$URL" ]]; then
  echo "HIVENEST_MCP_URL unset — skipping live HTTP probe."
  echo "Optional: start a local MCP HTTP server, e.g."
  echo "  npx -y @modelcontextprotocol/server-everything streamableHttp"
  echo "then: HIVENEST_MCP_URL=http://127.0.0.1:<port>/mcp $0"
  echo "Stdio MCP: configure transport=command in Settings and run via npm run tauri:dev."
  exit 0
fi
echo "POST tools/list → $URL"
curl -sf -X POST "$URL" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  ${HIVENEST_MCP_TOKEN:+-H "Authorization: Bearer $HIVENEST_MCP_TOKEN"} \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | head -c 2000
echo
echo "OK smoke-mcp"
