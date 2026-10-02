// End-to-end API tests: a real server on a random port with a throwaway database.
// TOKEN_MINT is empty, so the holding check runs in dev mode and never touches the network.
// Anything that needs real time to pass (reel timing, daily cap) is covered in engine.test.js.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { poolPayout } from '../shared/rules.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pier-test-'));
const dist = path.join(tmp, 'dist');
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>pier</title>');
fs.writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log("hi")');

// Config is read when the server modules load, so set it first. These also beat anything in a
// local game/.env, because real environment variables win over the file.
Object.assign(process.env, {
  DB_PATH: path.join(tmp, 'game.db'),
  STATIC_DIR: dist,
  TOKEN_MINT: '',
  POOL_WALLET: '',
  ADMIN_KEY: 'test-admin-key',
  CORS_ORIGIN: '',
  EARN_GATE: '1500',
  POOL_DAILY_CAP_PCT: '0.05',
  TRUST_PROXY: '1', // lets each request below claim its own address, so the rate limit stays out of the way
});
const { startServer } = await import('../server/index.js');
const { withProfile } = await import('../server/db.js');

const SOL = 1_000_000_000;
const ADMIN = { 'x-admin-key': 'test-admin-key' };
let app;

before(async () => {
  app = await startServer({ port: 0, host: '127.0.0.1', log: false });
});

after(async () => {
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Every request gets its own forwarded address unless the test sets one.
let requestCount = 0;
function nextIp() {
  requestCount++;
  return `10.0.${Math.floor(requestCount / 250)}.${requestCount % 250}`;
}

async function api(method, pathname, { body, token, headers = {} } = {}) {
  const h = { 'x-forwarded-for': nextIp(), ...headers };
  if (body !== undefined) h['content-type'] = 'application/json';
  if (token) h.authorization = `Bearer ${token}`;
  const res = await fetch(app.url + pathname, {
    method,
    headers: h,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON (static files)
  }
  return { status: res.status, body: json, text, headers: res.headers };
}

// A raw request, so the path reaches the server exactly as written (fetch would normalise it).
function rawGet(pathname) {
  return new Promise((resolve, reject) => {
    const { port } = new URL(app.url);
    http.get({ host: '127.0.0.1', port, path: pathname }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    }).on('error', reject);
  });
}

function sign(message, kp) {
  return bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
}

async function signIn(kp = nacl.sign.keyPair()) {
  const wallet = bs58.encode(kp.publicKey);
  const nonce = await api('GET', `/api/auth/nonce?wallet=${wallet}`);
  assert.equal(nonce.status, 200);
  const res = await api('POST', '/api/auth/verify', { body: { wallet, signature: sign(nonce.body.message, kp) } });
  assert.equal(res.status, 200, res.text);
  return { wallet, kp, token: res.body.token, res, message: nonce.body.message };
}

// Shared player for the tests below (they run in order).
let player;

test('health and config', async () => {
  const health = await api('GET', '/api/health');
  assert.deepEqual(health.body, { ok: true });

  const cfg = await api('GET', '/api/config');
  assert.equal(cfg.status, 200);
  assert.equal(cfg.body.dev, true);
  assert.equal(cfg.body.poolMode, 'ledger');
  assert.equal(cfg.body.tokenMint, '');
  assert.equal(cfg.body.earnGate, 1500);
  assert.equal(typeof cfg.body.minHoldUsd, 'number');
});

test('sign in: nonce, signature, session token', async () => {
  const cfg = (await api('GET', '/api/config')).body;
  player = await signIn();
  const { wallet, res, message } = player;

  assert.ok(message.startsWith(`Sign in to ${cfg.gameName}\n\nWallet: ${wallet}\n`));
  // the Sign In With Solana header makes Phantom check it as a domain and block the request
  assert.ok(!/wants you to sign in/.test(message));
  assert.match(message, /\nSite: 127\.0\.0\.1:\d+\n/);
  assert.match(message, /\nNonce: [0-9a-f]+\nIssued: \d{4}-\d\d-\d\dT/);
  assert.match(res.body.token, /^[0-9a-f]{64}$/);
  assert.equal(res.body.profile.id, wallet);
  assert.equal(res.body.profile.rod, 'driftwood');
  assert.equal(res.body.holding.ok, true);
  assert.equal(res.body.holding.dev, true);

  // The nonce is single use.
  const replay = await api('POST', '/api/auth/verify', { body: { wallet, signature: sign(message, player.kp) } });
  assert.equal(replay.status, 401);
  assert.equal(replay.body.error, 'no_nonce');
});

test('sign in rejects a bad wallet and a signature from another key', async () => {
  const bad = await api('GET', '/api/auth/nonce?wallet=not-a-wallet');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'bad_wallet');

  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);
  const { body: { message } } = await api('GET', `/api/auth/nonce?wallet=${wallet}`);
  const forged = await api('POST', '/api/auth/verify', { body: { wallet, signature: sign(message, nacl.sign.keyPair()) } });
  assert.equal(forged.status, 401);
  assert.equal(forged.body.error, 'bad_signature');
});

test('/api/me needs a session', async () => {
  const anon = await api('GET', '/api/me');
  assert.equal(anon.status, 401);
  assert.equal(anon.body.error, 'auth');

  const junk = await api('GET', '/api/me', { token: 'f'.repeat(64) });
  assert.equal(junk.status, 401);

  const me = await api('GET', '/api/me', { token: player.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.profile.id, player.wallet);
  assert.equal(me.body.holding.ok, true);

  const h = await api('GET', '/api/holding?force=1', { token: player.token });
  assert.equal(h.body.holding.ok, true);
});

test('run: start, cast, a too-fast land is refused, cancel, end', async () => {
  const { token } = player;
  const start = await api('POST', '/api/run/start', { token });
  assert.equal(start.status, 200);
  const runId = start.body.run.id;
  assert.ok(runId);
  assert.equal(start.body.profile.run.id, runId);

  const cast = await api('POST', '/api/run/cast', { token, body: { runId } });
  assert.equal(cast.status, 200);
  assert.ok(cast.body.castId);
  assert.ok(cast.body.biteInMs > 0);
  assert.equal(typeof cast.body.fight.difficulty, 'number');
  assert.equal(cast.body.profile.run.cast.id, cast.body.castId);
  assert.equal(cast.body.profile.run.cast.sp, undefined);
  assert.equal(cast.body.sp, undefined, 'the species stays secret until landed');

  const busy = await api('POST', '/api/run/cast', { token, body: { runId } });
  assert.equal(busy.body.error, 'busy');

  const land = await api('POST', '/api/run/land', { token, body: { runId, castId: cast.body.castId } });
  assert.equal(land.status, 400);
  assert.equal(land.body.error, 'too_fast');

  const lose = await api('POST', '/api/run/lose', { token, body: { runId, castId: cast.body.castId, reason: 'cancel' } });
  assert.equal(lose.status, 200);
  assert.equal(lose.body.reason, 'cancel');
  assert.equal(lose.body.profile.run.cast, null);
  assert.ok(lose.body.profile.run.readyInMs > 0, "a cancelled cast blocks the line until it could have been landed");

  const badReason = await api('POST', '/api/run/lose', { token, body: { runId, castId: 'x', reason: 'nope' } });
  assert.equal(badReason.status, 400);

  const bank = await api('POST', '/api/run/bank', { token, body: { runId } });
  assert.equal(bank.status, 400);
  assert.equal(bank.body.error, 'empty');

  const end = await api('POST', '/api/run/end', { token, body: { runId } });
  assert.equal(end.status, 200);
  assert.equal(end.body.results.score, 0);
  assert.equal(end.body.profile.run, null);
  assert.equal(end.body.profile.runs, 1);

  const stale = await api('POST', '/api/run/cast', { token, body: { runId } });
  assert.equal(stale.body.error, 'no_run');
});

test('bad input is rejected cleanly', async () => {
  const { token } = player;
  const badJson = await api('POST', '/api/run/cast', { token, body: '{"runId": ' });
  assert.equal(badJson.status, 400);
  assert.equal(badJson.body.error, 'bad_json');

  const missing = await api('POST', '/api/run/cast', { token, body: {} });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, 'bad_request');

  const huge = await api('POST', '/api/shop/sell', { token, body: { fishIds: [1], pad: 'x'.repeat(20_000) } });
  assert.equal(huge.status, 413);

  // Prototype keys must not count as shop items.
  for (const id of ['constructor', '__proto__', 'toString']) {
    const r = await api('POST', '/api/shop/buy', { token, body: { kind: 'rod', id } });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'not_found');
  }
  const broke = await api('POST', '/api/shop/buy', { token, body: { kind: 'rod', id: 'bamboo' } });
  assert.equal(broke.body.error, 'broke');

  const me = await api('GET', '/api/me', { token });
  assert.equal(me.body.profile.cash, 0);

  const nope = await api('GET', '/api/nope');
  assert.equal(nope.status, 404);
  assert.equal(nope.body.error, 'not_found');
});

test('shop: sell, buy and equip', async () => {
  const { token, wallet } = player;
  withProfile(wallet, (p, now) => {
    p.storage.push({ id: p.nextFishId++, sp: 'ape_angler', kg: 5, value: 450, at: now });
  });
  const fishId = (await api('GET', '/api/me', { token })).body.profile.storage[0].id;

  const sold = await api('POST', '/api/shop/sell', { token, body: { fishIds: [fishId] } });
  assert.equal(sold.status, 200);
  assert.deepEqual([sold.body.sold, sold.body.cash], [1, 450]);
  assert.equal(sold.body.profile.cash, 450);

  const bought = await api('POST', '/api/shop/buy', { token, body: { kind: 'rod', id: 'bamboo' } });
  assert.equal(bought.status, 200);
  assert.equal(bought.body.profile.rod, 'bamboo');
  assert.equal(bought.body.profile.cash, 50);

  const bait = await api('POST', '/api/shop/buy', { token, body: { kind: 'bait', id: 'worm' } });
  assert.equal(bait.body.profile.bait, 'worm');
  assert.equal(bait.body.profile.baits.worm, 10);

  const unbait = await api('POST', '/api/shop/equip', { token, body: { kind: 'bait', id: null } });
  assert.equal(unbait.status, 200);
  assert.equal(unbait.body.profile.bait, null);

  const equip = await api('POST', '/api/shop/equip', { token, body: { kind: 'rod', id: 'driftwood' } });
  assert.equal(equip.body.profile.rod, 'driftwood');
});

test('pool: admin deposit, exchange, claim, payout marked paid', async () => {
  const { token, wallet } = player;
  const empty = await api('GET', '/api/pool');
  assert.equal(empty.status, 200);
  assert.equal(empty.body.mode, 'ledger');
  assert.equal(empty.body.availableLamports, 0);

  assert.equal((await api('GET', '/api/admin/pool')).status, 401);
  assert.equal((await api('GET', '/api/admin/pool', { headers: { 'x-admin-key': 'wrong' } })).status, 401);
  const badDeposit = await api('POST', '/api/admin/pool', { headers: ADMIN, body: { addLamports: 1.5 } });
  assert.equal(badDeposit.status, 400);

  const deposit = await api('POST', '/api/admin/pool', { headers: ADMIN, body: { addLamports: SOL } });
  assert.equal(deposit.status, 200);
  assert.equal(deposit.body.ledgerLamports, SOL);

  const funded = (await api('GET', '/api/pool')).body;
  assert.equal(funded.availableLamports, SOL);
  const rare = funded.rarities.find((r) => r.id === 'rare');
  assert.equal(rare.lamportsPerFish, poolPayout('rare', SOL));
  assert.equal(funded.rarities.find((r) => r.id === 'common').lamportsPerFish, 0);

  // Below the earn gate, the pool stays locked.
  withProfile(wallet, (p, now) => {
    p.storage.push({ id: p.nextFishId++, sp: 'pump_puffer', kg: 1, value: 70, at: now });
    p.storage.push({ id: p.nextFishId++, sp: 'moon_marlin', kg: 100, value: 1700, at: now });
  });
  const ids = (await api('GET', '/api/me', { token })).body.profile.storage.map((f) => f.id);
  const gated = await api('POST', '/api/pool/exchange', { token, body: { fishIds: [ids[0]] } });
  assert.equal(gated.status, 403);
  assert.equal(gated.body.error, 'gate');

  withProfile(wallet, (p) => { p.lifetimeCash = 2_000; });
  const ex1 = await api('POST', '/api/pool/exchange', { token, body: { fishIds: [ids[0]] } });
  assert.equal(ex1.status, 200, ex1.text);
  const pay1 = poolPayout('rare', SOL);
  assert.equal(ex1.body.total, pay1);
  assert.equal(ex1.body.profile.claimable, pay1);
  assert.equal(ex1.body.pool.availableLamports, SOL - pay1);
  assert.equal(ex1.body.pool.owedLamports, pay1);

  const tooSmall = await api('POST', '/api/pool/claim', { token });
  assert.equal(tooSmall.status, 400);
  assert.equal(tooSmall.body.error, 'too_small');

  const ex2 = await api('POST', '/api/pool/exchange', { token, body: { fishIds: [ids[1]] } });
  assert.equal(ex2.status, 200, ex2.text);
  const pay2 = poolPayout('mythic', SOL - pay1);
  assert.equal(ex2.body.total, pay2);

  const claim = await api('POST', '/api/pool/claim', { token });
  assert.equal(claim.status, 200, claim.text);
  assert.deepEqual(claim.body.payout, { id: claim.body.payout.id, lamports: pay1 + pay2, status: 'pending' });
  assert.equal(claim.body.profile.claimable, 0);

  const mine = await api('GET', '/api/payouts', { token });
  assert.equal(mine.body.payouts.length, 1);
  assert.equal(mine.body.payouts[0].status, 'pending');

  const pending = await api('GET', '/api/admin/payouts?status=pending', { headers: ADMIN });
  assert.equal(pending.body.payouts.length, 1);
  assert.equal(pending.body.payouts[0].wallet, wallet);

  const id = claim.body.payout.id;
  const paid = await api('POST', `/api/admin/payouts/${id}`, { headers: ADMIN, body: { tx: '5'.repeat(88) } });
  assert.equal(paid.status, 200, paid.text);
  assert.equal(paid.body.payout.status, 'paid');
  assert.equal(paid.body.pool.owedLamports, 0);
  assert.equal(paid.body.pool.paidLamports, pay1 + pay2);
  assert.equal(paid.body.pool.availableLamports, SOL - pay1 - pay2);

  const twice = await api('POST', `/api/admin/payouts/${id}`, { headers: ADMIN, body: { tx: 'again' } });
  assert.equal(twice.status, 409);

  const state = await api('GET', '/api/admin/pool', { headers: ADMIN });
  assert.deepEqual(state.body.recentEvents.map((e) => e.kind), ['paid', 'claim', 'exchange', 'exchange', 'deposit']);
});

test('leaderboard shows short names, and your rank when signed in', async () => {
  const { token, wallet } = player;
  const before = await api('GET', '/api/leaderboard');
  assert.deepEqual(before.body, { top: [] });

  withProfile(wallet, (p) => { p.best = 1_234; });
  const other = await signIn();
  withProfile(other.wallet, (p) => { p.best = 5_000; });

  const anon = await api('GET', '/api/leaderboard');
  assert.equal(anon.body.top.length, 2);
  assert.deepEqual(anon.body.top[0], { name: `${other.wallet.slice(0, 4)}…${other.wallet.slice(-4)}`, best: 5_000, landed: 0 });
  assert.equal(anon.body.me, undefined);

  const mine = await api('GET', '/api/leaderboard', { token });
  assert.equal(mine.body.me.rank, 2);
  assert.equal(mine.body.me.best, 1_234);
});

test('logout ends the session', async () => {
  const { token } = player;
  assert.equal((await api('POST', '/api/auth/logout', { token })).status, 200);
  assert.equal((await api('GET', '/api/me', { token })).status, 401);
});

test('static files: cache headers, SPA fallback, no path traversal', async () => {
  const index = await api('GET', '/');
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  assert.equal(index.headers.get('cache-control'), 'no-cache');

  const asset = await api('GET', '/assets/app-abc123.js');
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');

  const route = await api('GET', '/some/client/route');
  assert.equal(route.status, 200);
  assert.match(route.text, /<title>pier<\/title>/);

  assert.equal((await api('GET', '/missing.png')).status, 404);

  for (const p of ['/..%2f..%2f..%2fetc%2fpasswd', '/%2e%2e/%2e%2e/etc/passwd', '/../../etc/passwd', '/.env']) {
    const r = await rawGet(p);
    assert.ok(!/root:/.test(r.text), `${p} must not leave the static folder`);
    assert.ok(r.status === 404 || /<title>pier<\/title>/.test(r.text), `${p} got ${r.status}`);
  }
});

test('rate limit answers 429 when one address floods', async () => {
  // Only the last X-Forwarded-For entry (added by our proxy) counts; the client can forge the rest.
  const flood = Array.from({ length: 120 }, (_, i) =>
    api('GET', '/api/health', { headers: { 'x-forwarded-for': `198.51.100.${i % 250}, 203.0.113.7` } }));
  const results = await Promise.all(flood);
  const limited = results.filter((r) => r.status === 429);
  assert.ok(limited.length >= 120 - 60 - 10, `expected most of the overflow to be limited, got ${limited.length}`);
  assert.equal(limited[0].body.error, 'rate_limit');
  assert.equal(limited[0].headers.get('retry-after'), '1');

  // Someone else is unaffected.
  assert.equal((await api('GET', '/api/health')).status, 200);
});
