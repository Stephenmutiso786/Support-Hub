const express = require('express');
const { z } = require('zod');
const pool = require('../db/pool');
const { requireAuth, requireRoles } = require('../middleware/auth');

const router = express.Router();

const createAgentSchema = z.object({
  client_id: z.coerce.number().int().positive(),
  full_name: z.string().min(2),
  email: z.string().email(),
  extension: z.string().min(2),
});

router.get('/', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role === 'admin') {
      const result = await pool.query(
        `SELECT id, client_id, full_name, email, extension, status, created_at
         FROM agents
         ORDER BY id DESC`
      );
      return res.json(result.rows);
    }

    if (req.user.role === 'agent') {
      const result = await pool.query(
        `SELECT id, client_id, full_name, email, extension, status, created_at
         FROM agents
         WHERE id = $1`,
        [req.user.agent_id]
      );
      return res.json(result.rows);
    }

    const result = await pool.query(
      `SELECT id, client_id, full_name, email, extension, status, created_at
       FROM agents
       WHERE client_id = $1
       ORDER BY id DESC`,
      [req.user.client_id]
    );

    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
});

router.post('/', requireAuth, requireRoles('admin', 'client'), async (req, res, next) => {
  try {
    const payload = createAgentSchema.parse(req.body);

    if (req.user.role === 'client' && Number(req.user.client_id) !== payload.client_id) {
      return res.status(403).json({ error: 'Forbidden client scope' });
    }

    const result = await pool.query(
      `INSERT INTO agents (client_id, full_name, email, extension)
       VALUES ($1, $2, $3, $4)
       RETURNING id, client_id, full_name, email, extension, status, created_at`,
      [payload.client_id, payload.full_name, payload.email.toLowerCase(), payload.extension]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid payload', details: error.errors });
    }
    if (error.code === '23503') {
      return res.status(400).json({ error: 'Invalid client_id: client does not exist' });
    }
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    return next(error);
  }
});

router.patch('/:id/status', requireAuth, requireRoles('admin', 'agent'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid agent id' });
    }

    if (req.user.role === 'agent' && Number(req.user.agent_id) !== id) {
      return res.status(403).json({ error: 'Agents can only update their own status' });
    }

    const status = z.enum(['offline', 'available', 'busy']).parse(req.body.status);

    const result = await pool.query(
      `UPDATE agents
       SET status = $1
       WHERE id = $2
       RETURNING id, client_id, full_name, email, extension, status, created_at`,
      [status, id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid status' });
    }
    return next(error);
  }
});

module.exports = router;
