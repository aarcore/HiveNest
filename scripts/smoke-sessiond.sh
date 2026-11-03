#!/usr/bin/env bash
set -euo pipefail
BASE="${HIVENEST_SESSIOND_URL:-http://127.0.0.1:7788}"
TOKEN="${HIVENEST_SESSIOND_TOKEN:-dev-smoke-token}"
auth=(-H "Authorization: Bearer ${TOKEN}")
echo "GET ${BASE}/health"
curl -sf "${auth[@]}" "${BASE}/health" | tee /tmp/hn-health.json
echo
echo "GET ${BASE}/v1/hosts"
curl -sf "${auth[@]}" "${BASE}/v1/hosts" | tee /tmp/hn-hosts.json
echo
echo "OK smoke-sessiond"
