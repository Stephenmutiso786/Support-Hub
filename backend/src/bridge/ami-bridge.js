const net = require('net');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const cfg = {
  amiHost: process.env.AMI_HOST || '127.0.0.1',
  amiPort: Number(process.env.AMI_PORT || 5038),
  amiUsername: process.env.AMI_USERNAME,
  amiSecret: process.env.AMI_SECRET,
  backendBaseUrl: (process.env.BACKEND_BASE_URL || 'http://localhost:8081').replace(/\/$/, ''),
  telephonyApiKey: process.env.TELEPHONY_API_KEY || '',
  telephonyWebhookSecret: process.env.TELEPHONY_WEBHOOK_SECRET || '',
  clientId: Number(process.env.AMI_CLIENT_ID || 1),
  queueName: process.env.AMI_QUEUE_NAME || 'support-main',
  reconnectMs: Number(process.env.AMI_RECONNECT_MS || 5000),
  dedupeWindowMs: Number(process.env.AMI_DEDUPE_WINDOW_MS || 4000),
  staleCallMs: Number(process.env.AMI_STALE_CALL_MS || 6 * 60 * 60 * 1000),
  healthPort: Number(process.env.BRIDGE_HEALTH_PORT || 9091),
  outboxPath: process.env.BRIDGE_OUTBOX_PATH || '/var/lib/supporthub/ami-outbox.ndjson',
  replayIntervalMs: Number(process.env.BRIDGE_REPLAY_INTERVAL_MS || 5000),
};

if (!cfg.amiUsername || !cfg.amiSecret) {
  throw new Error('AMI_USERNAME and AMI_SECRET are required for AMI bridge');
}

const state = {
  startedAt: Date.now(),
  connected: false,
  lastConnectAt: null,
  lastDisconnectAt: null,
  lastEventAt: null,
  reconnectCount: 0,
  eventsReceived: 0,
  eventsPosted: 0,
  postFailures: 0,
  outboxQueued: 0,
  outboxReplayRuns: 0,
  outboxReplayFailures: 0,
  outboxPendingEstimate: 0,
};

const calls = new Map();
const recentEventMarks = new Map();
let replayInProgress = false;

function toObj(block) {
  const lines = block.split('\r\n');
  const out = {};
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeNumber(value) {
  if (!value) return 'unknown';
  const cleaned = String(value).replace(/[\s()-]/g, '');
  return cleaned || 'unknown';
}

function parseExtension(channel) {
  const m = String(channel || '').match(/\/(\d+)-/);
  return m ? m[1] : null;
}

function getCallKey(event) {
  return event.Linkedid || event.Uniqueid || event.DestUniqueid || null;
}

function getOrCreateCall(callKey, event) {
  if (!calls.has(callKey)) {
    calls.set(callKey, {
      caller: normalizeNumber(event.CallerIDNum || event.CallerID || event.ConnectedLineNum),
      answered: false,
      startedAt: Date.now(),
      extension: null,
      linkedId: event.Linkedid || null,
      uniqueIds: new Set([event.Uniqueid, event.DestUniqueid].filter(Boolean)),
    });
  }

  const entry = calls.get(callKey);
  if (event.CallerIDNum) entry.caller = normalizeNumber(event.CallerIDNum);
  if (event.Uniqueid) entry.uniqueIds.add(event.Uniqueid);
  if (event.DestUniqueid) entry.uniqueIds.add(event.DestUniqueid);
  return entry;
}

function shouldSuppress(callKey, eventType) {
  const key = `${callKey}:${eventType}`;
  const now = Date.now();
  const prev = recentEventMarks.get(key);
  if (prev && now - prev < cfg.dedupeWindowMs) {
    return true;
  }
  recentEventMarks.set(key, now);
  return false;
}

function cleanupStale() {
  const now = Date.now();

  for (const [callKey, call] of calls.entries()) {
    if (now - call.startedAt > cfg.staleCallMs) {
      calls.delete(callKey);
    }
  }

  for (const [markKey, ts] of recentEventMarks.entries()) {
    if (now - ts > cfg.staleCallMs) {
      recentEventMarks.delete(markKey);
    }
  }
}

async function ensureOutboxDir() {
  await fs.mkdir(path.dirname(cfg.outboxPath), { recursive: true });
}

async function readOutboxEntries() {
  try {
    const content = await fs.readFile(cfg.outboxPath, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    const entries = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch (error) {
        // Skip malformed lines to avoid blocking the whole queue.
        console.error('[AMI-BRIDGE] Skipping malformed outbox line');
      }
    }
    state.outboxPendingEstimate = entries.length;
    return entries;
  } catch (error) {
    if (error.code === 'ENOENT') {
      state.outboxPendingEstimate = 0;
      return [];
    }
    throw error;
  }
}

async function writeOutboxEntries(entries) {
  if (!entries.length) {
    try {
      await fs.unlink(cfg.outboxPath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    state.outboxPendingEstimate = 0;
    return;
  }

  const content = `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
  await fs.writeFile(cfg.outboxPath, content, 'utf8');
  state.outboxPendingEstimate = entries.length;
}

async function enqueueOutbox(payload, reason) {
  const entry = {
    ts: nowIso(),
    reason,
    payload,
  };
  await ensureOutboxDir();
  await fs.appendFile(cfg.outboxPath, `${JSON.stringify(entry)}\n`, 'utf8');
  state.outboxQueued += 1;
  state.outboxPendingEstimate += 1;
}

async function postEventToBackend(payload) {
  const body = JSON.stringify(payload);
  const headers = {
    'Content-Type': 'application/json',
    'x-telephony-key': cfg.telephonyApiKey,
  };

  if (cfg.telephonyWebhookSecret) {
    const ts = Math.floor(Date.now() / 1000);
    const sig = crypto
      .createHmac('sha256', cfg.telephonyWebhookSecret)
      .update(`${ts}.${body}`)
      .digest('hex');
    headers['x-telephony-timestamp'] = String(ts);
    headers['x-telephony-signature'] = sig;
  }

  const response = await fetch(`${cfg.backendBaseUrl}/api/v1/telephony/events`, {
    method: 'POST',
    headers,
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Backend event post failed (${response.status}): ${text}`);
  }

  state.eventsPosted += 1;
}

async function postEvent(payload, sourceTag) {
  try {
    await postEventToBackend(payload);
  } catch (error) {
    state.postFailures += 1;
    await enqueueOutbox(payload, sourceTag || 'live');
    throw error;
  }
}

async function replayOutboxOnce() {
  if (replayInProgress) {
    return;
  }

  replayInProgress = true;
  state.outboxReplayRuns += 1;

  try {
    const entries = await readOutboxEntries();
    if (!entries.length) {
      return;
    }

    const remaining = [];
    let failed = false;

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (failed) {
        remaining.push(entry);
        continue;
      }

      try {
        await postEventToBackend(entry.payload);
      } catch (error) {
        state.outboxReplayFailures += 1;
        failed = true;
        remaining.push(entry);
      }
    }

    await writeOutboxEntries(remaining);
  } catch (error) {
    state.outboxReplayFailures += 1;
    console.error('[AMI-BRIDGE] Outbox replay failed:', error.message);
  } finally {
    replayInProgress = false;
  }
}

async function emitIncoming(callKey, caller) {
  await postEvent(
    {
      event: 'incoming',
      external_call_id: callKey,
      client_id: cfg.clientId,
      caller_number: normalizeNumber(caller),
      direction: 'inbound',
      queue_name: cfg.queueName,
    },
    'incoming'
  );
}

async function emitAnswered(callKey, caller, extension) {
  await postEvent(
    {
      event: 'answered',
      external_call_id: callKey,
      client_id: cfg.clientId,
      caller_number: normalizeNumber(caller),
      direction: 'inbound',
      queue_name: cfg.queueName,
      agent_extension: extension || undefined,
    },
    'answered'
  );
}

async function emitCompleted(callKey, caller, durationSeconds, cause) {
  await postEvent(
    {
      event: 'completed',
      external_call_id: callKey,
      client_id: cfg.clientId,
      caller_number: normalizeNumber(caller),
      direction: 'inbound',
      queue_name: cfg.queueName,
      duration_seconds: Number(durationSeconds || 0),
      hangup_cause: cause || undefined,
    },
    'completed'
  );
}

async function handleEvent(event) {
  const eventName = event.Event;
  const callKey = getCallKey(event);
  if (!eventName || !callKey) return;

  state.eventsReceived += 1;
  state.lastEventAt = nowIso();

  const call = getOrCreateCall(callKey, event);

  try {
    if (eventName === 'Newchannel' && event.ChannelStateDesc === 'Ring') {
      if (!shouldSuppress(callKey, 'incoming')) {
        await emitIncoming(callKey, call.caller);
      }
      return;
    }

    if (eventName === 'BridgeEnter' || eventName === 'AgentConnect' || eventName === 'DialEnd') {
      const ext = parseExtension(event.Channel) || parseExtension(event.Destination) || call.extension;
      call.extension = ext;

      if (!call.answered && !shouldSuppress(callKey, 'answered')) {
        call.answered = true;
        await emitAnswered(callKey, call.caller, ext);
      }
      return;
    }

    if (eventName === 'Hangup') {
      if (!shouldSuppress(callKey, 'completed')) {
        const duration =
          event.BillableSeconds || Math.max(0, Math.floor((Date.now() - call.startedAt) / 1000));
        await emitCompleted(callKey, call.caller, duration, event.CauseTxt || event.Cause || undefined);
      }
      calls.delete(callKey);
    }
  } catch (error) {
    console.error('[AMI-BRIDGE] Event mapping failed:', eventName, callKey, error.message);
  }
}

function startHealthServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/live') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', now: nowIso() }));
      return;
    }

    if (req.url === '/health') {
      const ok = state.connected;
      res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: ok ? 'ok' : 'degraded',
          connected: state.connected,
          now: nowIso(),
          last_event_at: state.lastEventAt,
          calls_in_memory: calls.size,
          outbox_pending_estimate: state.outboxPendingEstimate,
        })
      );
      return;
    }

    if (req.url === '/metrics') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          started_at: new Date(state.startedAt).toISOString(),
          connected: state.connected,
          last_connect_at: state.lastConnectAt,
          last_disconnect_at: state.lastDisconnectAt,
          reconnect_count: state.reconnectCount,
          events_received: state.eventsReceived,
          events_posted: state.eventsPosted,
          post_failures: state.postFailures,
          calls_in_memory: calls.size,
          dedupe_marks: recentEventMarks.size,
          outbox_path: cfg.outboxPath,
          outbox_pending_estimate: state.outboxPendingEstimate,
          outbox_queued: state.outboxQueued,
          outbox_replay_runs: state.outboxReplayRuns,
          outbox_replay_failures: state.outboxReplayFailures,
        })
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(cfg.healthPort, () => {
    console.log(`[AMI-BRIDGE] Health server listening on :${cfg.healthPort}`);
  });
}

function run() {
  console.log(`[AMI-BRIDGE] Connecting to ${cfg.amiHost}:${cfg.amiPort}`);

  const socket = net.createConnection({ host: cfg.amiHost, port: cfg.amiPort });
  socket.setEncoding('utf8');

  let buffer = '';

  socket.on('connect', () => {
    state.connected = true;
    state.lastConnectAt = nowIso();

    const login = [
      'Action: Login',
      `Username: ${cfg.amiUsername}`,
      `Secret: ${cfg.amiSecret}`,
      'Events: on',
      '',
      '',
    ].join('\r\n');

    socket.write(login);
    console.log('[AMI-BRIDGE] Connected and login action sent.');
  });

  socket.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\r\n\r\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 4);
      if (!block.trim()) continue;

      const event = toObj(block);
      if (event.Event) {
        handleEvent(event);
      }
      if (event.Response === 'Error') {
        console.error('[AMI-BRIDGE] AMI error:', event.Message || 'unknown');
      }
    }
  });

  socket.on('error', (error) => {
    state.connected = false;
    console.error('[AMI-BRIDGE] Socket error:', error.message);
  });

  socket.on('close', () => {
    state.connected = false;
    state.lastDisconnectAt = nowIso();
    state.reconnectCount += 1;
    console.error('[AMI-BRIDGE] Connection closed. Reconnecting...');
    setTimeout(run, cfg.reconnectMs);
  });
}

async function bootstrap() {
  await ensureOutboxDir();
  await replayOutboxOnce();

  setInterval(cleanupStale, 60 * 1000).unref();
  setInterval(() => {
    replayOutboxOnce();
  }, cfg.replayIntervalMs).unref();

  startHealthServer();
  run();
}

bootstrap().catch((error) => {
  console.error('[AMI-BRIDGE] Fatal bootstrap error:', error.message);
  process.exit(1);
});
