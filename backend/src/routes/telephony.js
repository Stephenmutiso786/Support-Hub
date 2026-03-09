const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const pool = require('../db/pool');
const env = require('../config/env');

const router = express.Router();

const telephonyEventSchema = z.object({
  event: z.enum(['incoming', 'ringing', 'answered', 'completed', 'hangup']),
  external_call_id: z.string().min(2),
  client_id: z.coerce.number().int().positive(),
  caller_number: z.string().min(5),
  direction: z.enum(['inbound', 'outbound']).default('inbound'),
  queue_name: z.string().optional(),
  agent_extension: z.string().optional(),
  recording_url: z.string().url().optional(),
  duration_seconds: z.coerce.number().int().nonnegative().optional(),
  hangup_cause: z.string().optional(),
  occurred_at: z.string().datetime().optional(),
});

function ensureTelephonyAuth(req, res) {
  if (!env.telephonyApiKey) {
    return true;
  }

  const incomingKey = req.headers['x-telephony-key'];
  if (incomingKey !== env.telephonyApiKey) {
    res.status(401).json({ error: 'Invalid telephony API key' });
    return false;
  }

  return true;
}

function secureCompareHex(a, b) {
  const aa = Buffer.from(String(a || ''), 'hex');
  const bb = Buffer.from(String(b || ''), 'hex');
  if (!aa.length || aa.length !== bb.length) {
    return false;
  }
  return crypto.timingSafeEqual(aa, bb);
}

function ensureTelephonySignature(req, res) {
  if (!env.telephonyWebhookSecret) {
    return true;
  }

  const tsHeader = req.headers['x-telephony-timestamp'];
  const sigHeader = req.headers['x-telephony-signature'];

  const ts = Number(tsHeader);
  if (!Number.isFinite(ts) || !sigHeader) {
    res.status(401).json({ error: 'Missing telephony signature headers' });
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 300) {
    res.status(401).json({ error: 'Stale telephony signature timestamp' });
    return false;
  }

  const rawBody = req.rawBody || JSON.stringify(req.body || {});
  const expectedSig = crypto
    .createHmac('sha256', env.telephonyWebhookSecret)
    .update(`${ts}.${rawBody}`)
    .digest('hex');

  if (!secureCompareHex(expectedSig, sigHeader)) {
    res.status(401).json({ error: 'Invalid telephony signature' });
    return false;
  }

  return true;
}

router.post('/events', async (req, res, next) => {
  try {
    if (!ensureTelephonyAuth(req, res)) {
      return;
    }
    if (!ensureTelephonySignature(req, res)) {
      return;
    }

    const payload = telephonyEventSchema.parse(req.body);
    let agentId = null;

    if (payload.agent_extension) {
      const agent = await pool.query(
        `SELECT id
         FROM agents
         WHERE client_id = $1 AND extension = $2`,
        [payload.client_id, payload.agent_extension]
      );
      if (agent.rows[0]) {
        agentId = agent.rows[0].id;
      }
    }

    const normalizedStatus =
      payload.event === 'incoming' || payload.event === 'ringing'
        ? 'ringing'
        : payload.event === 'answered'
          ? 'in-progress'
          : payload.hangup_cause === 'NO_ANSWER'
            ? 'missed'
            : 'completed';

    const endedAt = payload.event === 'completed' || payload.event === 'hangup' ? new Date() : null;

    const result = await pool.query(
      `INSERT INTO calls (
         client_id, agent_id, external_call_id, caller_number, direction, queue_name, status,
         duration_seconds, recording_url, hangup_cause, ended_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (external_call_id)
       DO UPDATE SET
         agent_id = COALESCE(EXCLUDED.agent_id, calls.agent_id),
         queue_name = COALESCE(EXCLUDED.queue_name, calls.queue_name),
         status = EXCLUDED.status,
         duration_seconds = COALESCE(EXCLUDED.duration_seconds, calls.duration_seconds),
         recording_url = COALESCE(EXCLUDED.recording_url, calls.recording_url),
         hangup_cause = COALESCE(EXCLUDED.hangup_cause, calls.hangup_cause),
         ended_at = COALESCE(EXCLUDED.ended_at, calls.ended_at)
       RETURNING id, client_id, agent_id, external_call_id, caller_number, direction,
                 queue_name, status, hangup_cause, started_at, ended_at, duration_seconds, recording_url`,
      [
        payload.client_id,
        agentId,
        payload.external_call_id,
        payload.caller_number,
        payload.direction,
        payload.queue_name || null,
        normalizedStatus,
        payload.duration_seconds || 0,
        payload.recording_url || null,
        payload.hangup_cause || null,
        endedAt,
      ]
    );

    res.status(202).json({ status: 'accepted', call: result.rows[0] });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid payload', details: error.errors });
    }
    return next(error);
  }
});

module.exports = router;
