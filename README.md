# Support Hub

Support Hub is a multi-tenant customer care / call-center MVP.

## Completed Scope
- Auth with roles: `admin`, `client`, `agent`
- Session token login/logout
- Core entities: clients, agents, calls, tickets
- Telephony event ingest endpoint with call lifecycle upsert
- AMI bridge service (Asterisk Manager Interface -> Support Hub events)
- AMI bridge health + metrics endpoints
- Dashboard metrics endpoint
- Built-in web UI served by backend
- Deployment stacks: local reverse proxy + production TLS-ready config
- Asterisk starter configuration pack

## Quick Start (Local Dev)
1. Start DB:
   ```bash
   docker compose up -d db
   ```
2. Install dependencies:
   ```bash
   cd backend
   NPM_CONFIG_CACHE=.npm-cache npm install
   ```
3. Configure env:
   ```bash
   cp .env.example .env
   ```
4. Initialize schema:
   ```bash
   npm run db:init
   ```
5. Optional reset + seed:
   ```bash
   npm run db:reset
   npm run db:seed
   ```
6. Run app:
   ```bash
   npm run dev
   ```

App URL: `http://localhost:8081`

## Run AMI Bridge (Standalone)
1. Copy bridge env:
   ```bash
   cp backend/.env.bridge.example backend/.env.bridge
   ```
2. Edit AMI credentials in `backend/.env.bridge`.
3. Start bridge:
   ```bash
   cd backend
   set -a; source .env.bridge; set +a
   npm run bridge:ami
   ```
4. Check bridge status:
   - `http://localhost:9091/health`
   - `http://localhost:9091/metrics`

## Local Deployment (Compose)
Start local stack (Postgres + backend + AMI bridge + nginx):
```bash
docker compose up -d --build
```

Exposed ports:
- Backend direct: `http://localhost:8081`
- Nginx proxy: `http://localhost:8090`

## Production Deployment (TLS)
This uses `docker-compose.prod.yml` + Caddy.

1. Create production env file:
   ```bash
   cp deployment/.env.production.example deployment/.env.production
   ```
2. Edit `deployment/.env.production` with real values:
   - `DOMAIN`
   - `ACME_EMAIL`
   - `POSTGRES_PASSWORD`
   - `TELEPHONY_API_KEY`
   - `TELEPHONY_WEBHOOK_SECRET`
   - `CORS_ORIGIN`
   - `AMI_HOST`, `AMI_PORT`, `AMI_USERNAME`, `AMI_SECRET`
3. Start production stack:
   ```bash
   docker compose --env-file deployment/.env.production -f docker-compose.prod.yml up -d --build
   ```
4. Initialize DB schema in backend container:
   ```bash
   docker compose --env-file deployment/.env.production -f docker-compose.prod.yml exec -T backend node scripts/init-db.js
   ```

Exposed ports:
- HTTP: `80`
- HTTPS: `443`

## Deploy to Render
This project includes a Render Blueprint: `render.yaml`.

### 1) Create a clean Git repo from this folder
Your current git root is `/home/ofx_steve`, so create a dedicated repo for this project:
```bash
cd "/home/ofx_steve/Desktop/Support Hub"
git init
git add .
git commit -m "Initial Support Hub app"
git branch -M main
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

### 2) Deploy on Render
1. In Render, click **New** -> **Blueprint**.
2. Connect your GitHub repo.
3. Select branch `main`.
4. Render reads `render.yaml` and creates:
   - `supporthub-db` (Postgres)
   - `supporthub-api` (Node web service)
5. Set `CORS_ORIGIN` in Render env vars to your frontend/domain.
6. Deploy.

### 3) Verify
- Health: `https://<your-render-service>.onrender.com/health`
- App UI: `https://<your-render-service>.onrender.com/`

## Smoke Test
Run against local backend:
```bash
./scripts/integration-smoke.sh
```

Run through local nginx proxy:
```bash
BASE_URL=http://localhost:8090 TELEPHONY_KEY=dev-telephony-key ./scripts/integration-smoke.sh
```

If webhook signing is enabled, include:
```bash
BASE_URL=http://localhost:8090 TELEPHONY_KEY=dev-telephony-key TELEPHONY_WEBHOOK_SECRET=your-secret ./scripts/integration-smoke.sh
```

Go-live readiness check:
```bash
BASE_URL=http://localhost:8090 ./scripts/go-live-check.sh
```

## AMI Bridge Mapping
Bridge listens for AMI events and emits normalized events to `/api/v1/telephony/events`.

Current mapping:
- `Newchannel (Ring)` -> `incoming`
- `BridgeEnter` / `AgentConnect` / `DialEnd` -> `answered`
- `Hangup` -> `completed`

Hardening included:
- Linkedid-based call correlation fallback chain
- Duplicate suppression window (`AMI_DEDUPE_WINDOW_MS`)
- stale call cleanup (`AMI_STALE_CALL_MS`)
- File-backed outbox + replay loop for failed API posts
- Optional HMAC webhook signing (`x-telephony-timestamp` + `x-telephony-signature`)

Outbox controls:
- `BRIDGE_OUTBOX_PATH`
- `BRIDGE_REPLAY_INTERVAL_MS`

Bridge `/metrics` includes:
- `outbox_pending_estimate`
- `outbox_queued`
- `outbox_replay_runs`
- `outbox_replay_failures`

## Auth Endpoints
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `GET /api/v1/auth/users` (admin only)

## Business Endpoints
- `GET/POST /api/v1/clients`
- `GET/POST /api/v1/agents`
- `PATCH /api/v1/agents/:id/status`
- `GET/POST /api/v1/calls`
- `GET/POST /api/v1/tickets`
- `GET /api/v1/dashboard/summary`

## Telephony Ingest
Endpoint:
- `POST /api/v1/telephony/events`

Headers:
- `Content-Type: application/json`
- `x-telephony-key: <TELEPHONY_API_KEY>`

Use sequence (`incoming` -> `answered` -> `completed`) with same `external_call_id`.

## Asterisk Starter Pack
Path: `telephony/asterisk/`
- `pjsip.conf`
- `queues.conf`
- `extensions.conf`
- `README.md`

Update credentials, webhook URL, and `client_id` before production use.
