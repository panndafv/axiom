import * as E from '../../shared/engine.js';
import { RODS_BY_ID, OUTFITS_BY_ID, BAITS_BY_ID } from '../../shared/rules.js';
import { CONFIG } from '../config.js';

// Two backends with the same methods:
//  - remote: the game server, for wallet players (progress saved, pool cash-ins).
//  - local: the same engine running in the browser, for guests (saved on this device only).
// Every mutating call resolves to the engine result plus `profile`.

export class ApiError extends Error {
  constructor(message, code = 'error', status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(method, path, body, token, timeoutMs = 10_000) {
  let res;
  try {
    res = await fetch(CONFIG.apiUrl + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ApiError('Could not reach the game server.', 'offline');
  }
  let data = null;
  try { data = await res.json(); } catch { /* not json */ }
  if (!res.ok) throw new ApiError(data?.message || `Request failed (${res.status}).`, data?.error || 'http', res.status);
  return data;
}

// Public endpoints that work without signing in.
export const publicApi = {
  config: () => request('GET', '/api/config', null, null, 4000),
  pool: () => request('GET', '/api/pool'),
  leaderboard: (token) => request('GET', '/api/leaderboard', null, token),
  nonce: (wallet) => request('GET', `/api/auth/nonce?wallet=${encodeURIComponent(wallet)}`),
  verify: (wallet, signature) => request('POST', '/api/auth/verify', { wallet, signature }),
};

export function createRemoteBackend(token) {
  const call = (method, path, body) => request(method, path, body, token);
  return {
    kind: 'wallet',
    token,
    me: () => call('GET', '/api/me'),
    holding: (force = false) => call('GET', `/api/holding${force ? '?force=1' : ''}`),
    cast: () => call('POST', '/api/fish/cast', {}),
    land: (castId) => call('POST', '/api/fish/land', { castId }),
    lose: (castId, reason) => call('POST', '/api/fish/lose', { castId, reason }),
    sell: (fishIds) => call('POST', '/api/shop/sell', { fishIds }),
    buy: (kind, id) => call('POST', '/api/shop/buy', { kind, id }),
    equip: (kind, id) => call('POST', '/api/shop/equip', { kind, id }),
    find: (id) => call('POST', '/api/shop/find', { id }),
    pool: () => call('GET', '/api/pool'),
    exchange: (fishIds) => call('POST', '/api/pool/exchange', { fishIds }),
    claim: () => call('POST', '/api/pool/claim', {}),
    payouts: () => call('GET', '/api/payouts'),
    leaderboard: () => publicApi.leaderboard(token),
    logout: () => call('POST', '/api/auth/logout', {}).catch(() => {}),
  };
}

const GUEST_KEY = 'pp.guest.v1';

function loadGuest() {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    if (raw) {
      // fill in fields added since the save was written, drop items that no longer exist
      const p = { ...E.newProfile('guest'), ...JSON.parse(raw) };
      p.rods = p.rods.filter((id) => RODS_BY_ID[id]);
      if (!p.rods.includes('driftwood')) p.rods.unshift('driftwood');
      if (!RODS_BY_ID[p.rod]) p.rod = 'driftwood';
      p.outfits = p.outfits.filter((id) => OUTFITS_BY_ID[id]);
      if (!OUTFITS_BY_ID[p.outfit]) p.outfit = 'deckhand';
      for (const id of Object.keys(p.baits)) if (!BAITS_BY_ID[id]) delete p.baits[id];
      return p;
    }
  } catch { /* corrupt or blocked storage: start fresh */ }
  return E.newProfile('guest');
}

export function createLocalBackend() {
  const p = loadGuest();
  const save = () => {
    try { localStorage.setItem(GUEST_KEY, JSON.stringify(p)); } catch { /* storage full or blocked */ }
  };
  const wrap = (fn) => async (...args) => {
    const now = Date.now();
    E.sweep(p, now);
    try {
      const res = fn(now, ...args) || {};
      return { ...res, profile: E.publicProfile(p, now) };
    } catch (err) {
      if (err instanceof E.GameError) throw new ApiError(err.message, err.code, err.status);
      throw err;
    } finally {
      save();
    }
  };
  const walletOnly = async () => {
    throw new ApiError('Connect a wallet on the title screen to cash in fish.', 'guest', 403);
  };
  return {
    kind: 'guest',
    me: wrap(() => ({ holding: null })),
    holding: async () => ({ holding: null }),
    cast: wrap((now) => E.cast(p, now)),
    land: wrap((now, castId) => E.land(p, castId, now)),
    lose: wrap((now, castId, reason) => E.lose(p, castId, reason, now)),
    sell: wrap((now, ids) => E.sell(p, ids)),
    buy: wrap((now, kind, id) => E.buy(p, kind, id)),
    equip: wrap((now, kind, id) => E.equip(p, kind, id)),
    find: wrap((now, id) => E.find(p, id)),
    pool: () => publicApi.pool(),
    exchange: walletOnly,
    claim: walletOnly,
    payouts: async () => ({ payouts: [] }),
    async leaderboard() {
      try {
        return await publicApi.leaderboard();
      } catch {
        return { top: p.caught ? [{ name: 'you (guest)', caught: p.caught, landed: p.landed }] : [], offline: true };
      }
    },
    logout: async () => {},
  };
}
