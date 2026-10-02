// Lobby sockets: players see each other join, move and leave; rare catches are announced.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pier-lobby-'));
Object.assign(process.env, { DB_PATH: path.join(tmp, 'game.db'), STATIC_DIR: path.join(tmp, 'none'), TOKEN_MINT: '' });
const { startServer } = await import('../server/index.js');
const lobby = await import('../server/lobby.js');

let app;
let url;
before(async () => {
  app = await startServer({ port: 0, host: '127.0.0.1', log: false });
  url = `ws://127.0.0.1:${app.port}/ws`;
});
after(async () => {
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// A socket that queues every message so tests can wait for the next one of a given type.
function client(hello) {
  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    const i = waiters.findIndex((w) => w.type === msg.t);
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else inbox.push(msg);
  });
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', outfit: 'deckhand', rod: 'driftwood', ...hello })));
  return {
    ws,
    next(type, ms = 2000) {
      const i = inbox.findIndex((m) => m.t === type);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no ${type} message`)), ms);
        waiters.push({ type, resolve: (m) => { clearTimeout(timer); resolve(m); } });
      });
    },
    send: (msg) => ws.send(JSON.stringify(msg)),
    close: () => new Promise((r) => { ws.once('close', r); ws.close(); }),
  };
}

test('players in a lobby see each other join, move, change rods and leave', async () => {
  const a = client({ guest: 'aaaa1111', s: [1, 2, 0, 0, 0] });
  const welcomeA = await a.next('welcome');
  assert.equal(welcomeA.lobby, 1);
  assert.equal(welcomeA.size, lobby.LOBBY_SIZE);
  assert.deepEqual(welcomeA.players, []);

  const b = client({ guest: 'bbbb2222', outfit: 'skipper', rod: 'nope' });
  const welcomeB = await b.next('welcome');
  assert.equal(welcomeB.lobby, 1);
  assert.equal(welcomeB.players.length, 1);
  assert.equal(welcomeB.players[0].name, 'guest-aaaa');
  const joined = await a.next('join');
  assert.equal(joined.p.name, 'guest-bbbb');
  assert.equal(joined.p.outfit, 'skipper');
  assert.equal(joined.p.rod, 'driftwood', 'unknown rods fall back to the starter rod');

  b.send({ t: 's', s: [5.123, -3, 1.5, 1, 0.4, 10, -14] });
  const update = await a.next('u');
  assert.deepEqual(update.p, [[welcomeB.id, 5.12, -3, 1.5, 1, 0.4, 10, -14]]);

  b.send({ t: 's', s: [9999, 0, 0, 0, 0] }); // off the map: ignored
  b.send({ t: 'look', outfit: 'diver', rod: 'bamboo', halo: 'golden' });
  const look = await a.next('look');
  assert.deepEqual([look.id, look.outfit, look.rod, look.halo], [welcomeB.id, 'diver', 'bamboo', 'golden']);
  b.send({ t: 'look', outfit: 'diver', rod: 'bamboo', halo: 'made-up' });
  assert.equal((await a.next('look')).halo, null, 'unknown halos are dropped');
  assert.ok(Number.isInteger(look.look.shirt) && Number.isInteger(look.look.hair), 'everyone gets a shirt and hair colour');

  await b.close();
  const left = await a.next('leave');
  assert.equal(left.id, welcomeB.id);
  assert.deepEqual(lobby.stats(), { lobbies: 1, players: 1 });
  await a.close();
});

test('a full lobby sends the next player to lobby 2', async () => {
  const clients = [];
  for (let i = 0; i < lobby.LOBBY_SIZE; i++) {
    const c = client({ guest: i.toString(16).padStart(4, '0') });
    await c.next('welcome');
    clients.push(c);
  }
  const extra = client({ guest: 'ffff' });
  const w = await extra.next('welcome');
  assert.equal(w.lobby, 2);
  assert.deepEqual(lobby.stats(), { lobbies: 2, players: lobby.LOBBY_SIZE + 1 });
  await Promise.all([...clients, extra].map((c) => c.close()));
});

test('sockets from other websites are refused', async () => {
  const bad = new WebSocket(url, { headers: { origin: 'https://evil.example' } });
  const err = await new Promise((resolve) => { bad.on('error', resolve); bad.on('close', resolve); });
  assert.ok(err);
});

test('an epic or rarer catch by a signed-in player is announced to the rest of the lobby', async () => {
  const nacl = (await import('tweetnacl')).default;
  const bs58 = (await import('bs58')).default;
  const auth = await import('../server/auth.js');
  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);
  const { message } = auth.createNonce(wallet);
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
  const { token } = auth.verify({ wallet, signature });

  const catcher = client({ token });
  const welcome = await catcher.next('welcome');
  const watcher = client({ guest: 'cccc' });
  await watcher.next('welcome');

  lobby.announceCatch(wallet, { sp: 'paper_perch', kg: 1 }); // common: no shout
  lobby.announceCatch(wallet, { sp: 'ape_angler', kg: 6.5 });
  const shout = await watcher.next('shout');
  assert.deepEqual(shout, { t: 'shout', name: `${wallet.slice(0, 4)}…${wallet.slice(-4)}`, sp: 'ape_angler', kg: 6.5 });
  await assert.rejects(catcher.next('shout', 300), 'the catcher already sees their own catch');
  assert.ok(welcome.id);
  await Promise.all([catcher.close(), watcher.close()]);
});

test('the Beacon rod can only be taken by a wallet whose player is up the lighthouse', async () => {
  const nacl = (await import('tweetnacl')).default;
  const bs58 = (await import('bs58')).default;
  const auth = await import('../server/auth.js');
  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);
  const { message } = auth.createNonce(wallet);
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
  const { token } = auth.verify({ wallet, signature });
  const find = () => fetch(`http://127.0.0.1:${app.port}/api/shop/find`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ id: 'beacon' }),
  }).then(async (r) => [r.status, await r.json()]);

  const [status, body] = await find();
  assert.equal(status, 403, 'not in a lobby at all');
  assert.equal(body.error, 'not_here');

  const climber = client({ token, s: [-22, -2.8, 0, 0, 0] });
  await climber.next('welcome');
  assert.equal((await find())[0], 403, 'on the deck');

  climber.send({ t: 's', s: [-22.9, -4.7, 0, 3, 0] });
  await new Promise((r) => setTimeout(r, 100));
  const [okStatus, ok] = await find();
  assert.equal(okStatus, 200);
  assert.equal(ok.rod, 'beacon');
  assert.equal(ok.profile.rod, 'beacon');
  await climber.close();
});
