// HTTP API for wallet players, plus static hosting of the built client (dist/).
//
// Every profile change happens inside withProfile(), which is one synchronous SQLite transaction.
// Anything async (RPC holding check, pool wallet balance) is awaited *before* it starts.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { openDb, closeDb, withProfile, topScores, rankOf } from './db.js';
import * as auth from './auth.js';
import * as pool from './pool.js';
import { holding } from './solana.js';
import * as engine from '../shared/engine.js';
import { GameError } from '../shared/engine.js';
import { SHOP } from '../shared/rules.js';

const BODY_LIMIT = 16 * 1024;
const RATE_PER_SEC = 30;
const RATE_BURST = 60;

// ---------------------------------------------------------------------------------------------
// Small helpers

function badRequest(message) {
  return new GameError('bad_request', message, 400);
}

function needString(body, key, max = 64) {
  const v = body[key];
  if (typeof v !== 'string' || !v || v.length > max) throw badRequest(`${key} is required.`);
  return v;
}

function needFishIds(body) {
  const ids = body.fishIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || !ids.every(Number.isSafeInteger)) {
    throw badRequest('fishIds must be a list of fish ids.');
  }
  return ids;
}

// Validates { kind, id } for the shop. Only own keys count: otherwise an id like "constructor"
// would find a function on Object.prototype and the engine would treat it as an item.
function shopItem(body, { allowNoBait = false } = {}) {
  const { kind, id } = body;
  if (typeof kind !== 'string' || !Object.hasOwn(SHOP, kind)) throw badRequest('kind must be rod, bait or outfit.');
  if (allowNoBait && kind === 'bait' && id === null) return { kind, id };
  if (typeof id !== 'string' || !Object.hasOwn(SHOP[kind], id)) throw new GameError('not_found', 'That is not in the shop.');
  return { kind, id };
}

function shortWallet(w) {
  return `${w.slice(0, 4)}…${w.slice(-4)}`;
}

function sameSecret(given, expected) {
  // Hashing first gives equal-length buffers, so timingSafeEqual never throws or leaks the length.
  const a = createHash('sha256').update(String(given ?? '')).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

// Runs fn(profile, now) in a profile transaction and adds the updated public profile.
function play(wallet, fn) {
  return withProfile(wallet, (p, now) => ({ ...fn(p, now), profile: engine.publicProfile(p, now) }));
}

// Route wrappers: user() passes the signed-in wallet, admin() checks x-admin-key.
const user = (fn) => (ctx) => fn(auth.requireAuth(ctx.req), ctx);

const admin = (fn) => (ctx) => {
  if (!config.adminKey) throw new GameError('not_found', 'No such endpoint.', 404);
  if (!sameSecret(ctx.req.headers['x-admin-key'], config.adminKey)) {
    throw new GameError('admin', 'Wrong or missing admin key.', 401);
  }
  return fn(ctx);
};

// ---------------------------------------------------------------------------------------------
// Routes. Handlers get { req, query, body, params } and return the JSON to send.

const routes = {
  'GET /api/health': () => ({ ok: true }),

  'GET /api/config': () => ({
    gameName: config.gameName,
    tokenSymbol: config.tokenSymbol,
    tokenMint: config.tokenMint,
    minHoldUsd: config.minHoldUsd,
    earnGate: config.earnGate,
    poolMode: config.poolMode,
    dev: config.dev,
  }),

  // --- sign-in

  'GET /api/auth/nonce': ({ query }) => auth.createNonce(query.get('wallet')),

  'POST /api/auth/verify': async ({ body }) => {
    const { token, wallet } = auth.verify(body);
    const h = await holding(wallet);
    const profile = withProfile(wallet, (p, now) => engine.publicProfile(p, now));
    return { token, profile, holding: h };
  },

  'POST /api/auth/logout': user((wallet, { req }) => {
    auth.logout(req);
    return { ok: true };
  }),

  'GET /api/me': user(async (wallet) => {
    const h = await holding(wallet);
    const profile = withProfile(wallet, (p, now) => engine.publicProfile(p, now));
    return { profile, holding: h };
  }),

  'GET /api/holding': user(async (wallet, { query }) => ({
    holding: await holding(wallet, { force: query.get('force') === '1' }),
  })),

  // --- runs

  'POST /api/run/start': user((wallet) => play(wallet, (p, now) => ({ run: engine.startRun(p, now) }))),

  'POST /api/run/cast': user((wallet, { body }) => {
    const runId = needString(body, 'runId');
    return play(wallet, (p, now) => engine.cast(p, runId, now));
  }),

  'POST /api/run/land': user((wallet, { body }) => {
    const runId = needString(body, 'runId');
    const castId = needString(body, 'castId');
    // engine.land clears the cast before throwing oil_out, so keep that change instead of
    // rolling it back (otherwise the dead cast blocks banking for the rest of the run).
    const out = withProfile(wallet, (p, now) => {
      try {
        return { ...engine.land(p, runId, castId, now), profile: engine.publicProfile(p, now) };
      } catch (err) {
        if (err instanceof GameError && err.code === 'oil_out') return { failed: err };
        throw err;
      }
    });
    if (out.failed) throw out.failed;
    return out;
  }),

  'POST /api/run/lose': user((wallet, { body }) => {
    const runId = needString(body, 'runId');
    const castId = needString(body, 'castId');
    const { reason } = body;
    if (!['snap', 'escape', 'cancel'].includes(reason)) throw badRequest('reason must be snap, escape or cancel.');
    return play(wallet, (p, now) => engine.lose(p, runId, castId, reason, now));
  }),

  'POST /api/run/bank': user((wallet, { body }) => {
    const runId = needString(body, 'runId');
    return play(wallet, (p, now) => engine.bank(p, runId, now));
  }),

  'POST /api/run/end': user((wallet, { body }) => {
    const runId = needString(body, 'runId');
    return play(wallet, (p, now) => ({ results: engine.endRun(p, runId, now) }));
  }),

  // --- shop

  'POST /api/shop/sell': user((wallet, { body }) => {
    const fishIds = needFishIds(body);
    return play(wallet, (p) => engine.sell(p, fishIds));
  }),

  'POST /api/shop/buy': user((wallet, { body }) => {
    const { kind, id } = shopItem(body);
    return play(wallet, (p) => {
      engine.buy(p, kind, id);
      return {};
    });
  }),

  'POST /api/shop/equip': user((wallet, { body }) => {
    const { kind, id } = shopItem(body, { allowNoBait: true });
    return play(wallet, (p) => {
      engine.equip(p, kind, id);
      return {};
    });
  }),

  // --- reward pool

  'GET /api/pool': async () => {
    await pool.refresh();
    return pool.summary();
  },

  'POST /api/pool/exchange': user(async (wallet, { body }) => {
    const fishIds = needFishIds(body);
    let h = await holding(wallet);
    if (!h.ok) h = await holding(wallet, { force: true }); // they may have just bought
    if (!h.ok) {
      const err = new GameError('hold',
        h.error || `Hold at least $${config.minHoldUsd} of $${config.tokenSymbol} to exchange fish.`, 403);
      err.extra = { holding: h };
      throw err;
    }
    await pool.refresh();
    const out = withProfile(wallet, (p, now) => {
      const result = engine.exchange(p, fishIds, pool.available(), {
        now,
        dailyCapPct: config.poolDailyCapPct,
        earnGate: config.earnGate,
      });
      pool.recordExchange(wallet, result, now);
      return { items: result.items, total: result.total, capped: result.capped, profile: engine.publicProfile(p, now) };
    });
    return { ...out, pool: pool.summary() };
  }),

  'POST /api/pool/claim': user((wallet) => withProfile(wallet, (p, now) => {
    const { amount } = engine.claim(p);
    const payout = pool.recordClaim(wallet, amount, now);
    return { payout, profile: engine.publicProfile(p, now) };
  })),

  'GET /api/payouts': user((wallet) => ({ payouts: pool.payoutsFor(wallet, 20) })),

  'GET /api/leaderboard': ({ req }) => {
    const top = topScores(25).map((r) => ({ name: shortWallet(r.wallet), best: r.best, landed: r.landed }));
    const wallet = auth.sessionWallet(req);
    return wallet ? { top, me: { name: shortWallet(wallet), ...rankOf(wallet) } } : { top };
  },

  // --- admin

  'GET /api/admin/pool': admin(async () => {
    await pool.refresh();
    return pool.adminState();
  }),

  'POST /api/admin/pool': admin(async ({ body }) => {
    const n = body.addLamports;
    if (!Number.isSafeInteger(n) || n === 0) throw badRequest('addLamports must be a non-zero whole number of lamports.');
    pool.deposit(n);
    return pool.adminState();
  }),

  'GET /api/admin/payouts': admin(({ query }) => {
    const status = query.get('status') || '';
    if (status && status !== 'pending' && status !== 'paid') throw badRequest('status must be pending or paid.');
    return { payouts: pool.listPayouts(status) };
  }),
};

// Routes with a path parameter.
const paramRoutes = [
  {
    method: 'POST',
    pattern: /^\/api\/admin\/payouts\/(\d+)$/,
    handler: admin(({ body, params }) => {
      const txSig = needString(body, 'tx', 200);
      const payout = pool.markPaid(Number(params[0]), txSig);
      return { payout, pool: pool.summary() };
    }),
  },
];

function findRoute(method, pathname) {
  const exact = routes[`${method} ${pathname}`];
  if (exact) return { handler: exact, params: [] };
  for (const r of paramRoutes) {
    const m = r.method === method && r.pattern.exec(pathname);
    if (m) return { handler: r.handler, params: m.slice(1) };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Request plumbing

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function sendError(res, err) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (err instanceof GameError) {
    const headers = err.status === 429 ? { 'retry-after': '1' } : {};
    sendJson(res, err.status || 400, { error: err.code, message: err.message, ...err.extra }, headers);
    return;
  }
  console.error(err);
  sendJson(res, 500, { error: 'server', message: 'Something went wrong.' });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => new GameError('too_large', 'Request body is too large.', 413);
    if (Number(req.headers['content-length'] || 0) > BODY_LIMIT) return reject(tooLarge());
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return; // keep draining, but ignore the rest
      size += chunk.length;
      if (size > BODY_LIMIT) {
        failed = true;
        reject(tooLarge());
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (failed) return;
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) return resolve({});
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        return reject(new GameError('bad_json', 'The request body is not valid JSON.', 400));
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return reject(new GameError('bad_json', 'The request body must be a JSON object.', 400));
      }
      resolve(body);
    });
    req.on('error', reject);
  });
}

// Token bucket per client address.
const buckets = new Map();

function allowRequest(ip, now = Date.now()) {
  let b = buckets.get(ip);
  if (!b) {
    b = { tokens: RATE_BURST, at: now };
    buckets.set(ip, b);
  }
  b.tokens = Math.min(RATE_BURST, b.tokens + ((now - b.at) / 1000) * RATE_PER_SEC);
  b.at = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

function forgetIdleBuckets() {
  // An idle bucket refills within a couple of seconds, so there is nothing to remember.
  const now = Date.now();
  for (const [ip, b] of buckets) if (now - b.at > 10_000) buckets.delete(ip);
}

function clientIp(req) {
  if (config.trustProxy) {
    // The last entry is the one our own proxy added; earlier ones can be forged by the client.
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (fwd.length) return fwd.at(-1);
  }
  return req.socket.remoteAddress || 'unknown';
}

function corsHeaders() {
  if (!config.corsOrigin) return {};
  return {
    'access-control-allow-origin': config.corsOrigin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'Authorization, Content-Type',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

async function handleApi(req, res, url) {
  for (const [k, v] of Object.entries(corsHeaders())) res.setHeader(k, v);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (!allowRequest(clientIp(req))) throw new GameError('rate_limit', 'Slow down a little.', 429);
  const route = findRoute(req.method, url.pathname);
  if (!route) throw new GameError('not_found', 'No such endpoint.', 404);
  const body = req.method === 'POST' ? await readJson(req) : {};
  const out = await route.handler({ req, query: url.searchParams, body, params: route.params });
  sendJson(res, 200, out);
}

// ---------------------------------------------------------------------------------------------
// Static files (the Vite build)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
};

function sendText(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

function statFile(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed');
  const root = config.staticDir;
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return sendText(res, 400, 'Bad request');
  }
  // No null bytes, no dotfiles, nothing outside the static folder.
  if (rel.includes('\0') || rel.split('/').some((part) => part.startsWith('.'))) {
    return sendText(res, 404, 'Not found');
  }
  let file = path.resolve(root, `.${rel}`);
  if (file !== root && !file.startsWith(root + path.sep)) return sendText(res, 404, 'Not found');

  let stat = statFile(file);
  if (stat?.isDirectory()) {
    file = path.join(file, 'index.html');
    stat = statFile(file);
  }
  if (!stat?.isFile()) {
    // Client-side routes get the app; a missing file (it has an extension) is a real 404.
    if (path.extname(rel)) return sendText(res, 404, 'Not found');
    file = path.join(root, 'index.html');
    stat = statFile(file);
    if (!stat?.isFile()) return sendText(res, 404, 'Not found');
  }

  const immutable = rel.startsWith('/assets/');
  const lastModified = new Date(Math.floor(stat.mtimeMs / 1000) * 1000);
  const headers = {
    'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'last-modified': lastModified.toUTCString(),
  };
  const since = Date.parse(req.headers['if-modified-since'] || '');
  if (!immutable && since >= lastModified.getTime()) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  res.writeHead(200, { ...headers, 'content-length': stat.size });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

// ---------------------------------------------------------------------------------------------
// Server

async function handle(req, res) {
  res.setHeader('x-content-type-options', 'nosniff');
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return sendText(res, 400, 'Bad request');
  }
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  return serveStatic(req, res, url);
}

// Builds the HTTP server (opening the database if it is not open yet) without listening.
export function createServer() {
  openDb();
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => sendError(res, err));
  });
  const sweeper = setInterval(forgetIdleBuckets, 60_000);
  sweeper.unref();
  server.on('close', () => clearInterval(sweeper));
  return server;
}

// Opens the database at dbPath and listens. port 0 picks a free port (handy for tests).
export async function startServer({ port = config.port, host = config.host, dbPath = config.dbPath, log = true } = {}) {
  openDb(dbPath);
  const seeded = pool.seedTestPool(config.seedPoolLamports);
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const actualPort = server.address().port;
  const shownHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  const url = `http://${shownHost}:${actualPort}`;
  if (log) {
    const staticNote = fs.existsSync(config.staticDir) ? `serving ${config.staticDir}` : 'no client build (API only)';
    const devNote = config.dev ? 'ON (no TOKEN_MINT, holding check always passes)' : 'off';
    console.log(`${config.gameName} server at ${url} | pool mode: ${config.poolMode} | dev mode: ${devNote} | ${staticNote}`);
    if (seeded) console.log(`Test pool seeded with ${seeded / 1e9} fake SOL (SEED_POOL_SOL).`);
  }
  const close = () => new Promise((resolve) => {
    server.close(() => {
      closeDb();
      resolve();
    });
    server.closeAllConnections();
  });
  return { server, url, port: actualPort, close };
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  const app = await startServer();
  const stop = () => app.close().then(() => process.exit(0));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
