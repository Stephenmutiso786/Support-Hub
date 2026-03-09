#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8090}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@supporthub.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-AdminPass123!}"
EXPECTED_SUPPORT_NUMBER="${EXPECTED_SUPPORT_NUMBER:-1001}"

json_get() {
  node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); console.log(data$1)"
}

echo "[1/6] API health"
curl -fsS "$BASE_URL/health" > /dev/null

echo "[2/6] Admin login"
LOGIN=$(curl -fsS -X POST "$BASE_URL/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
TOKEN=$(echo "$LOGIN" | json_get '.token')
if [ -z "$TOKEN" ] || [ "$TOKEN" = "undefined" ]; then
  echo "Admin login failed"
  exit 1
fi

echo "[3/6] Client support number check"
CLIENTS=$(curl -fsS "$BASE_URL/api/v1/clients" -H "Authorization: Bearer $TOKEN")
SUPPORT_MISMATCH=$(echo "$CLIENTS" | node -e "const fs=require('fs');const arr=JSON.parse(fs.readFileSync(0,'utf8'));const expected=process.argv[1];const bad=arr.filter(c=>String(c.support_number||'')!==expected);console.log(bad.length)" "$EXPECTED_SUPPORT_NUMBER")
if [ "$SUPPORT_MISMATCH" -gt 0 ]; then
  echo "Found clients not using support number $EXPECTED_SUPPORT_NUMBER"
  exit 1
fi

echo "[4/6] AMI bridge liveness"
BRIDGE_LIVE=$(docker compose exec -T ami-bridge node -e "fetch('http://127.0.0.1:9091/live').then(async r=>{console.log(r.status); process.exit(r.ok?0:1)}).catch(()=>process.exit(1))")
echo "bridge_live_status=$BRIDGE_LIVE"

echo "[5/6] AMI bridge readiness + metrics"
docker compose exec -T ami-bridge node -e "Promise.all([fetch('http://127.0.0.1:9091/health'),fetch('http://127.0.0.1:9091/metrics')]).then(async ([h,m])=>{console.log('bridge_health_status=' + h.status); console.log('bridge_health_body=' + await h.text()); console.log('bridge_metrics=' + await m.text()); process.exit(0)}).catch(()=>process.exit(1))"

echo "[6/6] Dashboard totals"
SUMMARY=$(curl -fsS "$BASE_URL/api/v1/dashboard/summary" -H "Authorization: Bearer $TOKEN")
TOTAL_CALLS=$(echo "$SUMMARY" | json_get '.totals.calls')
TOTAL_AGENTS=$(echo "$SUMMARY" | json_get '.totals.agents')

echo "totals.calls=$TOTAL_CALLS"
echo "totals.agents=$TOTAL_AGENTS"

echo "Go-live check passed."
