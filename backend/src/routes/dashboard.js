const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/summary', requireAuth, async (req, res, next) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const params = [];
    const whereClient = isAdmin ? '' : 'WHERE client_id = $1';

    if (!isAdmin) {
      params.push(req.user.client_id);
    }

    const [callsCount, ticketsCount, clientsCount, agentsCount, recentCalls] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS value FROM calls ${whereClient}`, params),
      pool.query(`SELECT COUNT(*)::int AS value FROM tickets ${whereClient}`, params),
      isAdmin
        ? pool.query('SELECT COUNT(*)::int AS value FROM clients')
        : Promise.resolve({ rows: [{ value: 1 }] }),
      pool.query(
        isAdmin
          ? 'SELECT COUNT(*)::int AS value FROM agents'
          : 'SELECT COUNT(*)::int AS value FROM agents WHERE client_id = $1',
        isAdmin ? [] : [req.user.client_id]
      ),
      pool.query(
        `SELECT id, client_id, agent_id, caller_number, status, started_at, duration_seconds
         FROM calls
         ${whereClient}
         ORDER BY id DESC
         LIMIT 8`,
        params
      ),
    ]);

    res.json({
      totals: {
        clients: clientsCount.rows[0].value,
        agents: agentsCount.rows[0].value,
        calls: callsCount.rows[0].value,
        tickets: ticketsCount.rows[0].value,
      },
      recent_calls: recentCalls.rows,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
