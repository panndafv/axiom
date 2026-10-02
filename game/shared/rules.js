// Game rules shared by the browser (guest mode, reel minigame) and the server (wallet mode).
// The server is the authority for wallet players: it rolls every fish, checks every timing
// and does all pool math. Change the numbers here and both sides follow.

export const GAME = {
  castCooldownMs: 400,    // minimum time between a resolved cast and the next one
  castStaleMs: 60_000,    // a line left in the water this long after the bite is reeled in for you
  biteMinMs: 1_600,       // a bite comes on its own somewhere in this window
  biteMaxMs: 5_200,
  storageMax: 15,         // backpack size: full means sell at the fish rack before casting again
  startProgress: 0.18,    // the reel starts with a little line already in
  minClaimLamports: 10_000_000, // 0.01 SOL
};

export const LAMPORTS_PER_SOL = 1_000_000_000;

// poolPct is the share of the *available* pool that one fish of this rarity pays when cashed in.
// Because each payout is a percentage of what is left, the pool can never be drained to zero.
// Rarities with poolPct 0 can only be sold for cash.
export const RARITIES = {
  common:    { order: 0, label: 'Common',    color: '#d6dde3', weight: 62,   sell: 8,    poolPct: 0 },
  uncommon:  { order: 1, label: 'Uncommon',  color: '#62e08f', weight: 24,   sell: 25,   poolPct: 0 },
  rare:      { order: 2, label: 'Rare',      color: '#4fb6ff', weight: 9.5,  sell: 70,   poolPct: 0.0004 },
  epic:      { order: 3, label: 'Epic',      color: '#b884ff', weight: 3.6,  sell: 200,  poolPct: 0.0025 },
  legendary: { order: 4, label: 'Legendary', color: '#ffb547', weight: 0.8,  sell: 600,  poolPct: 0.01 },
  mythic:    { order: 5, label: 'Mythic',    color: '#ff5f9a', weight: 0.1,  sell: 2000, poolPct: 0.03 },
};

export const RARITY_IDS = Object.keys(RARITIES);

// shape: body preset used by the 3D model and the catch-log icon. Names stay at two words.
// weight: how often this species bites compared with others of its rarity (default 1).
// poolPct: overrides the rarity's share of the pool for one special fish.
export const SPECIES = [
  { id: 'paper_perch',   name: 'Paperhand Perch',    rarity: 'common',    kg: [0.2, 1.1],  difficulty: 0.06, shape: 'perch', pattern: 'stripes', colors: ['#c8b98f', '#f3ecd6', '#e3c98c'], blurb: 'Lets go at the first dip.' },
  { id: 'gas_guppy',     name: 'Gas Guppy',          rarity: 'common',    kg: [0.05, 0.3], difficulty: 0.04, shape: 'small', pattern: 'plain',   colors: ['#7fd1c7', '#e6fbf6', '#ff9f6b'], blurb: 'Costs more to catch than it is worth.' },
  { id: 'dock_sardine',  name: 'Dock Sardine',       rarity: 'common',    kg: [0.1, 0.5],  difficulty: 0.08, shape: 'long',  pattern: 'plain',   colors: ['#7d97b5', '#e8eef5', '#9fb4cc'], blurb: 'Travels in thousands. Sells in thousands.' },
  { id: 'rug_carp',      name: 'Rug Carp',           rarity: 'common',    kg: [0.8, 3.5],  difficulty: 0.14, shape: 'perch', pattern: 'spots',   colors: ['#8a7a3e', '#e7dca6', '#b39b4c'], blurb: 'Pulled the liquidity. Then the line.' },
  { id: 'bag_bass',      name: 'Bagholder Bass',     rarity: 'uncommon',  kg: [1.0, 4.5],  difficulty: 0.24, shape: 'perch', pattern: 'stripes', colors: ['#4f7a3a', '#dfe9c2', '#6d9a48'], blurb: 'Still holding from the top.' },
  { id: 'jeet_mackerel', name: 'Jeet Mackerel',      rarity: 'uncommon',  kg: [0.4, 2.0],  difficulty: 0.28, shape: 'long',  pattern: 'stripes', colors: ['#2f6f8f', '#e2f1f7', '#58a6c9'], blurb: 'In and out in one block.' },
  { id: 'candle_snapper',name: 'Candle Snapper',     rarity: 'uncommon',  kg: [1.2, 5.0],  difficulty: 0.3,  shape: 'perch', pattern: 'plain',   colors: ['#d8473f', '#ffd9cf', '#ff7a5c'], blurb: 'Only ever seen going down.' },
  { id: 'pump_puffer',   name: 'Pump Puffer',        rarity: 'rare',      kg: [0.6, 2.4],  difficulty: 0.4,  shape: 'round', pattern: 'spots',   colors: ['#3fb36b', '#f6f0b8', '#9be86a'], blurb: 'Inflates 10x on contact.' },
  { id: 'sniper_pike',   name: 'Sniper Pike',        rarity: 'rare',      kg: [2.0, 8.0],  difficulty: 0.45, shape: 'long',  pattern: 'spots',   colors: ['#56663a', '#e6e7c4', '#a0a85a'], blurb: 'First in the block, every time.' },
  { id: 'degen_eel',     name: 'Degen Eel',          rarity: 'rare',      kg: [1.0, 6.0],  difficulty: 0.48, shape: 'eel',   pattern: 'plain',   colors: ['#40306a', '#9f8fd0', '#ff5fd2'], blurb: 'Fully leveraged, fully slippery.' },
  { id: 'liq_lionfish',  name: 'Liquidity Lionfish', rarity: 'epic',      kg: [0.8, 2.6],  difficulty: 0.6,  shape: 'tall',  pattern: 'stripes', colors: ['#c2453a', '#fff1e4', '#ffb08a'], blurb: 'Every spine is locked for a year.' },
  { id: 'ape_angler',    name: 'Ape Anglerfish',     rarity: 'epic',      kg: [3.0, 12.0], difficulty: 0.62, shape: 'angler',pattern: 'plain',   colors: ['#3b3042', '#7a6a83', '#fff27a'], blurb: 'Follows the glowing thing. Always.' },
  { id: 'diamond_tuna',  name: 'Diamond Tuna',       rarity: 'legendary', kg: [20, 90],    difficulty: 0.78, shape: 'tuna',  pattern: 'plain',   colors: ['#1d3f75', '#dfe8f5', '#9ff3ff'], blurb: 'Has never sold. Will never sell.' },
  { id: 'bull_koi',      name: 'Bull Koi',           rarity: 'legendary', kg: [4, 16],     difficulty: 0.8,  shape: 'perch', pattern: 'spots',   colors: ['#f2b233', '#fff3c9', '#ff7b2e'], blurb: 'Only swims up and to the right.' },
  { id: 'moon_marlin',   name: 'Moon Marlin',        rarity: 'mythic',    kg: [80, 320],   difficulty: 0.92, weight: 3, shape: 'marlin',pattern: 'plain',   colors: ['#23305f', '#e9ecff', '#c9b6ff'], blurb: 'Pointed straight at the moon.' },
  // The rarest fish in the game (1 in 4 mythics) and the biggest slice of the pool.
  { id: 'ghost_whale',   name: 'Ghost Whale',        rarity: 'mythic',    kg: [400, 1600], difficulty: 0.96, weight: 1, poolPct: 0.065, special: true, shape: 'shark', pattern: 'spots',   colors: ['#b9d7e6', '#f5fbff', '#e0f7ff'], blurb: 'Moves the whole chart when it turns.' },
];

export const SPECIES_BY_ID = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

// Everything in the tackle shop is bought with in-game cash (earned by selling fish).
// luck shifts the odds toward rarer fish (see rarityWeights). reel / tolerance make the fight a
// little easier on the better rods so the rare fish they attract are still landable.
export const RODS = [
  { id: 'driftwood',  name: 'Driftwood',  price: 0,     luck: 0,  reel: 1.0,  tolerance: 1.0,  color: '#9a6a3c', tip: '#ff6a3d', glow: null,      blurb: 'A trusty worn pole.' },
  { id: 'bamboo',     name: 'Bamboo',     price: 400,   luck: 8,  reel: 1.04, tolerance: 1.04, color: '#9fb35a', tip: '#ff6a3d', glow: null,      blurb: 'Light & springy.' },
  { id: 'bonecaster', name: 'Bonecaster', price: 1_200, luck: 16, reel: 1.08, tolerance: 1.1,  color: '#e6dccb', tip: '#ff6a3d', glow: null,      blurb: 'Pale as driftbone.' },
  { id: 'sunset',     name: 'Sunset',     price: 3_500, luck: 30, reel: 1.14, tolerance: 1.18, color: '#ffae3d', tip: '#ffd36b', glow: '#ffb347', blurb: 'Glowing golden embers.' },
  { id: 'tidecaster', name: 'Tidecaster', price: 8_000, luck: 40, reel: 1.2,  tolerance: 1.25, color: '#3ad6c8', tip: '#9ffcff', glow: '#4ff2e4', blurb: 'Shimmering deep-sea cyan.' },
  // Not for sale: it leans against the lamp room at the top of the lighthouse for whoever climbs up.
  { id: 'beacon',     name: 'Beacon',     price: null,  luck: 25, reel: 1.22, tolerance: 1.28, color: '#fff1c2', tip: '#ffe27a', glow: '#ffe9a0', hidden: true, blurb: 'Found at the top of the lighthouse.' },
];

export const RODS_BY_ID = Object.fromEntries(RODS.map((r) => [r.id, r]));

// Bait is bought in packs and used up one per cast while it is on the hook. Its luck stacks on
// top of the rod's.
export const BAITS = [
  { id: 'worm',    name: 'Wriggly Worm',  price: 40,    pack: 10, luck: 6,  color: '#d9826b', blurb: 'Classic. Fish like it.' },
  { id: 'spinner', name: 'Shiny Spinner', price: 150,   pack: 10, luck: 14, color: '#c9d4de', blurb: 'Flashes in the sunset.' },
  { id: 'glow',    name: 'Glow Lure',     price: 450,   pack: 10, luck: 25, color: '#9ff27a', blurb: 'Deep water notices.' },
  { id: 'moonjig', name: 'Moon Jig',      price: 1_400, pack: 10, luck: 45, color: '#c9b6ff', blurb: 'Only the rarest bite on this.' },
];

export const BAITS_BY_ID = Object.fromEntries(BAITS.map((b) => [b.id, b]));

// Cosmetic outfits for the angler.
export const OUTFITS = [
  { id: 'deckhand', name: 'Deckhand',       price: 0,     colors: { shirt: '#1f6c75', pants: '#1e2a4b', hair: '#d8662a', hat: null },      blurb: 'Salt in the hair.' },
  { id: 'skipper',  name: 'Sunset Skipper', price: 900,   colors: { shirt: '#f2efe6', pants: '#26324f', hair: '#3b2a20', hat: '#1e2a4b' }, blurb: 'Captain of a very small pier.' },
  { id: 'diver',    name: 'Night Diver',    price: 2_500, colors: { shirt: '#22253a', pants: '#14151f', hair: '#e8e4da', hat: '#ffcf4a' }, blurb: 'Dressed for the deep end.' },
  { id: 'whale',    name: 'Golden Whale',   price: 9_000, colors: { shirt: '#f2b233', pants: '#7a4a12', hair: '#fff3c9', hat: '#f2b233' }, blurb: 'Everyone on the pier knows.' },
];

export const OUTFITS_BY_ID = Object.fromEntries(OUTFITS.map((o) => [o.id, o]));

// Every angler gets one of these at random the first time they play, so a busy pier is easy to
// tell apart. Hair is always yours; the shirt shows on the default Deckhand outfit.
export const SHIRT_COLORS = ['#1f6c75', '#b8433a', '#26408b', '#2f6b3a', '#c9952b', '#6a3f8f', '#d0672e', '#c45a86', '#3f86b8', '#3a3f47'];
export const HAIR_COLORS = ['#d8662a', '#5a3a22', '#1f1a17', '#e6c26a', '#cfc8bb'];

export function randomLook(rng = cryptoRng) {
  return { shirt: Math.floor(rng() * SHIRT_COLORS.length), hair: Math.floor(rng() * HAIR_COLORS.length) };
}

export function isLook(look) {
  return Number.isInteger(look?.shirt) && look.shirt >= 0 && look.shirt < SHIRT_COLORS.length
    && Number.isInteger(look?.hair) && look.hair >= 0 && look.hair < HAIR_COLORS.length;
}

// Colours to draw an angler with: the outfit, plus their own hair (and shirt, on the Deckhand).
export function lookColors(outfitId, look) {
  const outfit = (Object.hasOwn(OUTFITS_BY_ID, outfitId) ? OUTFITS_BY_ID[outfitId] : OUTFITS_BY_ID.deckhand).colors;
  if (!isLook(look)) return outfit;
  return {
    ...outfit,
    hair: HAIR_COLORS[look.hair],
    shirt: outfitId === 'deckhand' ? SHIRT_COLORS[look.shirt] : outfit.shirt,
  };
}

export const SHOP = {
  rod: RODS_BY_ID,
  bait: BAITS_BY_ID,
  outfit: OUTFITS_BY_ID,
};

// ---------------------------------------------------------------------------------------------
// Reel physics. The client simulates the fight with these numbers; the server only checks that
// a fish was not landed faster than holding the line the whole time would allow.

export function reelParams(species, rod) {
  const d = species.difficulty;
  return {
    pull: (0.34 * rod.reel) / (1 + 0.8 * d),   // progress / s while holding
    slip: 0.04 + 0.05 * d,                     // progress / s lost while released
    rise: (0.2 + 0.5 * d) / rod.tolerance,     // tension / s while holding
    bleed: 0.6,                                // tension / s shed while released
    surgeGap: [3.2 - 1.4 * d, 5.0 - 1.8 * d],  // seconds between surges
    surgeLen: 0.6 + 0.6 * d,                   // seconds a surge lasts
    surgeRise: (0.5 + 1.7 * d) / rod.tolerance, // extra tension / s if you hold through a surge
    surgeSlip: 0.06 + 0.1 * d,                 // extra progress lost / s during a surge
  };
}

export function minReelMs(species, rod) {
  const { pull } = reelParams(species, rod);
  return Math.floor(((1 - GAME.startProgress) / pull) * 1000);
}

// ---------------------------------------------------------------------------------------------
// Rolls. rng() returns a float in [0, 1).

export function cryptoRng() {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] / 4_294_967_296;
}

// Luck is in points (rod + bait). Every rarity above common gets its weight multiplied by
// 1 + luck/100 * 1.5 * tier, so at 40 luck a mythic is 4x as likely and a rare 2.2x.
export function rarityWeights(luck = 0) {
  const out = {};
  for (const id of RARITY_IDS) {
    const r = RARITIES[id];
    out[id] = r.weight * (r.order > 0 ? 1 + (luck / 100) * 1.5 * r.order : 1);
  }
  return out;
}

export function rarityOdds(luck = 0) {
  const w = rarityWeights(luck);
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  return Object.fromEntries(RARITY_IDS.map((id) => [id, w[id] / total]));
}

export function rollSpecies(luck = 0, rng = cryptoRng) {
  const weights = rarityWeights(luck);
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let pick = rng() * total;
  let rarity = 'common';
  for (const id of RARITY_IDS) {
    pick -= weights[id];
    if (pick < 0) { rarity = id; break; }
  }
  const pool = SPECIES.filter((s) => s.rarity === rarity);
  let pickSp = rng() * pool.reduce((sum, s) => sum + (s.weight ?? 1), 0);
  for (const s of pool) {
    pickSp -= s.weight ?? 1;
    if (pickSp < 0) return s;
  }
  return pool[pool.length - 1];
}

export function rollKg(species, rng = cryptoRng) {
  const [lo, hi] = species.kg;
  return Math.round((lo + (hi - lo) * Math.pow(rng(), 1.7)) * 100) / 100;
}

export function fishValue(species, kg) {
  const [lo, hi] = species.kg;
  const size = hi > lo ? (kg - lo) / (hi - lo) : 0.5;
  return Math.max(1, Math.round(RARITIES[species.rarity].sell * (0.8 + 0.5 * size)));
}

export function biteDelayMs(luck = 0, rng = cryptoRng) {
  const span = GAME.biteMaxMs - GAME.biteMinMs;
  return Math.round(GAME.biteMinMs + span * rng() * (1 - Math.min(luck, 80) / 200));
}

// Share of the pool one fish of this species pays when cashed in (0 = gold only).
export function speciesPoolPct(speciesId) {
  const sp = SPECIES_BY_ID[speciesId];
  return sp ? sp.poolPct ?? RARITIES[sp.rarity].poolPct : 0;
}

// How likely each species is to bite at this luck, as a fraction of all bites.
export function speciesOdds(speciesId, luck = 0) {
  const sp = SPECIES_BY_ID[speciesId];
  const peers = SPECIES.filter((s) => s.rarity === sp.rarity);
  const share = (sp.weight ?? 1) / peers.reduce((sum, s) => sum + (s.weight ?? 1), 0);
  return rarityOdds(luck)[sp.rarity] * share;
}

export function speciesPayout(speciesId, availableLamports) {
  return Math.floor(Math.max(0, availableLamports) * speciesPoolPct(speciesId));
}

// Share of the available pool one fish of a rarity pays out, in lamports.
export function poolPayout(rarity, availableLamports) {
  const pct = RARITIES[rarity]?.poolPct ?? 0;
  return Math.floor(Math.max(0, availableLamports) * pct);
}

export function formatSol(lamports, digits = 4) {
  return (lamports / LAMPORTS_PER_SOL).toFixed(digits);
}
