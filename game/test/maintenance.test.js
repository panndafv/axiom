// MAINTENANCE pauses the game: players get the message and nothing else; admin still works.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tydal-pause-'));
let app;

before(async () => {
  Object.assign(process.env, {
    DB_PATH: path.join(tmp, 'game.db'),
    STATIC_DIR: path.join(tmp, 'none'),
    TOKEN_MINT: '',
    POOL_SECRET_KEY: '',
    POOL_WALLET: '',
    MAINTENANCE: 'Back at 6pm with a new pier!',
    ADMIN_KEY: 'pause-admin',
  });
  const { startServer } = await import('../server/index.js');
  app = await startServer({ port: 0, host: '127.0.0.1', log: false });
});

after(async () => {
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const get = (p, headers = {}) => fetch(app.url + p, { headers }).then(async (r) => [r.status, await r.json()]);

test('while paused, players only get the message', async () => {
  const [, cfg] = await get('/api/config');
  assert.equal(cfg.maintenance, 'Back at 6pm with a new pier!');
  assert.equal((await get('/api/health'))[0], 200);

  const [status, body] = await get('/api/leaderboard');
  assert.equal(status, 503);
  assert.equal(body.error, 'maintenance');
  assert.equal(body.message, 'Back at 6pm with a new pier!');
  assert.equal((await get('/api/auth/nonce?wallet=x'))[0], 503);

  assert.equal((await get('/api/admin/pool', { 'x-admin-key': 'pause-admin' }))[0], 200, 'admin still works');

  const ws = new WebSocket(app.url.replace('http', 'ws') + '/ws');
  const closed = await new Promise((resolve) => { ws.on('error', () => resolve(true)); ws.on('open', () => resolve(false)); });
  assert.ok(closed, 'no lobbies while paused');
});
