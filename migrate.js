'use strict';
// Ejecuta las migraciones migration-*.sql (idempotentes) al arrancar.
const fs = require('fs');
const path = require('path');
const db = require('./db');

async function runMigrations() {
  const files = fs.readdirSync(__dirname)
    .filter((f) => /^migration-.*\.sql$/.test(f))
    .sort();
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    const { rows } = await db.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]).catch(async (e) => {
      // Si la tabla schema_migrations aún no existe, la crea la propia migración.
      if (e.code === '42P01') return { rows: [] };
      throw e;
    });
    if (rows.length > 0) {
      console.log(`[migrate] ${version} ya aplicada, se omite.`);
      continue;
    }
    console.log(`[migrate] aplicando ${version}...`);
    const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [version]);
      await client.query('COMMIT');
      console.log(`[migrate] ${version} aplicada.`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = { runMigrations };
