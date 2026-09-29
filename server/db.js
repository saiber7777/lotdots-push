/**
 * Portable database layer.
 *
 * Local dev (default): SQLite via Node's built-in node:sqlite, file at SQLITE_PATH.
 *   No native build tools needed.
 * Production: set DATABASE_URL and it uses Postgres via `pg`.
 *
 * Route code always uses `?` placeholders and the async helpers below:
 *   await db.get('SELECT * FROM users WHERE email = ?', [email])
 *   await db.all('SELECT * FROM items WHERE property_id = ?', [id])
 *   const r = await db.run('INSERT INTO users(email) VALUES(?)', [email]) // r.lastID
 * The Postgres adapter rewrites `?` to $1, $2, ... automatically.
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');

const usePostgres = !!process.env.DATABASE_URL;

let pgPool = null;
let sqliteDb = null;

if (usePostgres) {
  const { Pool } = require('pg');
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
  });
} else {
  const { DatabaseSync } = require('node:sqlite');
  const sqlitePath = process.env.SQLITE_PATH || './data/app.db';
  fs.mkdirSync(path.dirname(path.resolve(sqlitePath)), { recursive: true });
  sqliteDb = new DatabaseSync(path.resolve(sqlitePath));
  sqliteDb.exec('PRAGMA journal_mode = WAL;');
  sqliteDb.exec('PRAGMA foreign_keys = ON;');
}

function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY ${usePostgres ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'crew',
  name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY ${usePostgres ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
  name TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  center_lat REAL NOT NULL DEFAULT 33.4123,
  center_lng REAL NOT NULL DEFAULT -111.5496,
  default_zoom INTEGER NOT NULL DEFAULT 15,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY ${usePostgres ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  pin_number INTEGER NOT NULL,
  area TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  photo_path TEXT,
  proof_photo_path TEXT,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS work_orders (
  id INTEGER PRIMARY KEY ${usePostgres ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTOINCREMENT'},
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  item_ids TEXT NOT NULL DEFAULT '[]',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

async function migrate() {
  // Postgres uses now() instead of datetime('now') for defaults
  const schema = usePostgres
    ? SCHEMA.replaceAll("datetime('now')", 'now()')
    : SCHEMA;
  if (usePostgres) {
    const client = await pgPool.connect();
    try {
      await client.query(schema);
    } finally {
      client.release();
    }
  } else {
    sqliteDb.exec(schema);
  }
}

async function get(sql, params = []) {
  if (usePostgres) {
    const r = await pgPool.query(toPg(sql), params);
    return r.rows[0] || null;
  }
  const row = sqliteDb.prepare(sql).get(...params);
  return row || null;
}

async function all(sql, params = []) {
  if (usePostgres) {
    const r = await pgPool.query(toPg(sql), params);
    return r.rows;
  }
  return sqliteDb.prepare(sql).all(...params);
}

async function run(sql, params = []) {
  if (usePostgres) {
    const r = await pgPool.query(toPg(sql) + ' RETURNING id', params);
    return { lastID: r.rows[0] ? r.rows[0].id : null, changes: r.rowCount };
  }
  const info = sqliteDb.prepare(sql).run(...params);
  return { lastID: Number(info.lastInsertRowid), changes: info.changes };
}

module.exports = { db: { get, all, run, migrate }, usePostgres };
