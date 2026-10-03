// The Founder rod: the first FOUNDER_SLOTS wallets to land a fish get a founder number and the
// rod with that catch. Nobody else gets one, and nobody can buy one.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tydal-founders-'));
let app, db;

before(async () => {
  Object.assign(process.env, {
    DB_PATH: path.join(tmp, 'game.db'),
    STATIC_DIR: path.join(tmp, 'none'),
    TOKEN_MINT: '',
    POOL_WALLET: '',
    POOL_SECRET_KEY: '',
    FOUNDER_SLOTS: '2',
    TRUST_PROXY: '1',
  });
  db = await import('../server/db.js');
  const { startServer } = await import('../server/index.js');
  app = await startServer({ port: 0, host: '127.0.0.1', log: false });
});

after(async () => {
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

let ip = 0;
async function api(method, pathname, { body, token } = {}) {
  const headers = { 'x-forwarded-for': `10.7.0.${++ip % 250}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(app.url + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

async function signIn() {
  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);
  const { body: { message } } = await api('GET', `/api/auth/nonce?wallet=${wallet}`);
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
  const { body } = await api('POST', '/api/auth/verify', { body: { wallet, signature } });
  return { wallet, token: body.token };
}

// Casts, then winds the bite back into the past so the fish can be landed straight away.
async function catchOne({ wallet, token }) {
  db.withProfile(wallet, (p) => { p.lineReadyAt = 0; });
  const cast = await api('POST', '/api/fish/cast', { token, body: {} });
  assert.equal(cast.status, 200, JSON.stringify(cast.body));
  db.withProfile(wallet, (p) => { p.cast.biteAt -= 45_000; }); // well past the longest fight, short of a stale line (60 s)
  const land = await api('POST', '/api/fish/land', { token, body: { castId: cast.body.castId } });
  assert.equal(land.status, 200, JSON.stringify(land.body));
  return land.body;
}

test('the Founder rod is listed but cannot be bought', async () => {
  const me = await signIn();
  db.withProfile(me.wallet, (p) => { p.cash = 1_000_000; });
  const buy = await api('POST', '/api/shop/buy', { token: me.token, body: { kind: 'rod', id: 'founder' } });
  assert.equal(buy.status, 400);
  assert.equal(buy.body.error, 'not_for_sale');
  assert.match(buy.body.message, /first 100/);
});

test('the first wallets to land a fish get founder numbers and the rod; the rest do not', async () => {
  const [a, b, c] = [await signIn(), await signIn(), await signIn()];
  // signing in is not enough: the number comes with the first catch
  assert.equal((await api('GET', '/api/me', { token: c.token })).body.profile.founder, null);

  const first = await catchOne(b);
  assert.equal(first.founder, 1);
  assert.equal(first.profile.founder, 1);
  assert.ok(first.profile.rods.includes('founder'));
  assert.equal(first.profile.rod, 'founder', 'it goes straight into your hands');

  const again = await catchOne(b);
  assert.equal(again.founder, null, 'one number per wallet');
  assert.equal(again.profile.founder, 1);

  // someone already holding a luckier rod keeps it in hand
  db.withProfile(a.wallet, (p) => { p.rods.push('wheel'); p.rod = 'wheel'; });
  const second = await catchOne(a);
  assert.equal(second.founder, 2);
  assert.equal(second.profile.rod, 'wheel');
  assert.ok(second.profile.rods.includes('founder'));

  const late = await catchOne(c);
  assert.equal(late.founder, null, 'the slots are gone');
  assert.equal(late.profile.founder, null);
  assert.ok(!late.profile.rods.includes('founder'));
  assert.equal(db.foundersSoFar(), 2);
});
