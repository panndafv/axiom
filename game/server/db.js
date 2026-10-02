// SQLite storage. node:sqlite is synchronous and Node runs our code on one thread, so a
// transaction that never awaits cannot interleave with another request: that is what keeps
// profile and pool updates consistent without any locking of our own.

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { newProfile, sweep } from '../shared/engine.js';

// node:sqlite prints an ExperimentalWarning the moment it is loaded. Filter just that one
// message, then load the module dynamically (a static import would load it before this runs).
const emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...args) {
  const type = typeof args[0] === 'string' ? args[0] : args[0]?.type;
  const message = typeof warning === 'string' ? warning : warning?.message;
  if (type === 'ExperimentalWarning' && /SQLite/i.test(message || '')) return;
  return emitWarning.call(this, warning, ...args);
};
const { DatabaseSync } = await import('node:sqlite');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS profiles (
    wallet  TEXT PRIMARY KEY,
    data    TEXT NOT NULL,
    best    INTEGER NOT NULL DEFAULT 0,
    landed  INTEGER NOT NULL DEFAULT 0,
    updated INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS profiles_best ON profiles (best);

  CREATE TABLE IF NOT EXISTS sessions (
    token   TEXT PRIMARY KEY,
    wallet  TEXT NOT NULL,
    expires INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS nonces (
    wallet  TEXT PRIMARY KEY,
    message TEXT NOT NULL,
    expires INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pool (
    id     INTEGER PRIMARY KEY CHECK (id = 1),
    ledger INTEGER NOT NULL DEFAULT 0,
    owed   INTEGER NOT NULL DEFAULT 0,
    paid   INTEGER NOT NULL DEFAULT 0
  );
  INSERT OR IGNORE INTO pool (id) VALUES (1);

  CREATE TABLE IF NOT EXISTS pool_events (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    at       INTEGER,
    wallet   TEXT,
    kind     TEXT,
    lamports INTEGER,
    meta     TEXT
  );

  CREATE TABLE IF NOT EXISTS payouts (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet   TEXT NOT NULL,
    lamports INTEGER NOT NULL,
    status   TEXT NOT NULL DEFAULT 'pending',
    created  INTEGER NOT NULL,
    paid_at  INTEGER,
    tx       TEXT
  );
  CREATE INDEX IF NOT EXISTS payouts_wallet ON payouts (wallet, id);
  CREATE INDEX IF NOT EXISTS payouts_status ON payouts (status, id);
`;

let db = null;
let statements = new Map();

export function openDb(file = config.dbPath) {
  if (db) return db;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  // Columns added after the first release. Automatic payouts (payer.js) keep the last block
  // height a sent transaction can land at, how often it was sent, and why it failed.
  addColumn('payouts', 'last_valid', 'INTEGER');
  addColumn('payouts', 'attempts', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('payouts', 'error', 'TEXT');
  return db;
}

function addColumn(table, column, type) {
  const have = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!have) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

export function closeDb() {
  if (!db) return;
  db.close();
  db = null;
  statements = new Map();
}

export function getDb() {
  return db || openDb();
}

// Prepared statements are cached by their SQL text.
export function stmt(sql) {
  let s = statements.get(sql);
  if (!s) {
    s = getDb().prepare(sql);
    statements.set(sql, s);
  }
  return s;
}

// Runs fn inside BEGIN IMMEDIATE ... COMMIT and rolls back if it throws. fn must be synchronous.
export function tx(fn) {
  const d = getDb();
  d.exec('BEGIN IMMEDIATE');
  try {
    const out = fn(d);
    if (out && typeof out.then === 'function') throw new Error('tx() callback must not be async');
    d.exec('COMMIT');
    return out;
  } catch (err) {
    if (d.isTransaction) d.exec('ROLLBACK');
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------
// Profiles

// Fields added to newProfile() after a profile was saved get their defaults.
export function getProfile(wallet) {
  const row = stmt('SELECT data FROM profiles WHERE wallet = ?').get(wallet);
  if (!row) return null;
  const saved = JSON.parse(row.data);
  return { ...newProfile(wallet, saved.createdAt), ...saved };
}

function saveProfile(wallet, p, now) {
  stmt(`
    INSERT INTO profiles (wallet, data, best, landed, updated) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (wallet) DO UPDATE SET
      data = excluded.data, best = excluded.best, landed = excluded.landed, updated = excluded.updated
  `).run(wallet, JSON.stringify(p), p.caught || 0, p.landed, now); // column `best` holds the leaderboard score
}

// Load (or create) a player's profile, tidy it, let fn change it and save it, all in one
// transaction. Whatever fn returns is passed through. fn(profile, now) must not await.
export function withProfile(wallet, fn, now = Date.now()) {
  return tx(() => editProfile(wallet, fn, now));
}

// The same, for code that is already inside a tx().
export function editProfile(wallet, fn, now = Date.now()) {
  const p = getProfile(wallet) || newProfile(wallet, now);
  sweep(p, now);
  const out = fn(p, now);
  saveProfile(wallet, p, now);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Leaderboard

export function topScores(limit = 25) {
  return stmt("SELECT wallet, best, landed, json_extract(data, '$.name') AS name FROM profiles WHERE best > 0 ORDER BY best DESC, wallet ASC LIMIT ?")
    .all(limit);
}

// Players with the same best share a rank.
export function rankOf(wallet) {
  const row = stmt('SELECT best FROM profiles WHERE wallet = ?').get(wallet);
  if (!row || row.best <= 0) return { rank: null, best: row ? row.best : 0 };
  const { above } = stmt('SELECT COUNT(*) AS above FROM profiles WHERE best > ?').get(row.best);
  return { rank: above + 1, best: row.best };
}
