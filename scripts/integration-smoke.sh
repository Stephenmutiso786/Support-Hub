#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8081}"
TELEPHONY_KEY="${TELEPHONY_KEY:-dev-telephony-key}"
TELEPHONY_WEBHOOK_SECRET="${TELEPHONY_WEBHOOK_SECRET:-}"

json_get() {
  node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));console.log(data$1)"
}

sign_payload() {
  local payload="$1"
  local ts="$2"
  printf '%s' "$payload" | node -e "const crypto=require('crypto');const fs=require('fs');const secret=process.argv[1];const ts=process.argv[2];const body=fs.readFileSync(0,'utf8');console.log(crypto.createHmac('sha256',secret).update(ts + '.' + body).digest('hex'))" "$TELEPHONY_WEBHOOK_SECRET" "$ts"
}

post_telephony() {
  local payload="$1"
  local curl_args=(-fsS -X POST "$BASE_URL/api/v1/telephony/events" -H 'Content-Type: application/json' -H "x-telephony-key: $TELEPHONY_KEY")
  if [ -n "$TELEPHONY_WEBHOOK_SECRET" ]; then
    local ts
    ts="$(date +%s)"
    local sig
    sig="$(sign_payload "$payload" "$ts")"
    curl_args+=(-H "x-telephony-timestamp: $ts" -H "x-telephony-signature: $sig")
  fi
  curl "${curl_args[@]}" -d "$payload" > /dev/null
}

echo "[1/7] Health check"
curl -fsS "$BASE_URL/health" > /dev/null

echo "[2/7] Login admin"
LOGIN=$(curl -fsS -X POST "$BASE_URL/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@supporthub.local","password":"AdminPass123!"}')
TOKEN=$(echo "$LOGIN" | json_get '.token')

echo "[3/7] Create client"
CLIENT=$(curl -fsS -X POST "$BASE_URL/api/v1/clients" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Smoke Client","support_number":"1001"}')
CLIENT_ID=$(echo "$CLIENT" | json_get '.id')

echo "[4/7] Create agent"
AGENT=$(curl -fsS -X POST "$BASE_URL/api/v1/agents" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"client_id\":$CLIENT_ID,\"full_name\":\"Smoke Agent\",\"email\":\"smoke.agent+$CLIENT_ID@local.test\",\"extension\":\"1099\"}")
AGENT_ID=$(echo "$AGENT" | json_get '.id')

echo "[5/7] Telephony lifecycle"
for event in incoming answered completed; do
  if [ "$event" = incoming ]; then
    PAYLOAD="{\"event\":\"incoming\",\"external_call_id\":\"smoke-$CLIENT_ID\",\"client_id\":$CLIENT_ID,\"caller_number\":\"+14155550000\",\"direction\":\"inbound\"}"
  elif [ "$event" = answered ]; then
    PAYLOAD="{\"event\":\"answered\",\"external_call_id\":\"smoke-$CLIENT_ID\",\"client_id\":$CLIENT_ID,\"caller_number\":\"+14155550000\",\"direction\":\"inbound\",\"agent_extension\":\"1099\"}"
  else
    PAYLOAD="{\"event\":\"completed\",\"external_call_id\":\"smoke-$CLIENT_ID\",\"client_id\":$CLIENT_ID,\"caller_number\":\"+14155550000\",\"direction\":\"inbound\",\"agent_extension\":\"1099\",\"duration_seconds\":42}"
  fi
  post_telephony "$PAYLOAD"
done

echo "[6/7] Agent-scoped login"
curl -fsS -X POST "$BASE_URL/api/v1/auth/register" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"full_name\":\"Smoke Agent User\",\"email\":\"smoke.user+$CLIENT_ID@local.test\",\"password\":\"AgentPass123!\",\"role\":\"agent\",\"client_id\":$CLIENT_ID,\"agent_id\":$AGENT_ID}" > /dev/null

echo "[7/7] Dashboard check"
SUMMARY=$(curl -fsS "$BASE_URL/api/v1/dashboard/summary" -H "Authorization: Bearer $TOKEN")
TOTAL_CALLS=$(echo "$SUMMARY" | json_get '.totals.calls')
if [ "$TOTAL_CALLS" -lt 1 ]; then
  echo "Expected calls total >= 1"
  exit 1
fi

echo "Smoke test passed."
