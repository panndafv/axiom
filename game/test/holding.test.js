// Before launch: a token mint that does not exist on chain yet. Ordinary wallets fail the holding
// check; wallets in TEST_WALLETS pass it, so the owner can try cash-ins. HIDE_MINT keeps the
// address away from players.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const mint = bs58.encode(nacl.sign.keyPair().publicKey);
const tester = nacl.sign.keyPair();
const testerWallet = bs58.encode(tester.publicKey);

// An RPC that has never heard of the mint, and a price API that is not reachable.
const rpc = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const { id } = JSON.parse(body);
    res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid param: could not find mint' } }));
  });
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-holding-'));
let app;

before(async () => {
  await new Promise((r) => rpc.listen(0, '127.0.0.1', r));
  Object.assign(process.env, {
    DB_PATH: path.join(tmp, 'game.db'),
    STATIC_DIR: path.join(tmp, 'none'),
    TOKEN_MINT: mint,
    TEST_WALLETS: `"${testerWallet}", not-a-wallet ${bs58.encode(nacl.sign.keyPair().publicKey)}`, // quotes and junk are tolerated
    HIDE_MINT: '1',
    POOL_WALLET: '',
    POOL_SECRET_KEY: '',
    SOLANA_RPC_URL: `http://127.0.0.1:${rpc.address().port}`,
    TRUST_PROXY: '1',
  });
  const { startServer } = await import('../server/index.js');
  app = await startServer({ port: 0, host: '127.0.0.1', log: false });
});

after(async () => {
  await app.close();
  rpc.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

let ip = 0;
async function api(method, pathname, { body, token } = {}) {
  const headers = { 'x-forwarded-for': `10.8.0.${++ip % 250}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(app.url + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

async function signIn(kp) {
  const wallet = bs58.encode(kp.publicKey);
  const { body: { message } } = await api('GET', `/api/auth/nonce?wallet=${wallet}`);
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
  return (await api('POST', '/api/auth/verify', { body: { wallet, signature } })).body;
}

test('HIDE_MINT keeps the token address off the title screen', async () => {
  const cfg = (await api('GET', '/api/config')).body;
  assert.equal(cfg.tokenMint, '');
  assert.equal(cfg.dev, false);
});

test('a test wallet passes the holding check before the token exists; anyone else does not', async () => {
  const mine = await signIn(tester);
  assert.equal(mine.holding.ok, true);
  assert.equal(mine.holding.test, true);

  const other = await signIn(nacl.sign.keyPair());
  assert.equal(other.holding.ok, false);
  assert.match(other.holding.error, /token balance/);
});
