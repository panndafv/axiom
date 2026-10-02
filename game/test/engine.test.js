// Engine rules with a fake clock and a fixed rng, so nothing here waits on real time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../shared/engine.js';
import * as rules from '../shared/rules.js';
import { GAME, RODS_BY_ID, SPECIES_BY_ID, minReelMs, rollSpecies } from '../shared/rules.js';

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;

// rng() = 0 always rolls the first common (Paper-Hand Perch) at its smallest size, with the
// quickest possible bite.
const zeroRng = () => 0;

function addFish(p, sp, value = 10) {
  const f = { id: p.nextFishId++, sp, kg: 1, value, at: T0 };
  p.storage.push(f);
  return f;
}

// Casts at `at` and lands as soon as the line allows. Returns the land result and its time.
function castAndLand(p, at) {
  const c = engine.cast(p, at, zeroRng);
  const sp = SPECIES_BY_ID[p.cast.sp];
  const landAt = at + c.biteInMs + minReelMs(sp, RODS_BY_ID[p.rod]);
  return { ...engine.land(p, c.castId, landAt), landAt };
}

test('zeroRng rolls the cheapest fish', () => {
  assert.equal(rollSpecies(0, zeroRng).id, 'paper_perch');
});

test('fishing: a too-fast land is rejected, a patient one goes straight into the backpack', () => {
  const p = engine.newProfile('tester', T0);
  const c = engine.cast(p, T0 + 1_000, zeroRng);
  assert.equal(c.biteInMs, GAME.biteMinMs);
  assert.equal(c.luck, 0);
  assert.ok(c.fight.difficulty > 0);
  assert.equal(c.sp, undefined, 'the species stays secret until landed');
  assert.throws(() => engine.cast(p, T0 + 1_100, zeroRng), { code: 'busy' });

  const biteAt = T0 + 1_000 + c.biteInMs;
  const minMs = minReelMs(SPECIES_BY_ID.paper_perch, RODS_BY_ID.driftwood);
  assert.throws(() => engine.land(p, c.castId, biteAt + 100), { code: 'too_fast' });
  assert.throws(() => engine.land(p, 'wrong-cast', biteAt + minMs), { code: 'no_cast' });

  // A rejected land leaves the fish on the line.
  const first = engine.land(p, c.castId, biteAt + minMs);
  assert.equal(first.isNew, true);
  assert.equal(first.fish.sp, 'paper_perch');
  assert.deepEqual(p.storage, [first.fish]);
  assert.equal(p.caught, first.fish.value);
  assert.equal(p.cast, null);

  const second = castAndLand(p, biteAt + minMs + GAME.castCooldownMs);
  assert.equal(second.isNew, false);
  assert.equal(p.log.paper_perch.n, 2);
  assert.equal(p.storage.length, 2);
  assert.equal(p.landed, 2);
  assert.equal(p.caught, first.fish.value + second.fish.value);
});

test('a full backpack stops casting until fish are sold', () => {
  const p = engine.newProfile('tester', T0);
  for (let i = 0; i < GAME.storageMax; i++) addFish(p, 'paper_perch', 7);
  assert.throws(() => engine.cast(p, T0, zeroRng), { code: 'backpack_full' });
  engine.sell(p, [p.storage[0].id]);
  const c = engine.cast(p, T0, zeroRng);
  assert.ok(c.castId);
});

test('losing a fish: a snap counts, a "snap" before the bite is only a cancel, and the line stays busy', () => {
  const p = engine.newProfile('tester', T0);
  const early = engine.cast(p, T0, zeroRng);
  const cancelled = engine.lose(p, early.castId, 'snap', T0 + 10);
  assert.equal(cancelled.reason, 'cancel');
  assert.equal(p.snaps, 0);
  // cancelling never frees the line sooner than landing would have (no rerolling for rares)
  assert.ok(cancelled.readyInMs > GAME.castCooldownMs);
  assert.throws(() => engine.cast(p, T0 + 10 + GAME.castCooldownMs, zeroRng), { code: 'too_soon' });

  const t2 = T0 + 10 + cancelled.readyInMs;
  const c = engine.cast(p, t2, zeroRng);
  const snapped = engine.lose(p, c.castId, 'snap', t2 + c.biteInMs + 50);
  assert.equal(snapped.reason, 'snap');
  assert.equal(p.snaps, 1);
  assert.equal(p.storage.length, 0);
  assert.throws(() => engine.lose(p, c.castId, 'snap', t2 + c.biteInMs + 60), { code: 'no_cast' });
});

test('a line left in the water is reeled in for you after a while', () => {
  const p = engine.newProfile('tester', T0);
  const c = engine.cast(p, T0, zeroRng);
  engine.sweep(p, T0 + c.biteInMs + GAME.castStaleMs + 1);
  assert.equal(p.cast, null);
});

test('old saves with lantern runs load cleanly', () => {
  const old = { ...engine.newProfile('tester', T0), run: { id: 'x' }, best: 120, runs: 4 };
  delete old.caught;
  engine.sweep(old, T0);
  assert.equal(old.run, undefined);
  assert.equal(old.best, undefined);
  assert.equal(old.caught, 0);
});

test('sell turns stored fish into cash', () => {
  const p = engine.newProfile('tester', T0);
  const a = addFish(p, 'paper_perch', 7);
  const b = addFish(p, 'rug_carp', 12);
  addFish(p, 'gas_guppy', 3);

  const out = engine.sell(p, [a.id, b.id, 999]);
  assert.deepEqual(out, { sold: 2, cash: 19 });
  assert.equal(p.cash, 19);
  assert.equal(p.lifetimeCash, 19);
  assert.equal(p.storage.length, 1);
  assert.throws(() => engine.sell(p, [a.id]), { code: 'not_found' });
  assert.throws(() => engine.sell(p, []), { code: 'empty' });
});

test('buy checks cash; rods equip on purchase; bait is used up one per cast', () => {
  const p = engine.newProfile('tester', T0);
  assert.throws(() => engine.buy(p, 'rod', 'bamboo'), { code: 'broke' });
  assert.throws(() => engine.buy(p, 'rod', 'no_such_rod'), { code: 'not_found' });

  p.cash = RODS_BY_ID.bamboo.price;
  engine.buy(p, 'rod', 'bamboo');
  assert.equal(p.cash, 0);
  assert.deepEqual(p.rods, ['driftwood', 'bamboo']);
  assert.equal(p.rod, 'bamboo');
  assert.throws(() => engine.buy(p, 'rod', 'bamboo'), { code: 'owned' });

  engine.equip(p, 'rod', 'driftwood');
  assert.equal(p.rod, 'driftwood');
  assert.throws(() => engine.equip(p, 'rod', 'tidecaster'), { code: 'not_owned' });
  engine.equip(p, 'rod', 'bamboo');

  p.cash = 40;
  engine.buy(p, 'bait', 'worm');
  assert.equal(p.baits.worm, 10);
  assert.equal(p.bait, 'worm');
  assert.equal(engine.currentLuck(p), RODS_BY_ID.bamboo.luck + 6);

  const c = engine.cast(p, T0 + 1_000, zeroRng);
  assert.equal(c.bait, 'worm');
  assert.equal(c.luck, RODS_BY_ID.bamboo.luck + 6);
  assert.equal(p.baits.worm, 9);

  engine.equip(p, 'bait', null);
  assert.equal(p.bait, null);
  assert.throws(() => engine.equip(p, 'bait', 'moonjig'), { code: 'not_owned' });
});

// ---------------------------------------------------------------------------------------------
// Reward pool

const SOL = 1_000_000_000;
const poolOpts = { now: T0, dailyCapPct: 0.05, earnGate: 1500 };

function poolPlayer() {
  const p = engine.newProfile('tester', T0);
  p.lifetimeCash = 2_000;
  return p;
}

test('exchange: the earn gate is enforced', () => {
  const p = poolPlayer();
  p.lifetimeCash = 100;
  const f = addFish(p, 'pump_puffer');
  assert.throws(() => engine.exchange(p, [f.id], SOL, poolOpts), (err) => err.code === 'gate' && err.status === 403);
});

test('exchange: commons and uncommons cannot go to the pool', () => {
  const p = poolPlayer();
  const ids = [addFish(p, 'paper_perch').id, addFish(p, 'bag_bass').id];
  assert.throws(() => engine.exchange(p, ids, SOL, poolOpts), { code: 'not_eligible' });
  assert.equal(p.storage.length, 2);
});

test('exchange: each fish pays poolPct of what is left, rarest first', () => {
  const p = poolPlayer();
  const r1 = addFish(p, 'pump_puffer');
  const r2 = addFish(p, 'sniper_pike');
  const common = addFish(p, 'paper_perch');

  const out = engine.exchange(p, [r1.id, r2.id, common.id], SOL, poolOpts);
  assert.deepEqual(out.items.map((i) => i.lamports), [400_000, 399_840]); // 0.04% of 1 SOL, then of the rest
  assert.equal(out.total, 799_840);
  assert.equal(out.capped, false);
  assert.equal(p.claimable, 799_840);
  assert.equal(p.totalEarned, 799_840);
  assert.deepEqual(p.storage.map((f) => f.id), [common.id], 'the common stays in the cooler');

  const q = poolPlayer();
  const rare = addFish(q, 'degen_eel');
  const epic = addFish(q, 'liq_lionfish');
  const mixed = engine.exchange(q, [rare.id, epic.id], SOL, poolOpts);
  assert.deepEqual(mixed.items.map((i) => i.rarity), ['epic', 'rare']);
  assert.equal(mixed.items[0].lamports, 2_500_000);
});

test('exchange: the daily cap stops further payouts until 24h have passed', () => {
  const p = poolPlayer();
  const m1 = addFish(p, 'moon_marlin');
  const m2 = addFish(p, 'moon_marlin');

  // Cap is 5% of 1 SOL = 0.05 SOL. The first mythic pays 3%; the second (2.91%) would go over.
  const out = engine.exchange(p, [m1.id, m2.id], SOL, poolOpts);
  assert.equal(out.items.length, 1);
  assert.equal(out.total, 30_000_000);
  assert.equal(out.capped, true);
  assert.equal(p.storage.length, 1);

  const left = SOL - out.total;
  const again = () => engine.exchange(p, [p.storage[0].id], left, { ...poolOpts, now: T0 + 60_000 });
  assert.throws(again, (err) => err.code === 'daily_cap' && err.status === 409);

  const tomorrow = engine.exchange(p, [p.storage[0].id], left, { ...poolOpts, now: T0 + DAY + 1 });
  assert.equal(tomorrow.total, 29_100_000);
  assert.equal(p.storage.length, 0);
});

test('exchange: an empty pool pays nothing', () => {
  const p = poolPlayer();
  const f = addFish(p, 'bull_koi');
  assert.throws(() => engine.exchange(p, [f.id], 0, poolOpts), { code: 'pool_empty' });
  assert.equal(p.storage.length, 1);
});

test('claim needs at least the minimum and empties claimable', () => {
  const p = poolPlayer();
  p.claimable = GAME.minClaimLamports - 1;
  assert.throws(() => engine.claim(p), { code: 'too_small' });
  p.claimable = GAME.minClaimLamports + 5;
  assert.deepEqual(engine.claim(p), { amount: GAME.minClaimLamports + 5 });
  assert.equal(p.claimable, 0);
});

test('the Ghost Whale is the rarest fish and pays 6.5% of the pool', () => {
  const { SPECIES, speciesOdds, speciesPoolPct } = rules;
  const odds = SPECIES.map((s) => [s.id, speciesOdds(s.id, 0)]).sort((a, b) => a[1] - b[1]);
  assert.equal(odds[0][0], 'ghost_whale');
  assert.ok(odds[0][1] < odds[1][1]);
  assert.equal(speciesPoolPct('ghost_whale'), 0.065);
  assert.equal(speciesPoolPct('moon_marlin'), 0.03);

  const p = poolPlayer();
  const whale = addFish(p, 'ghost_whale', 2000);
  const out = engine.exchange(p, [whale.id], 100 * SOL, { ...poolOpts, dailyCapPct: 0.1 });
  assert.equal(out.total, 6.5 * SOL);
});

test('every fish name is at most two words', () => {
  for (const s of rules.SPECIES) assert.ok(s.name.split(/\s+/).length <= 2, s.name);
});
