const pool = require('../src/db/pool');

async function main() {
  await pool.query('TRUNCATE TABLE sessions, users, tickets, calls, agents, clients RESTART IDENTITY CASCADE');
  await pool.end();
  console.log('Database reset complete.');
}

main().catch((error) => {
  console.error('Database reset failed:', error);
  process.exit(1);
});
