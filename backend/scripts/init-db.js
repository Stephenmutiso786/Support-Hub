const fs = require('fs');
const path = require('path');
const pool = require('../src/db/pool');

async function main() {
  const filePath = path.join(__dirname, '..', 'src', 'db', 'init.sql');
  const sql = fs.readFileSync(filePath, 'utf8');
  await pool.query(sql);
  await pool.end();
  console.log('Database initialized successfully.');
}

main().catch((error) => {
  console.error('Failed to initialize database:', error);
  process.exit(1);
});
