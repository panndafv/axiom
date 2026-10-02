// Game state machine shared by the server (wallet players) and the browser (guests).
// Every function takes a plain `profile` object, mutates it and returns what the caller should
// send back to the player. Storage (SQLite on the server, localStorage for guests) wraps it.

import {
  GAME, RARITIES, RODS_BY_ID, BAITS_BY_ID, SHOP, SPECIES_BY_ID,
  rollSpecies, rollKg, fishValue, biteDelayMs, minReelMs, poolPayout, cryptoRng,
} from './rules.js';

export class GameError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function randomId(bytes = 12) {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function newProfile(id, now = Date.now()) {
  return {
    v: 1,
    id,
    createdAt: now,
    cash: 0,
    lifetimeCash: 0,
    best: 0,
    runs: 0,
    landed: 0,
    snaps: 0,
    rods: ['driftwood'],
    rod: 'driftwood',
    baits: {},        // baitId -> casts left
    bait: null,       // bait on the hook, used up one per cast
    outfits: ['deckhand'],
    outfit: 'deckhand',
    storage: [],
    nextFishId: 1,
    log: {},          // speciesId -> { n, maxKg, first }
    run: null,        // the active run, if any
    claimable: 0,     // lamports won from the pool, not yet claimed
    totalEarned: 0,   // lamports won from the pool, lifetime
    exchanges: [],    // [{ at, lamports }] within the last 24h, for the daily cap
  };
}

// ---------------------------------------------------------------------------------------------
// Runs

function getRun(p, runId) {
  if (!p.run || p.run.id !== runId) throw new GameError('no_run', 'That run is over. Start a new one.');
  return p.run;
}

export function publicRun(run, now = Date.now()) {
  if (!run) return null;
  return {
    id: run.id,
    startedAt: run.startedAt,
    endsAt: run.endsAt,
    msLeft: Math.max(0, run.endsAt - now),
    stringer: run.stringer,
    mult: run.mult,
    score: run.score,
    banked: run.banked,
    landed: run.landed,
    snaps: run.snaps,
    // enough for a reloaded page to cancel a cast still in the water, never the species
    cast: run.cast ? { id: run.cast.id, biteInMs: Math.max(0, run.cast.biteAt - now) } : null,
    readyInMs: Math.max(0, run.lastResolvedAt + GAME.castCooldownMs - now),
  };
}

export function startRun(p, now = Date.now()) {
  if (p.run) endRun(p, p.run.id, now);
  p.run = {
    id: randomId(),
    startedAt: now,
    endsAt: now + GAME.oilMs,
    stringer: [],
    mult: 1,
    score: 0,
    banked: 0,
    landed: 0,
    snaps: 0,
    escapes: 0,
    cast: null,
    lastResolvedAt: 0,
  };
  return publicRun(p.run, now);
}

export function cast(p, runId, now = Date.now(), rng = cryptoRng) {
  const run = getRun(p, runId);
  if (now > run.endsAt) throw new GameError('oil_out', 'The lantern is out.');
  if (run.cast) throw new GameError('busy', 'Your line is already in the water.');
  if (now - run.lastResolvedAt < GAME.castCooldownMs) {
    const secs = Math.ceil((run.lastResolvedAt + GAME.castCooldownMs - now) / 1000);
    throw new GameError('too_soon', `Untangling your line… ${secs}s`);
  }
  const rod = RODS_BY_ID[p.rod];
  const bait = useBait(p);
  const luck = currentLuck(p, bait);
  const sp = rollSpecies(luck, rng);
  const kg = rollKg(sp, rng);
  const bite = biteDelayMs(luck, rng);
  run.cast = { id: randomId(), sp: sp.id, kg, rod: rod.id, luck, castAt: now, biteAt: now + bite };
  // The species stays on the server until it is landed; the client only gets what it needs to
  // run the fight.
  const [lo, hi] = sp.kg;
  return {
    castId: run.cast.id,
    biteInMs: bite,
    luck,
    bait: bait?.id || null,
    fight: { difficulty: sp.difficulty, size: hi > lo ? (kg - lo) / (hi - lo) : 0.5 },
  };
}

// Takes one bait off the hook (if any is equipped) and returns it.
function useBait(p) {
  if (!p.bait) return null;
  const left = p.baits[p.bait] || 0;
  if (left <= 0) { p.bait = null; return null; }
  const bait = BAITS_BY_ID[p.bait];
  p.baits[p.bait] = left - 1;
  if (left - 1 <= 0) { delete p.baits[p.bait]; p.bait = null; }
  return bait;
}

export function currentLuck(p, bait = p.bait && p.baits[p.bait] > 0 ? BAITS_BY_ID[p.bait] : null) {
  return (RODS_BY_ID[p.rod]?.luck || 0) + (bait?.luck || 0);
}

function multFor(n) {
  return Math.min(GAME.multMax, Math.round((1 + GAME.multStep * n) * 100) / 100);
}

export function land(p, runId, castId, now = Date.now()) {
  const run = getRun(p, runId);
  const c = run.cast;
  if (!c || c.id !== castId) throw new GameError('no_cast', 'Nothing on the line.');
  if (now > run.endsAt + GAME.landGraceMs) {
    run.cast = null;
    throw new GameError('oil_out', 'The lantern went out before the fish came in.');
  }
  const sp = SPECIES_BY_ID[c.sp];
  const rod = RODS_BY_ID[c.rod];
  if (now < c.biteAt + minReelMs(sp, rod) * 0.9) throw new GameError('too_fast', 'That was faster than the line allows.');

  const fish = { id: p.nextFishId++, sp: sp.id, kg: c.kg, value: fishValue(sp, c.kg), at: now };
  run.stringer.push(fish);
  run.mult = multFor(run.stringer.length);
  run.landed++;
  run.cast = null;
  run.lastResolvedAt = now;
  p.landed++;

  const entry = p.log[sp.id] || (p.log[sp.id] = { n: 0, maxKg: 0, first: now });
  const isNew = entry.n === 0;
  entry.n++;
  entry.maxKg = Math.max(entry.maxKg, fish.kg);

  return { fish, isNew, run: publicRun(run, now) };
}

// reason: 'snap' (line broke: the whole unbanked stringer is lost), 'escape' (fish got off),
// or 'cancel' (line reeled in before a bite).
//
// Losing a fish never frees the line sooner than landing it would have. Otherwise a bot could
// cast, read the fight difficulty (which hints at the species) and cancel until something rare
// bites.
export function lose(p, runId, castId, reason, now = Date.now()) {
  const run = getRun(p, runId);
  const c = run.cast;
  if (!c || c.id !== castId) throw new GameError('no_cast', 'Nothing on the line.');
  if (!['snap', 'escape', 'cancel'].includes(reason)) reason = 'cancel';
  // A snap is only possible once something is actually biting.
  if (reason === 'snap' && now < c.biteAt) reason = 'cancel';
  let lost = [];
  if (reason === 'snap') {
    lost = run.stringer;
    run.stringer = [];
    run.mult = 1;
    run.snaps++;
    p.snaps++;
  } else if (reason === 'escape') {
    run.escapes++;
  }
  run.cast = null;
  const sp = SPECIES_BY_ID[c.sp];
  run.lastResolvedAt = Math.max(now, c.biteAt + minReelMs(sp, RODS_BY_ID[c.rod]));
  return { reason, lost, run: publicRun(run, now) };
}

// Puts banked fish in the backpack. When it would overflow, the most valuable fish stay (rarity
// first, so a rare fish is never sold to make room for a common) and the rest are sold for gold.
function store(p, fishes) {
  const all = [...p.storage, ...fishes];
  if (all.length <= GAME.storageMax) {
    p.storage = all;
    return { stored: fishes.length, autoSold: 0, autoSoldCash: 0 };
  }
  const worth = (f) => RARITIES[SPECIES_BY_ID[f.sp].rarity].order * 1e6 + f.value;
  const keep = new Set([...all].sort((a, b) => worth(b) - worth(a)).slice(0, GAME.storageMax).map((f) => f.id));
  const sold = all.filter((f) => !keep.has(f.id));
  p.storage = all.filter((f) => keep.has(f.id));
  const soldCash = sold.reduce((s, f) => s + f.value, 0);
  p.cash += soldCash;
  p.lifetimeCash += soldCash;
  return { stored: fishes.filter((f) => keep.has(f.id)).length, autoSold: sold.length, autoSoldCash: soldCash };
}

function doBank(p, run) {
  const base = run.stringer.reduce((s, f) => s + f.value, 0);
  const score = Math.round(base * run.mult);
  const bonus = score - base;
  const count = run.stringer.length;
  const mult = run.mult;
  run.score += score;
  run.banked += count;
  p.cash += bonus;
  p.lifetimeCash += bonus;
  const stored = store(p, run.stringer);
  run.stringer = [];
  run.mult = 1;
  return { count, base, mult, score, bonus, ...stored };
}

export function bank(p, runId, now = Date.now()) {
  const run = getRun(p, runId);
  if (run.cast && now >= run.cast.biteAt) throw new GameError('busy', 'Land the fish first.');
  if (!run.stringer.length) throw new GameError('empty', 'Nothing on the stringer to bank.');
  return { ...doBank(p, run), run: publicRun(run, now) };
}

export function endRun(p, runId, now = Date.now()) {
  const run = p.run;
  if (!run || (runId && run.id !== runId)) return null;
  if (run.cast) {
    run.cast = null;
    run.escapes++;
  }
  const last = run.stringer.length ? doBank(p, run) : null;
  const newBest = run.score > p.best;
  p.best = Math.max(p.best, run.score);
  p.runs++;
  p.run = null;
  return {
    score: run.score,
    landed: run.landed,
    banked: run.banked,
    snaps: run.snaps,
    escapes: run.escapes,
    autoBanked: last,
    best: p.best,
    newBest,
  };
}

// Closes a run the player walked away from (closed the tab mid-run).
export function sweep(p, now = Date.now()) {
  if (p.run && now > p.run.endsAt + 60_000) endRun(p, p.run.id, now);
  p.exchanges = (p.exchanges || []).filter((e) => now - e.at < 86_400_000);
}

// ---------------------------------------------------------------------------------------------
// Deck: storage, shop, rods

function takeFish(p, fishIds) {
  const want = new Set(fishIds.map(Number));
  const taken = p.storage.filter((f) => want.has(f.id));
  p.storage = p.storage.filter((f) => !want.has(f.id));
  return taken;
}

export function sell(p, fishIds) {
  if (!Array.isArray(fishIds) || !fishIds.length) throw new GameError('empty', 'Pick some fish to sell.');
  const sold = takeFish(p, fishIds);
  if (!sold.length) throw new GameError('not_found', 'Those fish are not in your cooler.');
  const cash = sold.reduce((s, f) => s + f.value, 0);
  p.cash += cash;
  p.lifetimeCash += cash;
  return { sold: sold.length, cash };
}

// kind: 'rod' | 'bait' | 'outfit'. Rods and outfits are bought once and equipped straight away;
// bait comes in packs of casts and goes on the hook if nothing else is on it.
export function buy(p, kind, id) {
  // own keys only, so names like "constructor" are not mistaken for items
  const item = Object.hasOwn(SHOP, kind) && Object.hasOwn(SHOP[kind], id) ? SHOP[kind][id] : null;
  if (!item) throw new GameError('not_found', 'That is not in the shop.');
  if (kind === 'rod' && p.rods.includes(id)) throw new GameError('owned', 'You already own that rod.');
  if (kind === 'outfit' && p.outfits.includes(id)) throw new GameError('owned', 'You already own that outfit.');
  if (p.cash < item.price) throw new GameError('broke', `You need ${item.price - p.cash} more gold.`);
  p.cash -= item.price;
  if (kind === 'rod') {
    p.rods.push(id);
    if (!p.run?.cast) p.rod = id;
  } else if (kind === 'outfit') {
    p.outfits.push(id);
    p.outfit = id;
  } else {
    p.baits[id] = (p.baits[id] || 0) + item.pack;
    if (!p.bait) p.bait = id;
  }
  return { kind, id, cash: p.cash };
}

// id null takes the bait off the hook.
export function equip(p, kind, id) {
  if (kind === 'rod') {
    if (!p.rods.includes(id) || !Object.hasOwn(RODS_BY_ID, id)) throw new GameError('not_owned', 'You do not own that rod.');
    if (p.run?.cast) throw new GameError('busy', 'Reel in first.');
    p.rod = id;
  } else if (kind === 'outfit') {
    if (!p.outfits.includes(id) || !Object.hasOwn(SHOP.outfit, id)) throw new GameError('not_owned', 'You do not own that outfit.');
    p.outfit = id;
  } else if (kind === 'bait') {
    if (id !== null && !(Object.hasOwn(p.baits, id) && p.baits[id] > 0)) throw new GameError('not_owned', 'You are out of that bait.');
    p.bait = id;
  } else {
    throw new GameError('not_found', 'Unknown item type.');
  }
  return { kind, id };
}

// ---------------------------------------------------------------------------------------------
// Reward pool (server only: guests cannot exchange)
//
// Each fish pays poolPct of whatever is left in the pool at that moment, so exchanging many fish
// at once gives slightly less per fish than the first one, and the pool never reaches zero.

export function exchange(p, fishIds, availableLamports, { now = Date.now(), dailyCapPct = 0.05, earnGate = 0 } = {}) {
  if (p.lifetimeCash < earnGate) {
    throw new GameError('gate', `Earn ${earnGate - p.lifetimeCash} more lifetime cash to unlock the pool.`, 403);
  }
  if (!Array.isArray(fishIds) || !fishIds.length) throw new GameError('empty', 'Pick some fish to exchange.');
  sweep(p, now);
  const want = new Set(fishIds.map(Number));
  const candidates = p.storage
    .filter((f) => want.has(f.id) && RARITIES[SPECIES_BY_ID[f.sp].rarity].poolPct > 0)
    .sort((a, b) => RARITIES[SPECIES_BY_ID[b.sp].rarity].order - RARITIES[SPECIES_BY_ID[a.sp].rarity].order);
  if (!candidates.length) throw new GameError('not_eligible', 'Only rare or better fish can be cashed in.');

  const cap = Math.floor(availableLamports * dailyCapPct);
  let usedToday = p.exchanges.reduce((s, e) => s + e.lamports, 0);
  let remaining = availableLamports;
  const items = [];
  let capped = false;
  for (const f of candidates) {
    const rarity = SPECIES_BY_ID[f.sp].rarity;
    const pay = poolPayout(rarity, remaining);
    if (pay <= 0) continue;
    if (usedToday + pay > cap) { capped = true; continue; }
    items.push({ fishId: f.id, sp: f.sp, rarity, lamports: pay });
    usedToday += pay;
    remaining -= pay;
  }
  if (!items.length) {
    throw new GameError(capped ? 'daily_cap' : 'pool_empty',
      capped ? 'You hit today\'s pool limit. Come back tomorrow.' : 'The pool is empty right now.', 409);
  }
  takeFish(p, items.map((i) => i.fishId));
  const total = items.reduce((s, i) => s + i.lamports, 0);
  p.claimable += total;
  p.totalEarned += total;
  p.exchanges.push({ at: now, lamports: total });
  return { items, total, capped, claimable: p.claimable };
}

export function claim(p, minLamports = GAME.minClaimLamports) {
  if (p.claimable < minLamports) throw new GameError('too_small', 'Not enough to claim yet.');
  const amount = p.claimable;
  p.claimable = 0;
  return { amount };
}

// What the client is allowed to see.
export function publicProfile(p, now = Date.now()) {
  return {
    id: p.id,
    cash: p.cash,
    lifetimeCash: p.lifetimeCash,
    best: p.best,
    runs: p.runs,
    landed: p.landed,
    snaps: p.snaps,
    rods: p.rods,
    rod: p.rod,
    baits: p.baits,
    bait: p.bait,
    outfits: p.outfits,
    outfit: p.outfit,
    luck: currentLuck(p),
    storage: p.storage,
    log: p.log,
    run: publicRun(p.run, now),
    claimable: p.claimable,
    totalEarned: p.totalEarned,
  };
}
