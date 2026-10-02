// Game state machine shared by the server (wallet players) and the browser (guests).
// Every function takes a plain `profile` object, mutates it and returns what the caller should
// send back to the player. Storage (SQLite on the server, localStorage for guests) wraps it.

import {
  GAME, RARITIES, RODS_BY_ID, BAITS_BY_ID, SHOP, SPECIES_BY_ID,
  rollSpecies, rollKg, fishValue, biteDelayMs, minReelMs, speciesPoolPct, speciesPayout, cryptoRng, randomLook,
  specialCast, boostedLuck, sellPrice, cleanName, SHIRT_COLORS,
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
    v: 2,
    id,
    createdAt: now,
    cash: 0,          // gold
    lifetimeCash: 0,  // gold ever earned
    sold: 0,          // fish ever sold (the pool's unlock: sell some fish before cashing any in)
    caught: 0,        // total value of every fish ever landed (the leaderboard score)
    landed: 0,
    snaps: 0,
    rods: ['driftwood'],
    rod: 'driftwood',
    baits: {},        // baitId -> casts left
    bait: null,       // bait on the hook, used up one per cast
    outfits: ['deckhand'],
    outfit: 'deckhand',
    halos: [],
    halo: null,       // halo worn, adds to the gold fish sell for
    casts: 0,         // every 10th cast is golden and every 50th rainbow (see SPECIAL_CASTS)
    look: randomLook(),
    name: null,       // chosen name shown to other players; null = short wallet / guest tag // { shirt, hair } colour picks, random per player
    storage: [],      // the backpack, GAME.storageMax fish
    nextFishId: 1,
    log: {},          // speciesId -> { n, maxKg, first }
    cast: null,       // the line in the water, if any
    lineReadyAt: 0,   // no new cast before this time
    claimable: 0,     // lamports won from the pool, not yet claimed
    totalEarned: 0,   // lamports won from the pool, lifetime
    exchanges: [],    // [{ at, lamports }] within the last 24h, for the daily cap
  };
}

// Brings an older saved profile up to date and drops anything stale. Safe to call on every load.
export function sweep(p, now = Date.now()) {
  const fresh = newProfile(p.id, now);
  for (const k of Object.keys(fresh)) if (p[k] === undefined) p[k] = fresh[k];
  delete p.run;   // the old 90-second lantern runs are gone
  delete p.best;
  delete p.runs;
  // a line left in the water by a closed tab
  if (p.cast && now > p.cast.biteAt + GAME.castStaleMs) p.cast = null;
  p.exchanges = (p.exchanges || []).filter((e) => now - e.at < 86_400_000);
}

// ---------------------------------------------------------------------------------------------
// Fishing: cast → (bite) → land or lose. Fish go straight into the backpack.

export function cast(p, now = Date.now(), rng = cryptoRng) {
  if (p.cast && now < p.cast.biteAt + GAME.castStaleMs) throw new GameError('busy', 'Your line is already in the water.');
  p.cast = null;
  if (p.storage.length >= GAME.storageMax) {
    throw new GameError('backpack_full', `Your backpack is full (${GAME.storageMax}). Sell some fish at the fish rack first.`);
  }
  if (now < p.lineReadyAt) {
    throw new GameError('too_soon', `Re-tying your line… ${Math.ceil((p.lineReadyAt - now) / 1000)}s`);
  }
  const rod = RODS_BY_ID[p.rod];
  const bait = useBait(p);
  p.casts += 1;
  const special = specialCast(p.casts);
  const luck = boostedLuck(currentLuck(p, bait), special?.boost);
  const sp = rollSpecies(luck, rng);
  const kg = rollKg(sp, rng);
  const bite = biteDelayMs(luck, rng);
  p.cast = { id: randomId(), sp: sp.id, kg, rod: rod.id, luck, special: special?.kind || null, castAt: now, biteAt: now + bite };
  // The species stays on the server until it is landed; the client only gets what it needs to
  // run the fight.
  const [lo, hi] = sp.kg;
  return {
    castId: p.cast.id,
    biteInMs: bite,
    luck,
    special: special?.kind || null, // 'golden' / 'rainbow' / null
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

export function land(p, castId, now = Date.now()) {
  const c = p.cast;
  if (!c || c.id !== castId) throw new GameError('no_cast', 'Nothing on the line.');
  const sp = SPECIES_BY_ID[c.sp];
  const rod = RODS_BY_ID[c.rod];
  if (now < c.biteAt + minReelMs(sp, rod) * 0.9) throw new GameError('too_fast', 'That was faster than the line allows.');

  const fish = { id: p.nextFishId++, sp: sp.id, kg: c.kg, value: fishValue(sp, c.kg), at: now };
  p.cast = null;
  p.lineReadyAt = now + GAME.castCooldownMs;
  // A cast is only allowed with room in the backpack, so the fish always fits.
  p.storage.push(fish);
  p.landed++;
  p.caught += fish.value;

  const entry = p.log[sp.id] || (p.log[sp.id] = { n: 0, maxKg: 0, first: now });
  const isNew = entry.n === 0;
  entry.n++;
  entry.maxKg = Math.max(entry.maxKg, fish.kg);
  return { fish, isNew };
}

// reason: 'snap' (line broke), 'escape' (fish got off) or 'cancel' (reeled in / walked away).
//
// Losing a fish never frees the line sooner than landing it would have. Otherwise a bot could
// cast, read the fight difficulty (which hints at the species) and cancel until something rare
// bites.
export function lose(p, castId, reason, now = Date.now()) {
  const c = p.cast;
  if (!c || c.id !== castId) throw new GameError('no_cast', 'Nothing on the line.');
  if (!['snap', 'escape', 'cancel'].includes(reason)) reason = 'cancel';
  if (reason === 'snap' && now < c.biteAt) reason = 'cancel'; // nothing was biting yet
  if (reason === 'snap') p.snaps++;
  p.cast = null;
  const sp = SPECIES_BY_ID[c.sp];
  p.lineReadyAt = Math.max(now + GAME.castCooldownMs, c.biteAt + minReelMs(sp, RODS_BY_ID[c.rod]));
  return { reason, readyInMs: Math.max(0, p.lineReadyAt - now) };
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
  const cash = sold.reduce((s, f) => s + sellPrice(f.value, p.halo), 0);
  p.cash += cash;
  p.lifetimeCash += cash;
  p.sold += sold.length;
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
  if (kind === 'halo' && p.halos.includes(id)) throw new GameError('owned', 'You already own that halo.');
  if (item.price === null) throw new GameError('not_for_sale', 'That one is not for sale. It is hidden somewhere on the pier.');
  if (p.cash < item.price) throw new GameError('broke', `You need ${item.price - p.cash} more gold.`);
  p.cash -= item.price;
  if (kind === 'rod') {
    p.rods.push(id);
    if (!p.cast) p.rod = id;
  } else if (kind === 'outfit') {
    p.outfits.push(id);
    p.outfit = id;
  } else if (kind === 'halo') {
    p.halos.push(id);
    p.halo = id;
  } else {
    p.baits[id] = (p.baits[id] || 0) + item.pack;
    if (!p.bait) p.bait = id;
  }
  return { kind, id, cash: p.cash };
}

// Picks up a hidden rod (the Beacon at the top of the lighthouse). Free, once.
export function find(p, rodId) {
  const rod = Object.hasOwn(RODS_BY_ID, rodId) ? RODS_BY_ID[rodId] : null;
  if (!rod?.hidden) throw new GameError('not_found', 'There is nothing to find here.');
  if (p.rods.includes(rodId)) return { rod: rodId, already: true };
  p.rods.push(rodId);
  if (!p.cast) p.rod = rodId;
  return { rod: rodId, already: false };
}

// id null takes the bait off the hook.
export function equip(p, kind, id) {
  if (kind === 'rod') {
    if (!p.rods.includes(id) || !Object.hasOwn(RODS_BY_ID, id)) throw new GameError('not_owned', 'You do not own that rod.');
    if (p.cast) throw new GameError('busy', 'Reel in first.');
    p.rod = id;
  } else if (kind === 'outfit') {
    if (!p.outfits.includes(id) || !Object.hasOwn(SHOP.outfit, id)) throw new GameError('not_owned', 'You do not own that outfit.');
    p.outfit = id;
  } else if (kind === 'bait') {
    if (id !== null && !(Object.hasOwn(p.baits, id) && p.baits[id] > 0)) throw new GameError('not_owned', 'You are out of that bait.');
    p.bait = id;
  } else if (kind === 'halo') {
    // null takes it off
    if (id !== null && !(p.halos.includes(id) && Object.hasOwn(SHOP.halo, id))) throw new GameError('not_owned', 'You do not own that halo.');
    p.halo = id;
  } else {
    throw new GameError('not_found', 'Unknown item type.');
  }
  return { kind, id };
}

// Name and shirt colour, from the profile panel. Either can be left out; name '' or null clears it.
export function customize(p, { name, shirt } = {}) {
  if (name !== undefined) {
    if (name === null || name === '') {
      p.name = null;
    } else {
      const clean = cleanName(name);
      if (!clean) throw new GameError('bad_name', "Names are 2 to 16 letters, numbers, spaces or _ . - '");
      p.name = clean;
    }
  }
  if (shirt !== undefined) {
    if (!Number.isInteger(shirt) || shirt < 0 || shirt >= SHIRT_COLORS.length) throw new GameError('bad_shirt', 'Pick one of the shirt colours.');
    p.look = { ...p.look, shirt };
  }
  return {};
}

// Admin gift: puts an item in a player's profile for free (hidden rods too) and equips it.
// Bait comes as one pack.
export function grant(p, kind, id) {
  const item = Object.hasOwn(SHOP, kind) && Object.hasOwn(SHOP[kind], id) ? SHOP[kind][id] : null;
  if (!item) throw new GameError('not_found', 'No such item.');
  if (kind === 'rod') {
    if (!p.rods.includes(id)) p.rods.push(id);
    if (!p.cast) p.rod = id;
  } else if (kind === 'outfit') {
    if (!p.outfits.includes(id)) p.outfits.push(id);
    p.outfit = id;
  } else if (kind === 'halo') {
    if (!p.halos.includes(id)) p.halos.push(id);
    p.halo = id;
  } else {
    p.baits[id] = (p.baits[id] || 0) + item.pack;
    if (!p.bait) p.bait = id;
  }
  return { kind, id };
}

// ---------------------------------------------------------------------------------------------
// Reward pool (server only: guests cannot exchange)
//
// Each fish pays poolPct of whatever is left in the pool at that moment, so exchanging many fish
// at once gives slightly less per fish than the first one, and the pool never reaches zero.

export function exchange(p, fishIds, availableLamports, { now = Date.now(), dailyCapPct = 0.1, earnGate = 0 } = {}) {
  if (p.sold < earnGate) {
    const n = earnGate - p.sold;
    throw new GameError('gate', `Sell ${n} more fish at the rack to unlock the pool.`, 403);
  }
  if (!Array.isArray(fishIds) || !fishIds.length) throw new GameError('empty', 'Pick some fish to exchange.');
  sweep(p, now);
  const want = new Set(fishIds.map(Number));
  const candidates = p.storage
    .filter((f) => want.has(f.id) && speciesPoolPct(f.sp) > 0)
    .sort((a, b) => speciesPoolPct(b.sp) - speciesPoolPct(a.sp));
  if (!candidates.length) throw new GameError('not_eligible', 'Only rare or better fish can be cashed in.');

  const cap = Math.floor(availableLamports * dailyCapPct);
  let usedToday = p.exchanges.reduce((s, e) => s + e.lamports, 0);
  let remaining = availableLamports;
  const items = [];
  let capped = false;
  for (const f of candidates) {
    const rarity = SPECIES_BY_ID[f.sp].rarity;
    const pay = speciesPayout(f.sp, remaining);
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
    sold: p.sold,
    caught: p.caught,
    landed: p.landed,
    snaps: p.snaps,
    rods: p.rods,
    rod: p.rod,
    baits: p.baits,
    bait: p.bait,
    outfits: p.outfits,
    outfit: p.outfit,
    halos: p.halos,
    halo: p.halo,
    casts: p.casts,
    name: p.name,
    look: p.look,
    luck: currentLuck(p),
    storage: p.storage,
    log: p.log,
    // enough for a reloaded page to reel in a line it left in the water, never the species
    cast: p.cast ? { id: p.cast.id, biteInMs: Math.max(0, p.cast.biteAt - now) } : null,
    readyInMs: Math.max(0, p.lineReadyAt - now),
    claimable: p.claimable,
    totalEarned: p.totalEarned,
  };
}
