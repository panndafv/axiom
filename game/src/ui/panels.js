import { h, fmt } from './dom.js';
import { fishIcon, rodIcon, baitIcon, outfitIcon } from './icons.js';
import { CONFIG } from '../config.js';
import {
  GAME, RARITIES, RARITY_IDS, SPECIES, SPECIES_BY_ID, RODS, BAITS, OUTFITS, rarityOdds,
} from '../../shared/rules.js';
import { shortAddress, isMobile, phantomDeepLink } from '../net/wallet.js';
import { sfx } from '../game/audio.js';

// Modal panels. Each panel is a render function that rebuilds its content from app state, so
// any profile change (sell, buy, cash in) just re-renders whatever is open.

export function createPanels(app) {
  const ui = document.getElementById('ui');
  let current = null;

  function close() {
    if (!current) return;
    const { el, onClose } = current;
    current = null;
    el.remove();
    onClose?.();
    app.onModalChange?.(false);
  }

  function open(name, { title, cls = '', render, onClose, headExtra }) {
    close();
    const body = h('div');
    const head = h('div.modal-head', h('h2.modal-title', title), headExtra ? headExtra() : null);
    const modal = h(`div.modal${cls ? '.' + cls.split(' ').join('.') : ''}`,
      h('button.modal-close', { title: 'Close (Esc)', on: { click: () => { sfx.click(); close(); } } }, '✕'),
      head, body);
    const el = h('div.modal-wrap', { on: { pointerdown: (e) => { if (e.target === el) close(); } } }, modal);
    ui.append(el);
    current = { name, el, body, modal, head, render, onClose, headExtra };
    sfx.open();
    app.onModalChange?.(true);
    rerender();
  }

  function rerender() {
    if (!current) return;
    const scroll = current.modal.scrollTop;
    current.body.replaceChildren(...[current.render()].flat(Infinity).filter(Boolean));
    if (current.headExtra) {
      current.head.replaceChildren(current.head.firstChild, current.headExtra());
    }
    current.modal.scrollTop = scroll;
  }

  const p = () => app.profile;
  const isGuest = () => app.mode !== 'wallet';
  const kbd = (k) => h('span.kbd', k);
  const rarityTag = (rid) => h('span.rar', { style: { color: RARITIES[rid].color } }, RARITIES[rid].label);

  async function act(fn, okMsg) {
    try {
      const res = await fn();
      if (okMsg) app.toast(typeof okMsg === 'function' ? okMsg(res) : okMsg, 'good');
      return res;
    } catch (err) {
      sfx.error();
      app.toast(err.message, 'error');
      return null;
    }
  }

  // ---------------------------------------------------------------------------------- how to
  function howTo() {
    open('howto', {
      title: 'How to play',
      cls: 'teal',
      render: () => [
        h('h3', 'One cast, four beats'),
        h('p', 'Walk to any edge of the pier and press ', kbd('E'), ' when it says FISH HERE.'),
        h('p', h('b', '1 · CAST'), ' — ', kbd('Space'), ' or click. The bobber lands where it lands.'),
        h('p', h('b', '2 · WAIT'), ' — a bite comes on its own. Nothing to time.'),
        h('p', h('b', '3 · REEL'), ' — HOLD ', kbd('Space'), ' or the mouse to pull. Progress and tension both rise; release to bleed tension while progress slips. When the fish ',
          h('b', 'SURGES'), ', let go — max tension ', h('span.hot', 'SNAPS'), ' the line.'),
        h('p', h('b', '4 · BANK OR PUSH'), ` — every landed fish bumps the multiplier (+${GAME.multStep.toFixed(2)}). `, kbd('B'),
          ' banks stringer × multiplier into the run. A snap loses the ', h('b', 'whole unbanked stringer'), '. When the oil runs out, ', kbd('R'), ' closes the results.'),
        h('h3', 'Luck'),
        h('p', 'Rods and bait add 🍀 luck. More luck means rarer fish bite more often. Buy them at the ⚓ shop with the gold you make selling fish.'),
        h('h3', 'The lantern'),
        h('p', `One lantern burns for ${GAME.oilMs / 1000} seconds. When the oil is out the run is scored. Banked fish go in your 🎒 backpack, which holds ${GAME.storageMax}. Sell them for gold at the fish rack, or hold the rare ones and cash them in at the reward pool. If the backpack is full when you bank, your cheapest fish are sold to make room.`),
        h('h3', 'The reward pool'),
        h('p', `A share of the $${CONFIG.tokenSymbol} creator fees fills a SOL pool. Rare, Epic, Legendary and Mythic fish can be cashed in for a fixed % of whatever is in the pool at that moment — the rarer the fish, the bigger the slice. To cash in you need a connected wallet holding at least $${CONFIG.minHoldUsd} of $${CONFIG.tokenSymbol}, and ${fmt.int(CONFIG.earnGate)} lifetime gold from selling fish.`),
        h('h3', 'On the deck'),
        h('p', kbd('W'), kbd('A'), kbd('S'), kbd('D'), ' walk · mouse or arrows look (click to grab the mouse) · ', kbd('Shift'), ' run · ', kbd('E'),
          ' interact (pier edge, shop, rod rack, fish rack, scores, reward chest) · ', kbd('E'), ' stop fishing · ', kbd('V'), ' view · ', kbd('P'), ' profile · ', kbd('M'), ' mute · ⌂ HOME (top left) comes back to the title.'),
      ],
    });
  }

  // ---------------------------------------------------------------------------------- fish rack
  function rack() {
    open('rack', {
      title: 'Fish rack',
      cls: 'wide',
      headExtra: () => h('button.pill-btn.ghost', { on: { click: () => catchLog() } }, 'catch log'),
      render: renderRack,
    });
  }

  // What you are carrying. Selling happens at the fish rack, so this is a view.
  function backpack() {
    open('backpack', {
      title: '🎒 Backpack',
      render: () => {
        const pr = p();
        const worth = (f) => RARITIES[SPECIES_BY_ID[f.sp].rarity].order * 1e6 + f.value;
        const fish = [...pr.storage].sort((a, b) => worth(b) - worth(a));
        const total = fish.reduce((s, f) => s + f.value, 0);
        const full = fish.length >= GAME.storageMax;
        return [
          h('div.stat-line', h('span', `${fish.length} / ${GAME.storageMax} fish`), h('span.cash', `worth ✦${fmt.int(total)}`)),
          h('p.note', full
            ? 'Your backpack is full. If you bank more fish, the cheapest ones are sold automatically.'
            : 'Sell fish for gold at the ✦ FISH RACK on the main deck. Cash rare ones in at the ◆ REWARD POOL chest.'),
          fish.length
            ? h('div.rows', fish.map((f) => {
              const sp = SPECIES_BY_ID[f.sp];
              return h('div.row',
                rarityTag(sp.rarity),
                h('div.fish-name', fishIcon(sp, 40), h('span', sp.name)),
                h('span.muted', fmt.kg(f.kg)),
                h('span.val', `✦${f.value}`),
                h('span'));
            }))
            : h('div.empty', 'Empty. Catch some fish and press B to bank them.'),
        ];
      },
    });
  }

  function poolStatus() {
    const pr = p();
    if (isGuest()) return { ok: false, why: 'connect a wallet on the title screen to cash in rare fish for SOL from the reward pool (RARE, EPIC, LEGENDARY, MYTHIC)' };
    if (!app.holding?.ok) return { ok: false, why: `hold at least $${CONFIG.minHoldUsd} of $${CONFIG.tokenSymbol} in this wallet to cash in rare fish` };
    if (pr.lifetimeCash < CONFIG.earnGate) return { ok: false, why: `sell ${fmt.int(CONFIG.earnGate - pr.lifetimeCash)} more gold worth of fish to unlock cash-ins` };
    return { ok: true, why: 'rare fish and up can be cashed in for a share of the reward pool' };
  }

  function renderRack() {
    const pr = p();
    const groups = new Map();
    for (const f of pr.storage) {
      if (!groups.has(f.sp)) groups.set(f.sp, []);
      groups.get(f.sp).push(f);
    }
    const sorted = [...groups.entries()].sort((a, b) => {
      const ra = RARITIES[SPECIES_BY_ID[a[0]].rarity].order, rb = RARITIES[SPECIES_BY_ID[b[0]].rarity].order;
      return rb - ra || SPECIES_BY_ID[a[0]].name.localeCompare(SPECIES_BY_ID[b[0]].name);
    });
    const status = poolStatus();
    const pool = app.poolInfo;
    const total = pr.storage.reduce((s, f) => s + f.value, 0);

    const rows = sorted.map(([sid, fish]) => {
      const sp = SPECIES_BY_ID[sid];
      fish.sort((a, b) => a.value - b.value);
      const r = RARITIES[sp.rarity];
      const canPool = r.poolPct > 0;
      const estimate = canPool && pool ? Math.floor(pool.availableLamports * r.poolPct) : 0;
      return h('div.row',
        rarityTag(sp.rarity),
        h('div.fish-name', fishIcon(sp, 40), h('span', `${sp.name} ×${fish.length}`)),
        h('span.val', `✦${fish[0].value}`),
        h('div', { style: { display: 'flex', gap: '6px' } },
          h('button.pill-btn', { on: { click: () => act(() => app.call('sell', [fish[0].id])).then((x) => x && sfx.coins()) } }, 'sell 1'),
          h('button.pill-btn.dark', { disabled: fish.length < 2, on: { click: () => act(() => app.call('sell', fish.map((f) => f.id))).then((x) => x && sfx.coins()) } }, 'sell all'),
        ),
        canPool
          ? h('button.pill-btn.teal', {
            disabled: !status.ok,
            title: status.ok ? 'Cash the biggest one in for SOL' : status.why,
            on: { click: () => cashIn([fish[fish.length - 1].id]) },
          }, `cash in ${estimate ? '≈' + fmt.sol(estimate, 3) : ''}`)
          : h('span'),
      );
    });

    const rareIds = pr.storage.filter((f) => RARITIES[SPECIES_BY_ID[f.sp].rarity].poolPct > 0).map((f) => f.id);
    return [
      h('div.stat-line', h('span.cash', `✦ ${fmt.int(pr.cash)} gold`), h('span.sol', `▲ ${fmt.sol(pr.claimable)} claimable`)),
      h('p.note', status.why),
      rows.length ? h('div.rows', rows) : h('div.empty', 'Nothing on the rack yet. Bank some fish at a fishing spot.'),
      h('div.row-foot',
        h('span', `🎒 ${pr.storage.length} / ${GAME.storageMax} in your backpack`),
        h('div', { style: { display: 'flex', gap: '8px' } },
          rareIds.length && status.ok ? h('button.pill-btn.teal', { on: { click: () => cashIn(rareIds) } }, `cash in all rare+ (${rareIds.length})`) : null,
          h('button.pill-btn', {
            disabled: !pr.storage.length,
            on: {
              click: () => {
                if (rareIds.length && !isGuest() && !confirm(`This also sells ${rareIds.length} rare fish that could be cashed in for SOL. Sell anyway?`)) return;
                act(() => app.call('sell', pr.storage.map((f) => f.id))).then((x) => x && sfx.coins());
              },
            },
          }, `sell everything ✦${fmt.int(total)}`),
        ),
      ),
    ];
  }

  async function cashIn(ids) {
    const res = await act(() => app.call('exchange', ids), (r) => `+${fmt.sol(r.total)} from the pool${r.capped ? ' (daily limit reached)' : ''}`);
    if (res) {
      sfx.bank();
      if (res.pool) app.poolInfo = res.pool;
      rerender();
    } else {
      app.recheckHolding?.();
    }
  }

  // ---------------------------------------------------------------------------------- shop
  let shopTab = 'rods';
  function shop(tab) {
    if (tab) shopTab = tab;
    open('shop', {
      title: '⚓ Tackle shop',
      cls: 'wide',
      headExtra: () => h('span', { style: { marginLeft: 'auto', fontSize: '14px' } }, h('span.cash', `✦ ${fmt.int(p().cash)} gold`)),
      render: renderShop,
    });
  }

  function priceButton(price, onBuy) {
    const can = p().cash >= price;
    return h('button.pill-btn', { disabled: !can, on: { click: onBuy } }, `✦ ${fmt.short(price)}`);
  }

  function renderShop() {
    const pr = p();
    const tabs = h('div.tabs', ['rods', 'bait', 'outfits'].map((t) =>
      h(`button.tab${shopTab === t ? '.active' : ''}`, { on: { click: () => { shopTab = t; sfx.click(); rerender(); } } }, t.toUpperCase())));
    let cards;
    if (shopTab === 'rods') {
      cards = RODS.map((r) => {
        const owned = pr.rods.includes(r.id);
        const eq = pr.rod === r.id;
        return h(`div.card${eq ? '.equipped' : ''}`,
          rodIcon(r),
          h('div.name', r.name),
          h('div.blurb', r.blurb),
          h('div.luck', `🍀 +${r.luck} luck`),
          r.glow ? h('div.extra', '✨ glowing rod + sparks') : null,
          h('div.foot', eq ? h('span.tag-eq', '✓ EQUIPPED')
            : owned ? h('button.pill-btn.ghost', { on: { click: () => act(() => app.call('equip', 'rod', r.id)) } }, 'equip')
              : priceButton(r.price, () => act(() => app.call('buy', 'rod', r.id), `${r.name} rod bought & equipped`).then((x) => x && sfx.coins()))),
        );
      });
    } else if (shopTab === 'bait') {
      cards = BAITS.map((b) => {
        const have = pr.baits?.[b.id] || 0;
        const on = pr.bait === b.id;
        return h(`div.card${on ? '.equipped' : ''}`,
          have ? h('span.count', `×${have}`) : null,
          baitIcon(b),
          h('div.name', b.name),
          h('div.blurb', b.blurb),
          h('div.luck', `🍀 +${b.luck} luck · ${b.pack} casts`),
          h('div.foot',
            priceButton(b.price, () => act(() => app.call('buy', 'bait', b.id), `${b.pack} × ${b.name}`).then((x) => x && sfx.coins())),
            have ? (on
              ? h('button.pill-btn.ghost', { on: { click: () => act(() => app.call('equip', 'bait', null)) } }, 'take off')
              : h('button.pill-btn.ghost', { on: { click: () => act(() => app.call('equip', 'bait', b.id)) } }, 'use')) : null,
          ),
        );
      });
    } else {
      cards = OUTFITS.map((o) => {
        const owned = pr.outfits.includes(o.id);
        const eq = pr.outfit === o.id;
        return h(`div.card${eq ? '.equipped' : ''}`,
          outfitIcon(o),
          h('div.name', o.name),
          h('div.blurb', o.blurb),
          h('div.foot', eq ? h('span.tag-eq', '✓ WEARING')
            : owned ? h('button.pill-btn.ghost', { on: { click: () => act(() => app.call('equip', 'outfit', o.id)) } }, 'wear')
              : priceButton(o.price, () => act(() => app.call('buy', 'outfit', o.id), `${o.name} unlocked`).then((x) => x && sfx.coins()))),
        );
      });
    }
    const note = shopTab === 'rods'
      ? 'Luck shifts the odds toward rarer fish. Better rods also hold a little more tension.'
      : shopTab === 'bait' ? 'Bait goes on the hook and is used up one per cast. Its luck stacks with your rod.'
        : 'Outfits are cosmetic.';
    return [tabs, h('p.note', note), h('div.cards', cards)];
  }

  // ---------------------------------------------------------------------------------- rod rack
  function rods() {
    open('rods', {
      title: 'Choose your rod',
      cls: 'wide',
      render: () => {
        const pr = p();
        return [
          h('p.note', 'luck changes which fish bite · 🔒 ones unlock at the ⚓ shop'),
          h('div.cards', RODS.map((r) => {
            const owned = pr.rods.includes(r.id);
            const eq = pr.rod === r.id;
            return h(`div.card${eq ? '.equipped' : ''}${owned ? '' : '.locked'}`,
              { style: { cursor: owned && !eq ? 'pointer' : 'default' }, on: { click: () => { if (owned && !eq) act(() => app.call('equip', 'rod', r.id)); } } },
              rodIcon(r, { dim: !owned }),
              h('div.name', r.name),
              h('div.blurb', r.blurb),
              h('div.luck', `🍀 +${r.luck} luck`),
              h('div.foot', eq ? h('span.tag-eq', '✓ EQUIPPED') : owned ? h('span.note', 'click to equip')
                : h('button.pill-btn.dark', { on: { click: (e) => { e.stopPropagation(); shop('rods'); } } }, `🔒 ✦${fmt.short(r.price)}`)),
            );
          })),
        ];
      },
    });
  }

  // ---------------------------------------------------------------------------------- catch log
  function catchLog() {
    open('log', {
      title: 'Catch log',
      cls: 'wide',
      render: () => {
        const log = p()?.log || {};
        const found = SPECIES.filter((s) => log[s.id]).length;
        return [
          h('p.note', `${found} / ${SPECIES.length} species found`),
          h('div.cards', SPECIES.map((sp) => {
            const e = log[sp.id];
            return h(`div.card${e ? '' : '.unknown'}`, { style: { minHeight: '170px' } },
              e ? h('span.count', `×${e.n}`) : null,
              fishIcon(sp, 90),
              h('div.name', e ? sp.name : '???'),
              rarityTag(sp.rarity),
              h('div.blurb', e ? `${sp.blurb} Best ${fmt.kg(e.maxKg)}.` : 'Not caught yet.'),
            );
          })),
        ];
      },
    });
  }

  // ---------------------------------------------------------------------------------- leaderboard
  function leaderboard() {
    let data = null;
    let failed = false;
    app.backend.leaderboard().then((d) => { data = d; rerender(); }).catch(() => { failed = true; rerender(); });
    open('leaderboard', {
      title: 'Leaderboard',
      render: () => {
        if (failed) return h('div.empty', 'Leaderboard is offline right now.');
        if (!data) return h('div.empty', 'Loading…');
        const me = app.session?.wallet ? shortAddress(app.session.wallet) : null;
        return [
          h('p.note', `Best single-lantern run. Your best: ${fmt.int(p()?.best || 0)}${data.me?.rank ? ` (#${data.me.rank})` : ''}${data.offline ? ' · server offline, showing this device only' : ''}`),
          data.top.length
            ? h('table.table',
              h('tr', h('th', '#'), h('th', 'angler'), h('th', 'best run'), h('th', 'fish')),
              data.top.map((r, i) => h(`tr${r.name === me ? '.me' : ''}`, h('td', i + 1), h('td', r.name), h('td.cash', fmt.int(r.best)), h('td', fmt.int(r.landed)))))
            : h('div.empty', 'No runs yet. Be the first.'),
        ];
      },
    });
  }

  // ---------------------------------------------------------------------------------- profile
  function profile() {
    open('profile', {
      title: 'Profile',
      render: () => {
        const pr = p();
        const hold = app.holding;
        const stat = (label, value, cls = '') => h('div', label, h(`b${cls}`, value));
        return [
          isGuest()
            ? h('p', 'Playing as ', h('b', 'guest'), ' — progress is saved on this device only. ',
              h('button.pill-btn.teal', { on: { click: () => { close(); app.connectWallet(); } } }, 'connect wallet'))
            : h('p', 'Wallet ', h('b', { style: { fontFamily: 'ui-monospace, monospace' } }, shortAddress(app.session.wallet)), ' ',
              h('button.pill-btn.dark', { on: { click: () => { close(); app.disconnect(); } } }, 'disconnect')),
          h('div.results-grid',
            stat('gold', `✦${fmt.int(pr.cash)}`),
            stat('lifetime gold', fmt.int(pr.lifetimeCash)),
            stat('best run', fmt.int(pr.best)),
            stat('runs', fmt.int(pr.runs)),
            stat('fish landed', fmt.int(pr.landed)),
            stat('snaps', fmt.int(pr.snaps)),
            stat('luck', `🍀 ${pr.luck}`),
            stat('species', `${Object.keys(pr.log).length} / ${SPECIES.length}`),
          ),
          isGuest() ? null : [
            h('h3', 'Reward pool'),
            h('div.check-list',
              check(!!hold?.ok, hold?.dev ? `holding check off (dev mode)` : hold?.ok
                ? `holding ${fmt.int(hold.balance)} $${CONFIG.tokenSymbol} ≈ ${fmt.usd(hold.usd)}`
                : hold?.error ? `couldn't check holdings: ${hold.error}` : `holding ${fmt.int(hold?.balance || 0)} $${CONFIG.tokenSymbol} ≈ ${fmt.usd(hold?.usd || 0)} — need $${CONFIG.minHoldUsd}`),
              check(pr.lifetimeCash >= CONFIG.earnGate, `lifetime gold ${fmt.int(pr.lifetimeCash)} / ${fmt.int(CONFIG.earnGate)}`),
            ),
            h('p', 'claimable ', h('span.sol', fmt.sol(pr.claimable)), ' · earned all-time ', h('span.sol', fmt.sol(pr.totalEarned))),
            h('div', { style: { display: 'flex', gap: '8px' } },
              h('button.pill-btn.ghost', { on: { click: () => app.recheckHolding(true) } }, 're-check holdings'),
              h('button.pill-btn.teal', { on: { click: () => { close(); pool(); } } }, 'reward pool'),
            ),
          ],
        ];
      },
    });
  }

  function check(ok, text) {
    return h(`div.check.${ok ? 'ok' : 'no'}`, h('span.mark', ok ? '✓' : '✕'), h('span', text));
  }

  // ---------------------------------------------------------------------------------- pool
  function pool() {
    let payouts = null;
    const load = () => app.backend.pool().then((d) => { app.poolInfo = d; rerender(); }).catch(() => { app.poolInfo = null; rerender(); });
    load();
    if (!isGuest()) app.backend.payouts().then((d) => { payouts = d.payouts; rerender(); }).catch(() => {});
    open('pool', {
      title: '◆ Reward pool',
      cls: 'wide',
      render: () => {
        const pr = p();
        const info = app.poolInfo;
        const odds = rarityOdds(pr.luck || 0);
        const status = poolStatus();
        return [
          h('p', `A share of the $${CONFIG.tokenSymbol} creator fees fills this pool. Each rare-or-better fish you cash in pays a fixed % of what is in the pool at that moment, so the pool never runs dry.`),
          h('div.stat-line', { style: { fontSize: '16px', margin: '10px 0' } },
            h('span', 'in the pool ', h('span.sol', info ? fmt.sol(info.availableLamports, 3) : 'offline')),
            info?.paidLamports ? h('span.muted', `paid out ${fmt.sol(info.paidLamports, 2)}`) : null),
          h('table.table',
            h('tr', h('th', 'rarity'), h('th', 'your odds'), h('th', 'pool share'), h('th', 'one fish now')),
            RARITY_IDS.map((rid) => {
              const r = RARITIES[rid];
              return h('tr',
                h('td', rarityTag(rid)),
                h('td', `${(odds[rid] * 100).toFixed(odds[rid] < 0.01 ? 2 : 1)}%`),
                h('td', r.poolPct ? fmt.pct(r.poolPct) : h('span.muted', 'cash only')),
                h('td', r.poolPct ? h('span.sol', info ? fmt.sol(Math.floor(info.availableLamports * r.poolPct)) : '—') : h('span.cash', `✦${r.sell}`)));
            })),
          h('h3', 'Your status'),
          isGuest()
            ? h('p', 'Guests can fish and sell for gold. ', h('button.pill-btn.teal', { on: { click: () => { close(); app.connectWallet(); } } }, 'connect wallet'), ' to cash in.')
            : [
              h('div.check-list',
                check(true, `wallet ${shortAddress(app.session.wallet)}`),
                check(!!app.holding?.ok, app.holding?.dev ? 'holding check off (dev mode)' : `holds ≥ $${CONFIG.minHoldUsd} of $${CONFIG.tokenSymbol}${app.holding ? ` (now ${fmt.usd(app.holding.usd || 0)})` : ''}`),
                check(pr.lifetimeCash >= CONFIG.earnGate, `${fmt.int(CONFIG.earnGate)} lifetime gold (${fmt.int(pr.lifetimeCash)})`),
              ),
              h('p.note', status.ok ? `Daily limit per wallet: ${fmt.pct(info?.dailyCapPct ?? 0.05)} of the pool.` : status.why),
              h('div.stat-line', { style: { marginTop: '10px' } },
                h('span', 'claimable ', h('span.sol', fmt.sol(pr.claimable))),
                h('button.pill-btn.teal', {
                  disabled: pr.claimable < GAME.minClaimLamports,
                  on: {
                    click: async () => {
                      const res = await act(() => app.call('claim'), (r) => `Claim of ${fmt.sol(r.payout.lamports)} queued — it will be sent to your wallet`);
                      if (res) app.backend.payouts().then((d) => { payouts = d.payouts; rerender(); }).catch(() => {});
                    },
                  },
                }, `claim to wallet`),
                h('span.note', `min ${fmt.sol(GAME.minClaimLamports, 2)}`),
              ),
              payouts?.length ? h('table.table',
                h('tr', h('th', 'claim'), h('th', 'amount'), h('th', 'status')),
                payouts.slice(0, 6).map((po) => h('tr', h('td', new Date(po.created).toLocaleString()), h('td.sol', fmt.sol(po.lamports)),
                  h('td', po.tx ? h('a', { href: `https://solscan.io/tx/${po.tx}`, target: '_blank', rel: 'noopener' }, po.status) : po.status)))) : null,
            ],
          h('div', { style: { marginTop: '14px' } }, h('button.pill-btn', { on: { click: () => rack() } }, 'open the fish rack')),
        ];
      },
    });
  }

  // ---------------------------------------------------------------------------------- settings
  function settings() {
    open('settings', {
      title: 'Settings',
      render: () => {
        const s = app.settings;
        const seg = (key, options) => h('div.seg', options.map(([v, label]) =>
          h(`button${s[key] === v ? '.on' : ''}`, { on: { click: () => { s[key] = v; app.saveSettings(); rerender(); } } }, label)));
        return [
          h('div.setting', h('span', 'Volume'), h('input', {
            type: 'range', min: 0, max: 1, step: 0.05, value: sfx.volume,
            on: { input: (e) => sfx.setVolume(Number(e.target.value)) },
          })),
          h('div.setting', h('span', 'Sound'), h('div.seg',
            h(`button${!sfx.muted ? '.on' : ''}`, { on: { click: () => { app.setMuted(false); rerender(); } } }, 'on'),
            h(`button${sfx.muted ? '.on' : ''}`, { on: { click: () => { app.setMuted(true); rerender(); } } }, 'muted'))),
          h('div.setting', h('span', 'Graphics'), seg('quality', [['high', 'high'], ['medium', 'medium'], ['low', 'low']])),
          h('div.setting', h('span', 'Mouse sensitivity'), h('input', {
            type: 'range', min: 0.3, max: 2.5, step: 0.1, value: s.sensitivity,
            on: { input: (e) => { s.sensitivity = Number(e.target.value); app.saveSettings(); } },
          })),
          h('div.setting', h('span', 'Invert look'), seg('invertY', [[false, 'off'], [true, 'on']])),
        ];
      },
    });
  }

  function credits() {
    open('credits', {
      title: 'Credits',
      render: () => [
        h('p', `${CONFIG.gameName} — a fishing game for $${CONFIG.tokenSymbol} holders.`),
        h('p.muted', 'Built with three.js. Every model, texture and sound is generated in code.'),
        h('p.muted', 'Gold and items have no value outside the game. Pool cash-ins are paid in SOL from the creator-fee pool, at the rates shown in the reward pool.'),
      ],
    });
  }

  // ---------------------------------------------------------------------------------- results
  function results(res, onDone) {
    open('results', {
      title: "Lantern's out",
      onClose: onDone,
      render: () => [
        res.newBest ? h('p', { style: { color: 'var(--gold)', fontWeight: 700 } }, '★ NEW BEST RUN ★') : null,
        h('div.results-grid',
          h('div.results-score', 'run score', h('b', fmt.int(res.score))),
          h('div', 'best', h('b', fmt.int(res.best))),
          h('div', 'fish landed', h('b', res.landed)),
          h('div', 'banked', h('b', res.banked)),
          h('div', 'snaps', h('b', res.snaps)),
          h('div', 'got away', h('b', res.escapes)),
        ),
        res.autoBanked ? h('p.note', `Your last stringer (${res.autoBanked.count} fish) was banked automatically at ×${res.autoBanked.mult.toFixed(2)}.`) : null,
        h('p.note', 'Banked fish are waiting on the fish rack. ', kbd('R'), ' or ', kbd('Esc'), ' to close.'),
        h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } },
          h('button.pill-btn', { on: { click: () => close() } }, 'fish again'),
          h('button.pill-btn.dark', { on: { click: () => { close(); app.leaveFishing(); } } }, 'back to the deck')),
      ],
    });
  }

  function noWallet() {
    open('nowallet', {
      title: 'Connect a wallet',
      render: () => [
        h('p', 'You need a Solana wallet to save progress and cash in fish.'),
        isMobile()
          ? h('p', h('a.pill-btn.teal', { href: phantomDeepLink(), style: { textDecoration: 'none', display: 'inline-block' } }, 'open in Phantom'))
          : h('p', 'Install ', h('a', { href: 'https://phantom.app/', target: '_blank', rel: 'noopener' }, 'Phantom'), ', ',
            h('a', { href: 'https://solflare.com/', target: '_blank', rel: 'noopener' }, 'Solflare'), ' or ',
            h('a', { href: 'https://backpack.app/', target: '_blank', rel: 'noopener' }, 'Backpack'), ', then reload this page.'),
        h('p.muted', 'Or play as a guest — progress stays on this device.'),
        h('button.pill-btn', { on: { click: () => { close(); app.playGuest(); } } }, 'play as guest'),
      ],
    });
  }

  return {
    howTo, rack, backpack, shop, rods, catchLog, leaderboard, profile, pool, settings, credits, results, noWallet,
    close, rerender,
    get open() { return current?.name || null; },
  };
}
