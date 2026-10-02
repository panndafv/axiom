// Automatic payouts against a fake Solana RPC: a cash-in sends SOL straight away, a refused
// payout goes back to the player, and a transaction that never lands is sent again only once it
// can no longer land, so nothing is ever paid twice.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { speciesPayout } from '../shared/rules.js';

const SOL = 1_000_000_000;
const poolKp = nacl.sign.keyPair();
const poolWallet = bs58.encode(poolKp.publicKey);

// --- fake RPC ------------------------------------------------------------------------------

const chain = {
  height: 1_000,
  balance: 10 * SOL,
  sent: [],            // every transaction we were handed: { signature, to, lamports }
  statuses: new Map(), // signature -> { confirmationStatus, err }
  old: new Map(),      // only found with searchTransactionHistory
  refuse: null,        // simulation error for the next sendTransaction
};
let blockCount = 0;

// Reads a transfer the way a validator would: check the signature, then pull out the recipient
// and amount from the System transfer instruction (always the last one).
function decode(base64) {
  const bytes = Buffer.from(base64, 'base64');
  assert.equal(bytes[0], 1, 'one signature');
  const sig = bytes.subarray(1, 65);
  const msg = bytes.subarray(65);
  assert.ok(nacl.sign.detached.verify(msg, sig, poolKp.publicKey), 'signed by the pool wallet');
  const nKeys = msg[3];
  const keys = Array.from({ length: nKeys }, (_, i) => msg.subarray(4 + i * 32, 36 + i * 32));
  assert.equal(bs58.encode(keys[0]), poolWallet, 'the pool wallet pays');
  const data = msg.subarray(msg.length - 12);
  assert.equal(data.readUInt32LE(0), 2, 'a System transfer');
  return { signature: bs58.encode(sig), to: bs58.encode(keys[1]), lamports: Number(data.readBigUInt64LE(4)) };
}

const rpc = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const { id, method, params } = JSON.parse(body);
    const reply = (result) => res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
    const error = (code, message, data) => res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message, data } }));
    switch (method) {
      case 'getBalance': return reply({ context: { slot: 1 }, value: chain.balance });
      case 'getLatestBlockhash':
        blockCount++;
        return reply({ context: { slot: 1 }, value: { blockhash: bs58.encode(new Uint8Array(32).fill(blockCount)), lastValidBlockHeight: chain.height + 150 } });
      case 'getBlockHeight': return reply(chain.height);
      case 'sendTransaction': {
        const t = decode(params[0]);
        if (chain.refuse) {
          const err = chain.refuse;
          chain.refuse = null;
          return error(-32002, 'Transaction simulation failed', { err, logs: [] });
        }
        chain.sent.push(t);
        return reply(t.signature);
      }
      case 'getSignatureStatuses':
        return reply({
          context: { slot: 1 },
          value: params[0].map((s) => chain.statuses.get(s) || (params[1]?.searchTransactionHistory ? chain.old.get(s) : null) || null),
        });
      default: return error(-32601, `no ${method} here`);
    }
  });
});

// --- the game server, pointed at the fake RPC --------------------------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tydal-payouts-'));
let app, payer, db;

before(async () => {
  await new Promise((r) => rpc.listen(0, '127.0.0.1', r));
  Object.assign(process.env, {
    DB_PATH: path.join(tmp, 'game.db'),
    STATIC_DIR: path.join(tmp, 'none'),
    TOKEN_MINT: '',
    POOL_WALLET: '',
    POOL_SECRET_KEY: bs58.encode(poolKp.secretKey),
    SOLANA_RPC_URL: `http://127.0.0.1:${rpc.address().port}`,
    SOLANA_CLUSTER: 'devnet',
    POOL_RESERVE_SOL: '0',
    POOL_DAILY_CAP_PCT: '0.5',
    EARN_GATE: '0',
    TRUST_PROXY: '1',
  });
  ({ payer, db } = { payer: await import('../server/payer.js'), db: await import('../server/db.js') });
  const { startServer } = await import('../server/index.js');
  app = await startServer({ port: 0, host: '127.0.0.1', log: false });
  payer.stop(); // the tests below run check() themselves
});

after(async () => {
  await app.close();
  rpc.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

let ip = 0;
async function api(method, pathname, { body, token } = {}) {
  const headers = { 'x-forwarded-for': `10.9.0.${++ip % 250}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(app.url + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

async function signIn(kp = nacl.sign.keyPair()) {
  const wallet = bs58.encode(kp.publicKey);
  const { body: { message } } = await api('GET', `/api/auth/nonce?wallet=${wallet}`);
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
  const { body } = await api('POST', '/api/auth/verify', { body: { wallet, signature } });
  return { wallet, token: body.token };
}

function giveFish(wallet, sp) {
  return db.withProfile(wallet, (p, now) => {
    const id = p.nextFishId++;
    p.storage.push({ id, sp, kg: 2, value: 70, at: now });
    return id;
  });
}

let player;

test('config says payouts are automatic, from the key\'s wallet', async () => {
  const cfg = (await api('GET', '/api/config')).body;
  assert.equal(cfg.autoPayouts, true);
  assert.equal(cfg.cluster, 'devnet');
  assert.equal(cfg.poolMode, 'wallet');
  assert.ok(!JSON.stringify(cfg).includes(process.env.POOL_SECRET_KEY));
  const pool = (await api('GET', '/api/pool')).body;
  assert.equal(pool.wallet, poolWallet);
  assert.equal(pool.availableLamports, 10 * SOL);
});

test('cashing in a fish sends the SOL at once and gives a transaction to look up', async () => {
  player = await signIn();
  const fishId = giveFish(player.wallet, 'moon_marlin');
  const ex = await api('POST', '/api/pool/exchange', { token: player.token, body: { fishIds: [fishId] } });
  assert.equal(ex.status, 200, JSON.stringify(ex.body));
  const amount = speciesPayout('moon_marlin', 10 * SOL);
  assert.equal(ex.body.total, amount);
  assert.equal(ex.body.payout.status, 'sent');
  assert.equal(ex.body.profile.claimable, 0);
  assert.equal(chain.sent.length, 1);
  assert.deepEqual(chain.sent[0], { signature: ex.body.payout.tx, to: player.wallet, lamports: amount });

  // Not confirmed yet: still sent, and nothing goes out again.
  await payer.check();
  assert.equal(chain.sent.length, 1);
  assert.equal((await api('GET', '/api/payouts', { token: player.token })).body.payouts[0].status, 'sent');

  chain.statuses.set(ex.body.payout.tx, { confirmationStatus: 'confirmed', err: null });
  chain.balance -= amount;
  await payer.check();
  const [paid] = (await api('GET', '/api/payouts', { token: player.token })).body.payouts;
  assert.equal(paid.status, 'paid');
  assert.equal(paid.tx, ex.body.payout.tx);
  const pool = (await api('GET', '/api/pool')).body;
  assert.equal(pool.owedLamports, 0);
  assert.equal(pool.paidLamports, amount);
  assert.equal(pool.availableLamports, 10 * SOL - amount);
});

test('a payout the network refuses goes back to the player, who can send it again', async () => {
  const fishId = giveFish(player.wallet, 'pump_puffer');
  chain.refuse = { InsufficientFundsForRent: { account_index: 1 } };
  const ex = await api('POST', '/api/pool/exchange', { token: player.token, body: { fishIds: [fishId] } });
  assert.equal(ex.status, 200);
  assert.equal(ex.body.payout.status, 'failed');
  assert.match(ex.body.payout.error, /needs a little SOL/);
  const me = (await api('GET', '/api/me', { token: player.token })).body.profile;
  assert.equal(me.claimable, ex.body.total);

  const again = await api('POST', '/api/pool/claim', { token: player.token });
  assert.equal(again.status, 200);
  assert.equal(again.body.payout.status, 'sent');
  assert.equal(again.body.payout.lamports, ex.body.total);
  assert.equal(again.body.profile.claimable, 0);
  chain.statuses.set(again.body.payout.tx, { confirmationStatus: 'finalized', err: null });
  await payer.check();
  assert.equal((await api('GET', '/api/payouts', { token: player.token })).body.payouts[0].status, 'paid');
});

test('a dropped transaction is only sent again once it can no longer land', async () => {
  const fishId = giveFish(player.wallet, 'pump_puffer');
  const before = chain.sent.length;
  const ex = await api('POST', '/api/pool/exchange', { token: player.token, body: { fishIds: [fishId] } });
  const first = ex.body.payout.tx;
  assert.equal(chain.sent.length, before + 1);

  chain.height += 150; // last valid height reached, not passed: it could still land
  await payer.check();
  assert.equal(chain.sent.length, before + 1);

  chain.height += 1; // expired and nowhere on chain: send a fresh one
  await payer.check();
  assert.equal(chain.sent.length, before + 2);
  const second = chain.sent.at(-1).signature;
  assert.notEqual(second, first);
  assert.equal(chain.sent.at(-1).lamports, ex.body.total);

  // An expired transaction that did land (found in history) is settled, not resent.
  chain.height += 151;
  chain.old.set(second, { confirmationStatus: 'finalized', err: null });
  await payer.check();
  assert.equal(chain.sent.length, before + 2);
  const [paid] = (await api('GET', '/api/payouts', { token: player.token })).body.payouts;
  assert.equal(paid.status, 'paid');
  assert.equal(paid.tx, second);
});

test('the pool wallet cannot cash in to itself, and the payout is not retried forever', async () => {
  const self = await signIn(poolKp);
  const fishId = giveFish(self.wallet, 'pump_puffer');
  const before = chain.sent.length;
  const ex = await api('POST', '/api/pool/exchange', { token: self.token, body: { fishIds: [fishId] } });
  assert.equal(ex.status, 200);
  assert.equal(ex.body.payout.status, 'failed');
  assert.match(ex.body.payout.error, /cannot pay itself/);
  await payer.check();
  assert.equal(chain.sent.length, before);
});

test('the server refuses to pay real SOL when there is no token mint to check holdings against', () => {
  const run = (extra) => spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./server/config.js')"], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, TOKEN_MINT: '', POOL_SECRET_KEY: bs58.encode(poolKp.secretKey), SOLANA_CLUSTER: '', SOLANA_RPC_URL: 'https://mainnet.example', ...extra },
    encoding: 'utf8',
  });
  const mainnet = run({});
  assert.notEqual(mainnet.status, 0);
  assert.match(mainnet.stderr, /needs TOKEN_MINT/);
  assert.ok(!mainnet.stderr.includes(bs58.encode(poolKp.secretKey)), 'the key is never printed');
  assert.equal(run({ SOLANA_RPC_URL: 'https://api.devnet.solana.com' }).status, 0);
  assert.equal(run({ TOKEN_MINT: bs58.encode(nacl.sign.keyPair().publicKey) }).status, 0);
  const bad = run({ POOL_SECRET_KEY: 'not-a-key' });
  assert.match(bad.stderr, /not a valid wallet secret key/);
});
