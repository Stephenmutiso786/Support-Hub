const express = require('express');
const { z } = require('zod');
const pool = require('../db/pool');
const env = require('../config/env');
const { requireAuth, requireRoles } = require('../middleware/auth');
const { hashPassword, verifyPassword, generateToken, sha256 } = require('../utils/crypto');

const router = express.Router();

const registerSchema = z.object({
  full_name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['admin', 'agent', 'client']),
  client_id: z.coerce.number().int().positive().optional(),
  agent_id: z.coerce.number().int().positive().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function sanitizeUser(row) {
  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    role: row.role,
    client_id: row.client_id,
    agent_id: row.agent_id,
    created_at: row.created_at,
  };
}

router.post('/register', async (req, res, next) => {
  try {
    const payload = registerSchema.parse(req.body);

    const userCount = await pool.query('SELECT COUNT(*)::int AS count FROM users');
    const hasUsers = userCount.rows[0].count > 0;

    if (hasUsers) {
      const tokenHeader = req.headers.authorization;
      if (!tokenHeader || !tokenHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Bearer token required to register additional users' });
      }

      const tokenHash = sha256(tokenHeader.slice('Bearer '.length).trim());
      const authResult = await pool.query(
        `SELECT u.id, u.role
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
        [tokenHash]
      );

      if (!authResult.rows[0] || authResult.rows[0].role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can register users' });
      }
    }

    if (payload.role === 'admin' && hasUsers) {
      return res.status(400).json({ error: 'Only the first user can be an unaffiliated bootstrap admin' });
    }

    if ((payload.role === 'agent' || payload.role === 'client') && !payload.client_id) {
      return res.status(400).json({ error: 'client_id is required for agent and client users' });
    }

    if (payload.role === 'agent' && !payload.agent_id) {
      return res.status(400).json({ error: 'agent_id is required for agent users' });
    }

    const passwordHash = hashPassword(payload.password);

    const created = await pool.query(
      `INSERT INTO users (client_id, agent_id, full_name, email, role, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, client_id, agent_id, full_name, email, role, created_at`,
      [
        payload.client_id || null,
        payload.agent_id || null,
        payload.full_name,
        payload.email.toLowerCase(),
        payload.role,
        passwordHash,
      ]
    );

    res.status(201).json(sanitizeUser(created.rows[0]));
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid payload', details: error.errors });
    }
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    if (error.code === '23503') {
      return res.status(400).json({ error: 'Invalid client_id or agent_id' });
    }
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const payload = loginSchema.parse(req.body);

    const result = await pool.query(
      `SELECT id, client_id, agent_id, full_name, email, role, password_hash, created_at
       FROM users
       WHERE email = $1`,
      [payload.email.toLowerCase()]
    );

    const user = result.rows[0];
    if (!user || !verifyPassword(payload.password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken();
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + env.sessionTtlHours * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt]
    );

    res.json({ token, expires_at: expiresAt.toISOString(), user: sanitizeUser(user) });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid payload', details: error.errors });
    }
    next(error);
  }
});

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    const token = req.headers.authorization.slice('Bearer '.length).trim();
    const tokenHash = sha256(token);

    await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
    res.json({ status: 'logged_out' });
  } catch (error) {
    next(error);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

router.get('/users', requireAuth, requireRoles('admin'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, client_id, agent_id, full_name, email, role, created_at
       FROM users
       ORDER BY id DESC`
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
