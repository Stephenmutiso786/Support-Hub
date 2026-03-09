const express = require('express');
const { z } = require('zod');
const pool = require('../db/pool');
const { requireAuth, requireRoles } = require('../middleware/auth');

const router = express.Router();

const createCallSchema = z.object({
  client_id: z.coerce.number().int().positive(),
  agent_id: z.coerce.number().int().positive().optional(),
  external_call_id: z.string().min(2).optional(),
  caller_number: z.string().min(5),
  direction: z.enum(['inbound', 'outbound']).default('inbound'),
  queue_name: z.string().optional(),
  status: z.enum(['ringing', 'in-progress', 'completed', 'missed']).default('completed'),
  duration_seconds: z.coerce.number().int().nonnegative().default(0),
  recording_url: z.string().url().optional(),
  hangup_cause: z.string().optional(),
});

router.get('/', requireAuth, async (req, res, next) => {
  try {
    let result;

    if (req.user.role === 'admin') {
      result = await pool.query(
        `SELECT id, client_id, agent_id, external_call_id, caller_number, direction, queue_name,
                status, hangup_cause, started_at, ended_at, duration_seconds, recording_url
         FROM calls
         ORDER BY id DESC
         LIMIT 500`
      );
      return res.json(result.rows);
    }

    if (req.user.role === 'agent') {
      result = await pool.query(
        `SELECT id, client_id, agent_id, external_call_id, caller_number, direction, queue_name,
                status, hangup_cause, started_at, ended_at, duration_seconds, recording_url
         FROM calls
         WHERE client_id = $1 AND agent_id = $2
         ORDER BY id DESC
         LIMIT 500`,
        [req.user.client_id, req.user.agent_id]
      );
      return res.json(result.rows);
    }

    result = await pool.query(
      `SELECT id, client_id, agent_id, external_call_id, caller_number, direction, queue_name,
              status, hangup_cause, started_at, ended_at, duration_seconds, recording_url
       FROM calls
       WHERE client_id = $1
       ORDER BY id DESC
       LIMIT 500`,
      [req.user.client_id]
    );

    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
});

router.post('/', requireAuth, requireRoles('admin', 'client', 'agent'), async (req, res, next) => {
  try {
    const payload = createCallSchema.parse(req.body);

    if (req.user.role !== 'admin' && Number(req.user.client_id) !== payload.client_id) {
      return res.status(403).json({ error: 'Forbidden client scope' });
    }

    if (req.user.role === 'agent') {
      if (payload.agent_id && Number(payload.agent_id) !== Number(req.user.agent_id)) {
        return res.status(403).json({ error: 'Agents can only create their own calls' });
      }
      payload.agent_id = Number(req.user.agent_id);
    }

    const endedAt = payload.status === 'completed' || payload.status === 'missed' ? new Date() : null;

    const result = await pool.query(
      `INSERT INTO calls (
         client_id, agent_id, external_call_id, caller_number, direction, queue_name, status,
         duration_seconds, recording_url, hangup_cause, ended_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, client_id, agent_id, external_call_id, caller_number, direction, queue_name,
                 status, hangup_cause, started_at, ended_at, duration_seconds, recording_url`,
      [
        payload.client_id,
        payload.agent_id || null,
        payload.external_call_id || null,
        payload.caller_number,
        payload.direction,
        payload.queue_name || null,
        payload.status,
        payload.duration_seconds,
        payload.recording_url || null,
        payload.hangup_cause || null,
        endedAt,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid payload', details: error.errors });
    }
    if (error.code === '23503') {
      return res.status(400).json({ error: 'Invalid foreign key in payload' });
    }
    if (error.code === '23505') {
      return res.status(409).json({ error: 'external_call_id already exists' });
    }
    return next(error);
  }
});

module.exports = router;
