'use strict';
// Pool de PostgreSQL. Lee DATABASE_URL del entorno.
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway Postgres usa SSL; en local normalmente no.
  ssl: process.env.PGSSL === 'require' || /railway|render|neon/i.test(process.env.DATABASE_URL || '')
    ? { rejectUnauthorized: false }
    : undefined,
});

pool.on('error', (err) => {
  console.error('[db] error inesperado en el pool:', err.message);
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};
