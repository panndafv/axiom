// Server settings, read once at startup from the environment (and game/.env if it exists).
// Relative paths (DB_PATH, STATIC_DIR) are resolved from the game/ folder, not the shell's cwd.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { LAMPORTS_PER_SOL } from '../shared/rules.js';

export const GAME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader: KEY=VALUE lines, # comments, optional quotes, optional `export `.
// Variables already set in the real environment win over the file.
function loadDotEnv(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    const quoted = value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0];
    if (quoted) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, ''); // trailing comment on an unquoted value
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

loadDotEnv(path.join(GAME_DIR, '.env'));

function str(name, def) {
  const v = process.env[name];
  return v === undefined ? def : v.trim();
}

function num(name, def) {
  const v = str(name, '');
  if (v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number (got "${v}")`);
  return n;
}

function bool(name, def) {
  const v = str(name, '').toLowerCase();
  if (v === '') return def;
  return v === '1' || v === 'true' || v === 'yes';
}

function solanaAddress(name) {
  const v = str(name, '');
  if (!v) return '';
  let bytes;
  try {
    bytes = bs58.decode(v);
  } catch {
    bytes = null;
  }
  if (!bytes || bytes.length !== 32) throw new Error(`${name} is not a valid Solana address`);
  return v;
}

// A wallet's 64-byte secret key: base58 (what Phantom's "Export Private Key" shows) or the JSON
// array from a solana-keygen file. The error never repeats the value.
function secretKey(name) {
  const v = str(name, '');
  if (!v) return null;
  let bytes = null;
  try {
    bytes = v.startsWith('[') ? Uint8Array.from(JSON.parse(v)) : bs58.decode(v);
  } catch {
    bytes = null;
  }
  const ok = bytes?.length === 64
    && nacl.sign.keyPair.fromSeed(bytes.slice(0, 32)).publicKey.every((b, i) => b === bytes[32 + i]);
  if (!ok) throw new Error(`${name} is not a valid wallet secret key (expected the base58 private key Phantom exports, or a keypair file's [..] array)`);
  return bytes;
}

function fromGameDir(p) {
  return path.isAbsolute(p) ? p : path.resolve(GAME_DIR, p);
}

const tokenMint = solanaAddress('TOKEN_MINT');
const poolSecretKey = secretKey('POOL_SECRET_KEY');
const keyWallet = poolSecretKey ? bs58.encode(poolSecretKey.slice(32)) : '';
const poolWallet = solanaAddress('POOL_WALLET') || keyWallet;
if (keyWallet && poolWallet !== keyWallet) throw new Error('POOL_WALLET does not match POOL_SECRET_KEY; set just one of them');
const solanaRpcUrl = str('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com');
const solanaCluster = str('SOLANA_CLUSTER', '') || (/devnet/i.test(solanaRpcUrl) ? 'devnet' : 'mainnet');
// Without a mint every wallet passes the holding check, so real SOL must never pay out that way.
if (poolSecretKey && !tokenMint && solanaCluster === 'mainnet') {
  throw new Error('POOL_SECRET_KEY pays real SOL, so it needs TOKEN_MINT set (or a devnet SOLANA_RPC_URL for testing)');
}
const dbPath = str('DB_PATH', './data/game.db');

export const config = {
  port: num('PORT', 8787),
  host: str('HOST', '0.0.0.0'),
  dbPath: dbPath === ':memory:' ? dbPath : fromGameDir(dbPath),
  gameName: str('GAME_NAME', 'Drift'),
  tokenSymbol: str('TOKEN_SYMBOL', 'DRIFT'),
  tokenMint,
  dev: !tokenMint, // no mint configured: the holding check always passes
  solanaRpcUrl,
  // Explorer links, and whether real SOL is at stake. Guessed from the RPC URL when not set.
  solanaCluster,
  minHoldUsd: num('MIN_HOLD_USD', 30),
  earnGate: num('EARN_GATE', 1500),
  poolDailyCapPct: num('POOL_DAILY_CAP_PCT', 0.1),
  poolWallet,
  poolMode: poolWallet ? 'wallet' : 'ledger',
  // With the pool wallet's key the server sends payouts itself (see payer.js).
  autoPayouts: !!poolSecretKey,
  priorityFeeMicroLamports: num('PRIORITY_FEE_MICROLAMPORTS', 10_000),
  poolReserveLamports: Math.round(num('POOL_RESERVE_SOL', 0.05) * LAMPORTS_PER_SOL),
  adminKey: str('ADMIN_KEY', ''),
  // Dev mode only: fake SOL put in an empty test pool at startup, so cash-ins can be tried
  // without the admin API. Ignored once TOKEN_MINT is set.
  seedPoolLamports: Math.round(num('SEED_POOL_SOL', 0) * LAMPORTS_PER_SOL),
  corsOrigin: str('CORS_ORIGIN', ''),
  sessionDays: num('SESSION_DAYS', 7),
  staticDir: fromGameDir(str('STATIC_DIR', './dist')),
  // Behind a reverse proxy every request comes from the proxy's address; this makes the rate
  // limiter use the client address the proxy reports in X-Forwarded-For instead.
  trustProxy: bool('TRUST_PROXY', false),
};

// Kept off the enumerable fields so the key can never end up in a log line or a JSON dump of
// the config.
Object.defineProperty(config, 'poolSecretKey', { value: poolSecretKey, enumerable: false });
