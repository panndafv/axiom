// Sign-in with a Solana wallet: the server hands out a one-time message, the wallet signs it
// (no transaction), and a valid signature gets a session token.

import { createHash, randomBytes } from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { config } from './config.js';
import { stmt, tx } from './db.js';
import { GameError } from '../shared/engine.js';

const NONCE_TTL_MS = 5 * 60_000;

function decode58(s) {
  if (typeof s !== 'string' || !s || s.length > 128) return null;
  try {
    return bs58.decode(s);
  } catch {
    return null;
  }
}

export function isWallet(s) {
  return decode58(s)?.length === 32;
}

// Only a hash of each session token is stored, so a copy of the database cannot be used to log in.
function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function purgeExpired(now) {
  stmt('DELETE FROM nonces WHERE expires < ?').run(now);
  stmt('DELETE FROM sessions WHERE expires < ?').run(now);
}

export function createNonce(wallet, now = Date.now()) {
  if (!isWallet(wallet)) throw new GameError('bad_wallet', 'That is not a valid Solana address.');
  const nonce = randomBytes(16).toString('hex');
  const message = `${config.gameName} wants you to sign in with your Solana account:\n${wallet}\n\n` +
    'Sign in to play. This is free and does not send a transaction.\n\n' +
    `Nonce: ${nonce}\nIssued At: ${new Date(now).toISOString()}`;
  tx(() => {
    purgeExpired(now);
    // One outstanding message per wallet: asking again replaces the old one.
    stmt('INSERT OR REPLACE INTO nonces (wallet, message, expires) VALUES (?, ?, ?)')
      .run(wallet, message, now + NONCE_TTL_MS);
  });
  return { message };
}

// Checks the signature and returns a new session token. The nonce is used up either way.
export function verify({ wallet, signature } = {}, now = Date.now()) {
  if (!isWallet(wallet)) throw new GameError('bad_wallet', 'That is not a valid Solana address.');
  const sig = decode58(signature);
  if (!sig || sig.length !== 64) throw new GameError('bad_signature', 'That signature is not valid.', 401);

  const row = tx(() => {
    const r = stmt('SELECT message, expires FROM nonces WHERE wallet = ?').get(wallet);
    if (r) stmt('DELETE FROM nonces WHERE wallet = ?').run(wallet);
    return r;
  });
  if (!row) throw new GameError('no_nonce', 'Sign-in request not found. Try again.', 401);
  if (row.expires < now) throw new GameError('expired', 'Sign-in request expired. Try again.', 401);

  const ok = nacl.sign.detached.verify(new TextEncoder().encode(row.message), sig, decode58(wallet));
  if (!ok) throw new GameError('bad_signature', 'That signature is not valid.', 401);

  const token = randomBytes(32).toString('hex');
  const expires = now + Math.round(config.sessionDays * 86_400_000);
  stmt('INSERT INTO sessions (token, wallet, expires) VALUES (?, ?, ?)').run(hashToken(token), wallet, expires);
  return { token, wallet, expires };
}

function bearer(req) {
  const m = /^Bearer\s+([0-9a-f]{64})$/i.exec(req.headers.authorization || '');
  return m ? m[1].toLowerCase() : null;
}

// Returns the signed-in wallet, or null when there is no valid session.
export function sessionWallet(req, now = Date.now()) {
  const token = bearer(req);
  if (!token) return null;
  const row = stmt('SELECT wallet, expires FROM sessions WHERE token = ?').get(hashToken(token));
  if (!row || row.expires < now) return null;
  return row.wallet;
}

export function requireAuth(req, now = Date.now()) {
  const wallet = sessionWallet(req, now);
  if (!wallet) throw new GameError('auth', 'Sign in with your wallet first.', 401);
  return wallet;
}

export function logout(req) {
  const token = bearer(req);
  if (token) stmt('DELETE FROM sessions WHERE token = ?').run(hashToken(token));
}
