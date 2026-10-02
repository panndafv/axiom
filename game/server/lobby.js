// Multiplayer lobbies over WebSocket (/ws). Each lobby holds up to LOBBY_SIZE players who see each
// other walk and fish. Positions are cosmetic: everything that matters (fish, gold, the pool) still
// goes through the HTTP API, so nothing here needs to be trusted.
//
// Client → server: {t:'hello', token?, guest?, name?, outfit, rod, halo, s?}, {t:'s', s:[x,z,facing,mode,speed,bx?,bz?]},
//                  (mode: 0 walking, 1 fishing, 2 sitting, 3 up the lighthouse)
//                  {t:'look', name?, outfit, rod, halo}, {t:'chat', text}
// Server → client: {t:'welcome', id, lobby, size, players:[...]}, {t:'join', p}, {t:'leave', id},
//                  {t:'u', p:[[id, ...s], ...]} (batched ~8 times a second), {t:'look', id, name, outfit, rod, halo},
//                  {t:'shout', name, sp, kg} (someone in your lobby landed something rare),
//                  {t:'chat', id, name, wallet, text, at}, {t:'chat_no', why} (your line was refused)
//                  welcome also carries `chat`: the lobby's last few lines.

import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { walletForToken } from './auth.js';
import { RODS_BY_ID, OUTFITS_BY_ID, HALOS_BY_ID, SPECIES_BY_ID, RARITIES, isLook, randomLook, cleanName } from '../shared/rules.js';

const haloOf = (id) => (Object.hasOwn(HALOS_BY_ID, id) ? id : null);

// Lobby chat: one line per player every 5 seconds, up to 120 characters. The last few lines are
// kept per lobby (in memory) so people who join see the conversation.
export const CHAT_EVERY_MS = 5_000;
const CHAT_MAX = 120;
const CHAT_HISTORY = 20;
const chatLogs = new Map(); // lobby number -> recent chat messages

// Tidies a line. Links and wallet/token addresses are refused: in a token's game they are
// nearly always scams ("new CA", "claim your airdrop here").
export function cleanChat(text) {
  if (typeof text !== 'string') return { error: null };
  const t = text
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHAT_MAX);
  if (!t) return { error: null };
  if (/(https?:|www\.|t\.me|discord\.gg|\b[a-z0-9-]+\.(com|net|org|io|xyz|fun|gg|app|sol|link|site|online|club|ly|tv|ru|info)\b)/i.test(t)) {
    return { error: 'Links are not allowed in chat.' };
  }
  if (/[1-9A-HJ-NP-Za-km-z]{30,}/.test(t)) return { error: 'Wallet and token addresses are not allowed in chat.' };
  return { text: t };
}

export const LOBBY_SIZE = 25;
const TICK_MS = 125;
const HELLO_TIMEOUT_MS = 5_000;
const MAX_MSGS_PER_SEC = 20; // a client sends ~8 a second
const SHOUT_FROM = RARITIES.epic.order;

const lobbies = new Map(); // lobby number -> Map(playerId -> player)
let nextId = 1;

const short = (w) => `${w.slice(0, 4)}…${w.slice(-4)}`;
const finite = (n, lim) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= lim;

function cleanState(s) {
  if (!Array.isArray(s) || s.length < 5 || s.length > 7) return null;
  const [x, z, f, m, sp, bx, bz] = s;
  if (!finite(x, 500) || !finite(z, 500) || !finite(f, 20) || ![0, 1, 2, 3].includes(m) || !finite(sp, 1)) return null;
  const out = [round(x), round(z), round(f), m, round(sp)];
  if (finite(bx, 500) && finite(bz, 500)) out.push(round(bx), round(bz));
  return out;
}
const round = (n) => Math.round(n * 100) / 100;

function publicPlayer(p) {
  return { id: p.id, name: p.name, wallet: !!p.wallet, outfit: p.outfit, rod: p.rod, halo: p.halo, look: p.look, s: p.s };
}

function send(p, msg) {
  if (p.ws.readyState === 1) p.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
}

function broadcast(lobby, msg, except = null) {
  const data = JSON.stringify(msg);
  for (const p of lobby.values()) if (p !== except) send(p, data);
}

// The lowest-numbered lobby with room, so players fill lobbies before new ones open.
function pickLobby() {
  for (let n = 1; ; n++) {
    const l = lobbies.get(n);
    if (!l) { lobbies.set(n, new Map()); return n; }
    if (l.size < LOBBY_SIZE) return n;
  }
}

function join(ws, hello) {
  const wallet = walletForToken(hello.token);
  const guestTag = typeof hello.guest === 'string' ? hello.guest.replace(/[^0-9a-f]/gi, '').slice(0, 4) : '';
  const p = {
    id: nextId++,
    ws,
    wallet,
    // shown when they have not picked a name
    tag: wallet ? short(wallet) : `guest-${guestTag || Math.floor(Math.random() * 9000 + 1000)}`,
    outfit: Object.hasOwn(OUTFITS_BY_ID, hello.outfit) ? hello.outfit : 'deckhand',
    rod: Object.hasOwn(RODS_BY_ID, hello.rod) ? hello.rod : 'driftwood',
    halo: haloOf(hello.halo),
    look: isLook(hello.look) ? { shirt: hello.look.shirt, hair: hello.look.hair } : randomLook(),
    s: cleanState(hello.s) || [0, 3.5, Math.PI, 0, 0],
    dirty: false,
    msgs: 0,
    windowStart: Date.now(),
  };
  p.name = cleanName(hello.name) || p.tag;
  p.lobby = pickLobby();
  const lobby = lobbies.get(p.lobby);
  send(p, { t: 'welcome', id: p.id, lobby: p.lobby, size: LOBBY_SIZE, players: [...lobby.values()].map(publicPlayer), chat: chatLogs.get(p.lobby) || [] });
  broadcast(lobby, { t: 'join', p: publicPlayer(p) });
  lobby.set(p.id, p);
  return p;
}

function leave(p) {
  const lobby = lobbies.get(p.lobby);
  if (!lobby?.delete(p.id)) return;
  if (lobby.size === 0) {
    lobbies.delete(p.lobby);
    chatLogs.delete(p.lobby);
  } else {
    broadcast(lobby, { t: 'leave', id: p.id });
  }
}

function onMessage(p, raw) {
  const now = Date.now();
  if (now - p.windowStart > 1000) { p.windowStart = now; p.msgs = 0; }
  if (++p.msgs > MAX_MSGS_PER_SEC) {
    if (p.msgs > MAX_MSGS_PER_SEC * 3) p.ws.close(4008, 'too many messages');
    return;
  }
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (msg?.t === 's') {
    const s = cleanState(msg.s);
    if (s) { p.s = s; p.dirty = true; }
  } else if (msg?.t === 'look') {
    if (Object.hasOwn(OUTFITS_BY_ID, msg.outfit)) p.outfit = msg.outfit;
    if (Object.hasOwn(RODS_BY_ID, msg.rod)) p.rod = msg.rod;
    if (isLook(msg.look)) p.look = { shirt: msg.look.shirt, hair: msg.look.hair };
    if ('halo' in msg) p.halo = haloOf(msg.halo);
    if ('name' in msg) p.name = cleanName(msg.name) || p.tag;
    broadcast(lobbies.get(p.lobby), { t: 'look', id: p.id, name: p.name, outfit: p.outfit, rod: p.rod, halo: p.halo, look: p.look }, p);
  } else if (msg?.t === 'chat') {
    const wait = (p.lastChatAt || 0) + CHAT_EVERY_MS - now;
    if (wait > 0) {
      send(p, { t: 'chat_no', why: `Slow down: you can chat again in ${Math.ceil(wait / 1000)}s.`, waitMs: wait });
      return;
    }
    const c = cleanChat(msg.text);
    if (!c.text) {
      if (c.error) send(p, { t: 'chat_no', why: c.error });
      return;
    }
    p.lastChatAt = now;
    const line = { t: 'chat', id: p.id, name: p.name, wallet: !!p.wallet, text: c.text, at: now };
    const log = chatLogs.get(p.lobby) || [];
    log.push(line);
    if (log.length > CHAT_HISTORY) log.shift();
    chatLogs.set(p.lobby, log);
    broadcast(lobbies.get(p.lobby), line); // the sender too, so everyone sees the same line
  }
}

// Sends every lobby the players that moved since the last tick, in one message.
function tick() {
  for (const lobby of lobbies.values()) {
    const moved = [];
    for (const p of lobby.values()) {
      if (p.dirty) { moved.push([p.id, ...p.s]); p.dirty = false; }
    }
    if (moved.length) broadcast(lobby, { t: 'u', p: moved });
  }
}

// Called by the API when a wallet player lands a fish: rare ones are announced to their lobby.
export function announceCatch(wallet, fish) {
  const sp = SPECIES_BY_ID[fish?.sp];
  if (!sp || RARITIES[sp.rarity].order < SHOUT_FROM) return;
  for (const lobby of lobbies.values()) {
    for (const p of lobby.values()) {
      if (p.wallet === wallet) broadcast(lobby, { t: 'shout', name: p.name, sp: sp.id, kg: fish.kg }, p);
    }
  }
}

// The Beacon rod can only be taken from the top of the lighthouse, so the API asks whether one of
// this wallet's sockets has its player up there.
export function isUpTheLighthouse(wallet) {
  for (const lobby of lobbies.values()) {
    for (const p of lobby.values()) if (wallet && p.wallet === wallet && p.s[3] === 3) return true;
  }
  return false;
}

export function stats() {
  return { lobbies: lobbies.size, players: [...lobbies.values()].reduce((n, l) => n + l.size, 0) };
}

export function attach(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    const origin = req.headers.origin;
    const host = req.headers.host;
    // browsers always send Origin; only accept our own page (or the configured CORS origin)
    let allowed = !origin || origin === config.corsOrigin;
    try { allowed ||= new URL(origin).host === host; } catch { /* "null" or junk origin */ }
    if (pathname !== '/ws' || !allowed || config.maintenance) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      let player = null;
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      const helloTimer = setTimeout(() => { if (!player) ws.close(4001, 'say hello'); }, HELLO_TIMEOUT_MS);
      ws.on('message', (raw) => {
        if (player) return onMessage(player, raw);
        let hello;
        try { hello = JSON.parse(raw); } catch { return ws.close(4002, 'bad hello'); }
        if (hello?.t !== 'hello') return ws.close(4002, 'bad hello');
        clearTimeout(helloTimer);
        player = join(ws, hello);
      });
      ws.on('close', () => {
        clearTimeout(helloTimer);
        if (player) leave(player);
      });
      ws.on('error', () => {});
    });
  });

  const ticker = setInterval(tick, TICK_MS);
  // drop sockets that stopped answering (closed laptop lids, lost wifi)
  const pinger = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 25_000);
  server.on('close', () => {
    clearInterval(ticker);
    clearInterval(pinger);
    for (const ws of wss.clients) ws.terminate();
    lobbies.clear();
  });
}
