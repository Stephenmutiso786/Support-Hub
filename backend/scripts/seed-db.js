const pool = require('../src/db/pool');
const { hashPassword } = require('../src/utils/crypto');

async function main() {
  const client = await pool.query(
    `INSERT INTO clients (name, support_number)
     VALUES ($1, $2)
     RETURNING id`,
    ['Acme CX', '1001']
  );

  const clientId = client.rows[0].id;

  const agent = await pool.query(
    `INSERT INTO agents (client_id, full_name, email, extension, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [clientId, 'Agent One', 'agent1@acme.local', '1001', 'available']
  );

  const agentId = agent.rows[0].id;

  await pool.query(
    `INSERT INTO users (client_id, agent_id, full_name, email, role, password_hash)
     VALUES
       ($1, NULL, 'Admin User', 'admin@supporthub.local', 'admin', $2),
       ($1, NULL, 'Client Manager', 'manager@acme.local', 'client', $3),
       ($1, $4, 'Agent One', 'agent@acme.local', 'agent', $5)`,
    [
      clientId,
      hashPassword('AdminPass123!'),
      hashPassword('ManagerPass123!'),
      agentId,
      hashPassword('AgentPass123!'),
    ]
  );

  await pool.query(
    `INSERT INTO calls (
      client_id, agent_id, external_call_id, caller_number, direction, queue_name,
      status, duration_seconds, recording_url, ended_at
    ) VALUES ($1, $2, $3, $4, 'inbound', 'general', 'completed', 95, $5, NOW())`,
    [
      clientId,
      agentId,
      'seed-call-0001',
      '+12025550000',
      'https://recordings.example.com/seed-call-0001.wav',
    ]
  );

  await pool.query(
    `INSERT INTO tickets (client_id, subject, description, priority, status)
     VALUES ($1, $2, $3, $4, $5)`,
    [clientId, 'Payment not reflected', 'Customer reports charge but no activation', 'high', 'open']
  );

  await pool.end();
  console.log('Database seeded successfully.');
  console.log('Admin login: admin@supporthub.local / AdminPass123!');
}

main().catch((error) => {
  console.error('Database seed failed:', error);
  process.exit(1);
});
