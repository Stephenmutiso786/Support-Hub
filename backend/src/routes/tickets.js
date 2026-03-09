const express = require('express');
const { z } = require('zod');
const pool = require('../db/pool');
const { requireAuth, requireRoles } = require('../middleware/auth');

const router = express.Router();

const createTicketSchema = z.object({
  client_id: z.coerce.number().int().positive(),
  call_id: z.coerce.number().int().positive().optional(),
  subject: z.string().min(3),
  description: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']).default('open'),
});

router.get('/', requireAuth, async (req, res, next) => {
  try {
    let result;
    if (req.user.role === 'admin') {
      result = await pool.query(
        `SELECT id, client_id, call_id, subject, description, priority, status, created_at, updated_at
         FROM tickets
         ORDER BY id DESC
         LIMIT 500`
      );
    } else {
      result = await pool.query(
        `SELECT id, client_id, call_id, subject, description, priority, status, created_at, updated_at
         FROM tickets
         WHERE client_id = $1
         ORDER BY id DESC
         LIMIT 500`,
        [req.user.client_id]
      );
    }

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post('/', requireAuth, requireRoles('admin', 'client', 'agent'), async (req, res, next) => {
  try {
    const payload = createTicketSchema.parse(req.body);

    if (req.user.role !== 'admin' && Number(req.user.client_id) !== payload.client_id) {
      return res.status(403).json({ error: 'Forbidden client scope' });
    }

    const result = await pool.query(
      `INSERT INTO tickets (client_id, call_id, subject, description, priority, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, client_id, call_id, subject, description, priority, status, created_at, updated_at`,
      [
        payload.client_id,
        payload.call_id || null,
        payload.subject,
        payload.description || null,
        payload.priority,
        payload.status,
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
    next(error);
  }
});

module.exports = router;
