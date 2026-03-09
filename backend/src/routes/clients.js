const express = require('express');
const { z } = require('zod');
const pool = require('../db/pool');
const { requireAuth, requireRoles } = require('../middleware/auth');

const router = express.Router();

const createClientSchema = z.object({
  name: z.string().min(2),
  support_number: z.string().optional(),
});

router.get('/', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role === 'admin') {
      const result = await pool.query(
        'SELECT id, name, support_number, created_at FROM clients ORDER BY id DESC'
      );
      return res.json(result.rows);
    }

    const result = await pool.query(
      `SELECT id, name, support_number, created_at
       FROM clients
       WHERE id = $1`,
      [req.user.client_id]
    );

    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
});

router.post('/', requireAuth, requireRoles('admin'), async (req, res, next) => {
  try {
    const payload = createClientSchema.parse(req.body);
    const result = await pool.query(
      `INSERT INTO clients (name, support_number)
       VALUES ($1, $2)
       RETURNING id, name, support_number, created_at`,
      [payload.name, payload.support_number || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid payload', details: error.errors });
    }
    return next(error);
  }
});

module.exports = router;
