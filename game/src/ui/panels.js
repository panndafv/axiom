import { h, svg, fmt } from './dom.js';
import { fishIcon, rodIcon, baitIcon, outfitIcon, haloIcon } from './icons.js';
import { CONFIG } from '../config.js';
import {
  GAME, RARITIES, RARITY_IDS, SPECIES, SPECIES_BY_ID, RODS, RODS_BY_ID, BAITS, BAITS_BY_ID, OUTFITS, HALOS, HALOS_BY_ID, rarityOdds, speciesOdds,
  speciesPoolPct, fishValue, sellPrice, SHIRT_COLORS, WHEEL,
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
    loadPool();
    open('howto', {
      title: 'How to play',
      cls: 'teal',
      render: () => [
        h('div.hold-note',
          h('b', `You need at least $${CONFIG.minHoldUsd} of $${CONFIG.tokenSymbol} in your wallet to play for the reward pool.`),
          h('span', `Guests can fish for gold for free, but only wallets holding $${CONFIG.minHoldUsd} or more can cash fish in for SOL.`)),
        h('h3', 'Fishing'),
        h('p', 'Walk to any edge of the pier and press ', kbd('E'), ' when it says FISH HERE. Fish as long as you like and press ', kbd('E'), ' again to stop.'),
        h('p', h('b', 'CAST'), ' — ', kbd('Space'), ' or click. The bobber lands where it lands.'),
        h('p', h('b', 'WAIT'), ' — a bite comes on its own. Nothing to time.'),
        h('p', h('b', 'REEL'), ' — HOLD ', kbd('Space'), ' or the mouse to pull. Progress and tension both rise; release to bleed tension while progress slips. When the fish ',
          h('b', 'SURGES'), ', let go: max tension ', h('span.hot', 'SNAPS'), ' the line and the fish is gone.'),
        h('h3', 'Your backpack'),
        h('p', `Every fish you land goes straight into your 🎒 backpack, which holds ${GAME.storageMax}. Sell them for gold at the fish rack, or hold the rare ones and cash them in at the reward pool. When the backpack is full, sell some before you cast again.`),
        h('h3', 'Luck'),
        h('p', 'Rods and bait add 🍀 luck. More luck means rarer fish bite more often. Buy them at the ⚓ shop with the gold you make selling fish.'),
        h('p', 'Every 10th cast is a ', h('b', { style: { color: '#ffd34d' } }, 'GOLDEN CAST'), ' with 2× luck, and every 50th a ',
          h('b', { style: { color: '#ff7ad9' } }, 'RAINBOW CAST'), ' with 5× luck. The counters at the bottom of the screen show how close the next one is.'),
        h('h3', 'Halos'),
        h('p', 'Halos float over your head and add 5% to 35% to the gold every fish sells for. Find them in the halos tab at the ⚓ shop. What you have on (rod, bait, halo) shows at the top right.'),
        h('h3', 'The prize wheel'),
        h('p', `Out on the island, across the campfire from the scoreboard. Your first spin every day is free, then each spin is ✦${fmt.int(WHEEL.cost)}. It pays out gold, bait and rods, and 1 spin in 100 lands on the `,
          h('b', { style: { color: '#ff6fcf' } }, 'WHEEL ROD'), ` (🍀 +${RODS_BY_ID.wheel.luck} luck), which you can't buy anywhere.`),
        h('h3', 'Lobbies'),
        h('p', 'Up to 25 anglers share a pier. When someone in your lobby lands an Epic or rarer fish, everyone hears about it.'),
        h('h3', 'The reward pool'),
        h('p', `A share of the $${CONFIG.tokenSymbol} creator fees fills a SOL pool. Rare, Epic, Legendary and Mythic fish can be cashed in at the ◆ reward pool chest on the pier for a fixed % of whatever is in the pool at that moment. The rarer the fish, the bigger the slice, and the pool never runs dry.`),
        poolTable(),
        h('p', 'To cash in you need:'),
        h('ul.howto-list',
          h('li', 'a connected wallet (guests can only sell fish for gold)'),
          h('li', `at least $${CONFIG.minHoldUsd} of $${CONFIG.tokenSymbol} in that wallet, checked live when you cash in`),
          CONFIG.earnGate > 0 ? h('li', `${fmt.int(CONFIG.earnGate)} fish sold at the fish rack, so you have actually played first`) : null),
        h('p', `Each wallet can cash in up to ${dailyFish()} fish, and take up to ${fmt.pct(app.poolInfo?.dailyCapPct ?? 0.1)} of the pool, in any 24 hours. `,
          CONFIG.autoPayouts
            ? 'Every cash-in is sent straight to your wallet, and the reward pool lists each one with its transaction on Solscan.'
            : `Cash-ins add to your claimable SOL. Claim it at the chest (min ${fmt.sol(GAME.minClaimLamports, 2)}) and it is sent to your wallet; the reward pool shows each payout's Solscan transaction once it has gone out.`),
        h('h3', 'On the deck'),
        h('p', kbd('W'), kbd('A'), kbd('S'), kbd('D'), ' walk · mouse or arrows look (click to grab the mouse) · ', kbd('Shift'), ' run · ', kbd('E'),
          ' interact (pier edge, shop, rod rack, fish rack, scores, prize wheel, reward chest) · ', kbd('E'), ' stop fishing · ', kbd('V'), ' view · ', kbd('P'), ' profile · ', kbd('M'), ' mute · ⌂ HOME (top left) comes back to the title.'),
      ],
    });
  }

  // ---------------------------------------------------------------------------------- fish rack
  function rack() {
    loadPayouts();
    app.recheckHolding?.(); // so an out-of-date holding check never blocks a cash-in
    open('rack', {
      title: 'Fish rack',
      cls: 'wide',
      headExtra: () => h('button.pill-btn.ghost', { on: { click: () => catchLog() } }, 'catch log'),
      render: renderRack,
    });
  }

  // most fish one wallet can cash in per 24 hours (the server's number when we have it)
  const dailyFish = () => app.poolInfo?.dailyFish ?? GAME.dailyCashInFish;

  // ok: everything checks out. canTry: the cash-in buttons work. A failed holding check still
  // lets you try, because the server checks again (the one we have may be out of date).
  function poolStatus() {
    const pr = p();
    if (isGuest()) return { ok: false, canTry: false, why: 'connect a wallet on the title screen to cash in rare fish for SOL from the reward pool (RARE, EPIC, LEGENDARY, MYTHIC)' };
    if ((pr.sold || 0) < CONFIG.earnGate) return { ok: false, canTry: false, why: `sell ${fmt.int(CONFIG.earnGate - (pr.sold || 0))} more fish at the rack to unlock cash-ins` };
    if ((pr.cashedToday || 0) >= dailyFish()) return { ok: false, canTry: false, why: `you've cashed in ${dailyFish()} fish today, the most for one day. Come back tomorrow.` };
    const hold = app.holding;
    if (!hold?.ok) {
      const why = hold?.error
        ? `couldn't check this wallet's $${CONFIG.tokenSymbol}: ${hold.error}`
        : hold && Number.isFinite(hold.usd)
          ? `this wallet holds ${fmt.usd(hold.usd)} of $${CONFIG.tokenSymbol}; $${CONFIG.minHoldUsd} is needed to cash in rare fish`
          : `hold at least $${CONFIG.minHoldUsd} of $${CONFIG.tokenSymbol} in this wallet to cash in rare fish`;
      return { ok: false, canTry: true, why };
    }
    return { ok: true, canTry: true, why: `rare fish and up can be cashed in for a share of the reward pool · ${pr.cashedToday || 0} / ${dailyFish()} cashed in today` };
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
    const total = pr.storage.reduce((s, f) => s + sellPrice(f.value, pr.halo), 0);
    const halo = HALOS_BY_ID[pr.halo];

    const rows = sorted.map(([sid, fish]) => {
      const sp = SPECIES_BY_ID[sid];
      fish.sort((a, b) => a.value - b.value);
      const r = RARITIES[sp.rarity];
      const canPool = speciesPoolPct(sid) > 0;
      const estimate = canPool && pool ? Math.floor(pool.availableLamports * speciesPoolPct(sid)) : 0;
      return h('div.row',
        rarityTag(sp.rarity),
        h('div.fish-name', fishIcon(sp, 40), h('span', `${sp.name} ×${fish.length}`)),
        h('span.val', `✦${sellPrice(fish[0].value, pr.halo)}`),
        h('div', { style: { display: 'flex', gap: '6px' } },
          h('button.pill-btn', { on: { click: () => act(() => app.call('sell', [fish[0].id])).then((x) => x && sfx.coins()) } }, 'sell 1'),
          h('button.pill-btn.dark', { disabled: fish.length < 2, on: { click: () => act(() => app.call('sell', fish.map((f) => f.id))).then((x) => x && sfx.coins()) } }, 'sell all'),
        ),
        canPool
          ? h('button.pill-btn.teal', {
            disabled: !status.canTry,
            title: status.ok ? 'Cash the biggest one in for SOL' : status.why,
            on: { click: () => cashIn([fish[fish.length - 1].id]) },
          }, `cash in ${estimate ? '≈' + fmt.sol(estimate, 3) : ''}`)
          : h('span'),
      );
    });

    const rareIds = pr.storage.filter((f) => speciesPoolPct(f.sp) > 0).map((f) => f.id);
    return [
      h('div.stat-line', h('span.cash', `✦ ${fmt.int(pr.cash)} gold`), h('span.sol', `▲ ${fmt.sol(pr.claimable)} claimable`)),
      h('p.note', status.why),
      halo ? h('p.note', { style: { color: 'var(--gold)' } }, `${halo.name}: +${Math.round(halo.gold * 100)}% gold on every fish you sell (included in these prices)`) : null,
      rows.length ? h('div.rows', rows) : h('div.empty', 'Your backpack is empty. Catch some fish first.'),
      h('div.row-foot',
        h('span', `🎒 ${pr.storage.length} / ${GAME.storageMax} in your backpack`),
        h('div', { style: { display: 'flex', gap: '8px' } },
          rareIds.length && status.canTry ? h('button.pill-btn.teal', { on: { click: () => cashIn(rareIds) } }, `cash in all rare+ (${rareIds.length})`) : null,
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
      payouts?.length ? [
        h('h3', 'Your latest payouts'),
        payoutTable(payouts.slice(0, 3)),
        h('button.pill-btn.ghost', { on: { click: () => pool() } }, 'all payouts'),
      ] : null,
    ];
  }

  // Your payouts, newest first, each with its Solscan transaction. While one is still on its way,
  // look again every few seconds (only while a panel that shows them is open).
  let payouts = null;
  let payoutTimer = null;
  function loadPayouts() {
    clearTimeout(payoutTimer);
    if (isGuest()) { payouts = null; return; }
    app.backend.payouts().then((d) => {
      payouts = d.payouts;
      rerender();
      const waiting = payouts.some((po) => po.status === 'sent' || (CONFIG.autoPayouts && po.status === 'pending'));
      if (waiting) {
        payoutTimer = setTimeout(() => { if (current?.name === 'pool' || current?.name === 'rack') loadPayouts(); }, 4000);
      }
    }).catch(() => {});
  }

  const PAYOUT_STATUS = { pending: 'queued', sent: 'confirming…', paid: 'paid ✓', failed: 'failed' };
  function payoutTable(list) {
    return h('table.table.payouts',
      h('tr', h('th', 'when'), h('th', 'amount'), h('th', 'status'), h('th', 'transaction')),
      list.map((po) => h('tr',
        h('td', new Date(po.created).toLocaleString()),
        h('td.sol', fmt.sol(po.lamports)),
        h(`td.st-${po.status}`, PAYOUT_STATUS[po.status] || po.status,
          po.status === 'failed' && po.error ? h('div.note', po.error) : null),
        h('td', po.tx && po.status !== 'failed'
          ? h('a', { href: CONFIG.txUrl(po.tx), target: '_blank', rel: 'noopener' }, 'view on Solscan ↗')
          : h('span.muted', po.status === 'pending' ? (CONFIG.autoPayouts ? 'sending…' : 'waiting to be sent') : '—')))));
  }

  async function cashIn(ids) {
    const res = await act(() => app.call('exchange', ids));
    if (res) {
      sfx.bank();
      const po = res.payout;
      const capped = res.capped ? ' (daily limit reached)' : '';
      if (po?.status === 'failed') {
        app.toast(`+${fmt.sol(res.total)} from the pool, but it could not be sent: ${po.error} It is in your claimable balance.`, 'error');
      } else if (po?.tx) {
        app.toast(`Sent ${fmt.sol(res.total)} to your wallet${capped}`, 'good', { href: CONFIG.txUrl(po.tx), text: 'view on Solscan ↗' });
      } else if (po) {
        app.toast(`+${fmt.sol(res.total)} from the pool${capped}, sending it to your wallet…`, 'good');
      } else {
        app.toast(`+${fmt.sol(res.total)} from the pool${capped}. Claim it at the reward pool.`, 'good');
      }
      if (res.pool) app.poolInfo = res.pool;
      loadPayouts();
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
    const tabs = h('div.tabs', ['rods', 'bait', 'halos', 'outfits'].map((t) =>
      h(`button.tab${shopTab === t ? '.active' : ''}`, { on: { click: () => { shopTab = t; sfx.click(); rerender(); } } }, t.toUpperCase())));
    let cards;
    if (shopTab === 'rods') {
      cards = RODS.filter((r) => !r.hidden || pr.rods.includes(r.id)).map((r) => {
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
    } else if (shopTab === 'halos') {
      cards = HALOS.map((hl) => {
        const owned = pr.halos?.includes(hl.id);
        const on = pr.halo === hl.id;
        return h(`div.card${on ? '.equipped' : ''}`,
          haloIcon(hl, 80),
          h('div.name', hl.name),
          h('div.blurb', hl.blurb),
          h('div.luck', { style: { color: 'var(--gold)' } }, `✦ +${Math.round(hl.gold * 100)}% gold from fish`),
          h('div.foot', on
            ? h('button.pill-btn.ghost', { on: { click: () => act(() => app.call('equip', 'halo', null)) } }, 'take off')
            : owned ? h('button.pill-btn.ghost', { on: { click: () => act(() => app.call('equip', 'halo', hl.id)) } }, 'wear')
              : priceButton(hl.price, () => act(() => app.call('buy', 'halo', hl.id), `${hl.name} on!`).then((x) => x && sfx.coins()))),
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
        : shopTab === 'halos' ? 'A halo floats over your head and adds to the gold every fish sells for. Everyone on the pier can see it.'
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
            if (r.hidden && !owned) {
              return h('div.card.locked',
                rodIcon(r, { dim: true }),
                h('div.name', '???'),
                h('div.blurb', r.from === 'wheel' ? 'Spin the prize wheel on the island: 1 spin in 100.' : 'Hidden somewhere on the pier. Not for sale.'),
                h('div.luck', `🍀 +${r.luck} luck`),
                h('div.foot', h('span.note', r.from === 'wheel' ? '🔒 win it' : '🔒 find it')));
            }
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
  // Rarities in columns, two per column, rarest on the right.
  const LOG_COLUMNS = [['common', 'uncommon'], ['rare', 'epic'], ['legendary', 'mythic']];
  function catchLog() {
    open('log', {
      title: 'Catch log',
      cls: 'wide',
      render: () => {
        const log = p()?.log || {};
        const found = SPECIES.filter((sp) => log[sp.id]).length;
        const row = (sp) => {
          const e = log[sp.id];
          const r = RARITIES[sp.rarity];
          return h(`div.log-row${e ? '' : '.unknown'}`,
            fishIcon(sp, 44, { silhouette: !e }),
            h('div',
              h('div.nm', e ? sp.name : '??????', sp.special && e ? h('span.special', ' ★') : null),
              h('div.sub', e ? `✦${fishValue(sp, e.maxKg)} best · ${fmt.kg(e.maxKg)}` : 'not caught')),
            h('span.count', { style: e ? { color: r.color } : null }, e ? `×${e.n}` : '–'));
        };
        return [
          h('p.note', `${found} / ${SPECIES.length} species found · ★ the Ghost Whale is the rarest fish in the sea`),
          h('div.log-cols', LOG_COLUMNS.map((ids) => h('div.log-col', ids.map((rid) => {
            const list = SPECIES.filter((sp) => sp.rarity === rid);
            const got = list.filter((sp) => log[sp.id]).length;
            return h('section',
              h('div.log-head', { style: { color: RARITIES[rid].color } }, RARITIES[rid].label.toUpperCase(), h('span', `${got}/${list.length}`)),
              list.map(row));
          })))),
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
        const me = app.session?.wallet ? shortAddress(app.session.wallet) : null; // rows carry the short address next to any chosen name
        return [
          h('p.note', `Ranked by the total value of every fish caught. Yours: ✦${fmt.int(p()?.caught || 0)}${data.me?.rank ? ` (#${data.me.rank})` : ''}${data.offline ? ' · server offline, showing this device only' : ''}`),
          data.top.length
            ? h('table.table',
              h('tr', h('th', '#'), h('th', 'angler'), h('th', 'catch value'), h('th', 'fish')),
              data.top.map((r, i) => h(`tr${(r.wallet || r.name) === me ? '.me' : ''}`, h('td', i + 1),
                h('td', r.name, r.wallet && r.wallet !== r.name ? h('span.muted', { style: { fontSize: '11px', marginLeft: '6px' } }, r.wallet) : null),
                h('td.cash', `✦${fmt.int(r.caught)}`), h('td', fmt.int(r.landed)))))
            : h('div.empty', 'No catches yet. Be the first.'),
        ];
      },
    });
  }

  // ---------------------------------------------------------------------------------- prize wheel
  const WHEEL_TOTAL = WHEEL.prizes.reduce((sum, z) => sum + z.chance, 0);
  // Each prize's slice, in degrees clockwise from the top.
  const WHEEL_SLICES = (() => {
    let a = 0;
    return WHEEL.prizes.map((z) => {
      const sweep = (z.chance / WHEEL_TOTAL) * 360;
      const slice = { from: a, to: a + sweep, mid: a + sweep / 2, sweep };
      a += sweep;
      return slice;
    });
  })();
  const rodName = (rod) => (/rod$/i.test(rod.name) ? rod.name : `${rod.name} rod`);

  // The wheel drawn in SVG, the same layout as the one on the island. Its .wheel-rot group turns.
  function wheelSvg() {
    const R = 100;
    const pt = (deg, r = R) => {
      const a = (deg * Math.PI) / 180;
      return `${(Math.sin(a) * r).toFixed(2)} ${(-Math.cos(a) * r).toFixed(2)}`;
    };
    const slices = WHEEL.prizes.map((z, i) => {
      const s = WHEEL_SLICES[i];
      const label = s.sweep > 12
        ? `<text transform="rotate(${s.mid.toFixed(2)}) translate(0 ${-R + 8}) rotate(-90)" text-anchor="end" dominant-baseline="central"
             font-size="${Math.min(11.5, s.sweep * 0.42).toFixed(1)}" class="wheel-label">${z.label}</text>`
        : `<text transform="rotate(${s.mid.toFixed(2)}) translate(0 ${-R + 10})" text-anchor="middle" dominant-baseline="central"
             font-size="10" class="wheel-star">★</text>`;
      return `<path d="M0 0 L${pt(s.from)} A${R} ${R} 0 ${s.sweep > 180 ? 1 : 0} 1 ${pt(s.to)} Z" fill="${z.color}"/>${label}`;
    }).join('');
    const pegs = WHEEL_SLICES.map((s) => `<circle cx="${pt(s.from, R - 3).split(' ')[0]}" cy="${pt(s.from, R - 3).split(' ')[1]}" r="2.3" class="wheel-peg"/>`).join('');
    const bulbs = Array.from({ length: 24 }, (_, i) => {
      const [x, y] = pt(i * 15, 107).split(' ');
      return `<circle cx="${x}" cy="${y}" r="3" class="bulb${i % 2 ? ' b' : ''}"/>`;
    }).join('');
    return svg(`
      <svg class="wheel-svg" viewBox="-118 -124 236 242" aria-hidden="true">
        <circle r="113" class="wheel-frame"/>
        <g class="wheel-rot">
          ${slices}
          <circle r="${R}" class="wheel-edge"/>
          <circle r="${R - 7}" class="wheel-shade"/>
          ${pegs}
          <circle r="20" class="wheel-hub"/>
        </g>
        ${bulbs}
        <circle r="8" class="wheel-cap"/>
        <path d="M-10 -122 L10 -122 L0 -95 Z" class="wheel-pointer"/>
      </svg>`);
  }

  function wheelPrizeLine(res) {
    const z = WHEEL.prizes.find((x) => x.id === res.prize);
    if (z.kind === 'gold') return { kind: 'gold', big: `✦ ${fmt.int(res.gold)} gold`, line: 'Straight into your purse.' };
    if (z.kind === 'bait') {
      const b = BAITS_BY_ID[z.item];
      return { kind: 'bait', big: `${b.pack} × ${b.name}`, line: `🍀 +${b.luck} luck bait, in your tackle box.` };
    }
    const rod = RODS_BY_ID[z.item];
    if (res.duplicate) {
      return { kind: 'gold', big: `✦ ${fmt.int(res.gold)} gold`, line: `${rodName(rod)}! You already have it, so here's gold instead.` };
    }
    return { kind: z.item === 'wheel' ? 'jackpot' : 'rod', big: rodName(rod), line: `🍀 +${rod.luck} luck. It's on your rod rack now.` };
  }

  function wheel() {
    const disc = wheelSvg(); // kept across re-renders so a spin is never interrupted
    const rot = disc.querySelector('.wheel-rot');
    let angle = 0; // degrees clockwise
    let spinning = false;
    let result = null;
    let raf = 0;
    let lastSlice = -1;
    let closed = false;
    let finish = null; // shows the prize; run when the wheel stops, or at once if the panel closes
    const setAngle = (a) => {
      angle = a;
      rot.setAttribute('transform', `rotate(${(a % 360).toFixed(2)})`);
      // a tick each time a peg passes the pointer
      const under = ((-a % 360) + 360) % 360;
      const slice = WHEEL_SLICES.findIndex((sl) => under >= sl.from && under < sl.to);
      if (slice !== lastSlice && lastSlice !== -1) sfx.wheelTick();
      lastSlice = slice;
    };
    setAngle(Math.random() * 360);
    // the free spin comes back once a day: count down from when the profile arrived
    const freeIn = () => Math.max(0, (p().freeSpinInMs ?? 0) - (Date.now() - (app.profileAt || Date.now())));
    const clock = setInterval(() => { if (!spinning) rerender(); }, 20_000);

    async function go() {
      if (spinning) return;
      spinning = true;
      result = null;
      disc.classList.add('spinning');
      rerender();
      sfx.click();
      // spin flat out while the server picks the prize, then ease into it
      const speed = 600; // degrees a second
      let last = performance.now();
      let target = null;
      const frame = (now) => {
        if (!target) {
          setAngle(angle + speed * Math.min(0.05, (now - last) / 1000));
        } else {
          const k = Math.min(1, (now - target.start) / target.ms);
          setAngle(target.from + (target.to - target.from) * (1 - (1 - k) ** 3));
          if (k >= 1) { finish(); return; }
        }
        last = now;
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);

      let call;
      try {
        call = await app.callLater('spin');
      } catch (err) {
        cancelAnimationFrame(raf);
        spinning = false;
        disc.classList.remove('spinning');
        sfx.error();
        app.toast(err.message, 'error');
        rerender();
        return;
      }
      const index = WHEEL.prizes.findIndex((z) => z.id === call.res.prize);
      const sl = WHEEL_SLICES[index];
      const aim = sl.mid + (Math.random() - 0.5) * sl.sweep * 0.6; // somewhere inside the slice
      const min = angle + 720; // at least two more turns
      const to = min + ((((-aim - min) % 360) + 360) % 360);
      // a cubic ease starts at 3x its average speed: match the speed it is already turning at
      const ms = (3 * (to - angle) / speed) * 1000;
      target = { from: angle, to, start: performance.now(), ms };
      app.world?.spinWheel?.(index, ms / 1000);
      finish = () => {
        finish = null;
        spinning = false;
        disc.classList.remove('spinning');
        result = wheelPrizeLine(call.res);
        if (result.kind === 'jackpot') {
          sfx.land(5);
          app.toast(`★ You won the WHEEL ROD: +${RODS_BY_ID.wheel.luck} luck!`, 'good');
        } else {
          if (result.kind === 'rod') sfx.land(3);
          else sfx.coins();
          if (closed) app.toast(`Prize wheel: ${result.big}`, 'good');
        }
        call.apply(); // shows the prize in your purse / tackle box, and re-renders
      };
      if (closed) finish();
    }

    open('wheel', {
      title: 'Prize wheel',
      cls: 'wheel-modal',
      headExtra: () => h('span', { style: { marginLeft: 'auto', fontSize: '14px' } }, h('span.cash', `✦ ${fmt.int(p().cash)} gold`)),
      onClose: () => {
        closed = true;
        clearInterval(clock);
        cancelAnimationFrame(raf);
        finish?.();
      },
      render: () => {
        const pr = p();
        const wait = freeIn();
        const free = wait <= 0;
        const broke = !free && pr.cash < WHEEL.cost;
        const left = Math.max(1, Math.ceil(wait / 60_000)); // minutes
        const hrs = Math.floor(left / 60), mins = left % 60;
        return h('div.wheel-panel',
          disc,
          h('div.wheel-side',
            h(`div.wheel-result${result ? `.${result.kind}` : ''}`,
              spinning ? h('div.big.muted', 'Spinning…')
                : result ? [h('div.big', result.big), h('div.line', result.line)]
                  : [h('div.big', free ? 'Free spin ready' : 'Feeling lucky?'), h('div.line', 'Gold, bait and rods. The Wheel Rod (🍀 +65 luck) is 1 spin in 100.')]),
            h('button.pill-btn.wheel-btn', { disabled: spinning || broke, on: { click: go } },
              free ? 'FREE SPIN' : `SPIN · ✦${fmt.int(WHEEL.cost)}`),
            h('p.note', free
              ? 'One free spin every day. After that, a spin costs ✦1,000.'
              : `Next free spin in ${hrs ? `${hrs}h ${mins}m` : `${mins}m`}${broke ? ` · you need ✦${fmt.int(WHEEL.cost - pr.cash)} more gold for a paid spin` : ''}`),
            h('h3', 'Odds'),
            h('div.wheel-odds', WHEEL.prizes.map((z) => {
              const owned = z.kind === 'rod' && pr.rods.includes(z.item);
              return h(`div.odd${z.item === 'wheel' ? '.jackpot' : ''}`,
                h('span.dot', { style: { background: z.color } }),
                h('span', z.kind === 'rod' ? rodName(RODS_BY_ID[z.item]) : z.kind === 'bait' ? `${BAITS_BY_ID[z.item].pack} × ${BAITS_BY_ID[z.item].name}` : `✦${fmt.int(z.amount)} gold`,
                  owned ? h('span.muted', ` (owned: ✦${fmt.int(z.item === 'wheel' ? WHEEL.ownedWheelRodGold : Math.round(RODS_BY_ID[z.item].price / 2))})`) : null),
                h('span.pct', `${z.chance}%`));
            }))),
        );
      },
    });
  }

  // ---------------------------------------------------------------------------------- profile
  function profile() {
    // Kept across re-renders so typing is never interrupted.
    const nameInput = h('input.name-input', {
      maxlength: 16,
      placeholder: isGuest() ? 'pick a name' : shortAddress(app.session.wallet),
      value: p()?.name || '',
      on: {
        keydown: (e) => { if (e.key === 'Enter') saveName(); e.stopPropagation(); },
        blur: () => saveName(),
      },
    });
    function saveName() {
      const name = nameInput.value.replace(/\s+/g, ' ').trim();
      if (name === (p()?.name || '')) return;
      act(() => app.call('customize', { name: name || null }), name ? `You're now ${name} on the pier` : 'Name cleared')
        .then((res) => { if (!res) nameInput.value = p()?.name || ''; });
    }
    open('profile', {
      title: 'Profile',
      render: () => {
        const pr = p();
        const hold = app.holding;
        const stat = (label, value, cls = '') => h('div', label, h(`b${cls}`, value));
        const shirt = pr.look?.shirt;
        return [
          h('h3', 'Angler name'),
          nameInput,
          h('h3', 'Shirt colour'),
          h('div.swatches', SHIRT_COLORS.map((c, i) => h(`button.sw${i === shirt ? '.on' : ''}`, {
            style: { background: c },
            title: `shirt colour ${i + 1}`,
            on: { click: () => { if (i !== shirt) act(() => app.call('customize', { shirt: i })); } },
          }))),
          h('p.note', 'Cosmetic only: never affects your score. Your name shows to other anglers online.',
            pr.outfit !== 'deckhand' ? ' Your shirt colour shows when you wear the Deckhand outfit.' : ''),
          isGuest()
            ? h('p', 'Playing as ', h('b', 'guest'), ' — progress is saved on this device only. ',
              h('button.pill-btn.teal', { on: { click: () => { close(); app.connectWallet(); } } }, 'connect wallet'))
            : h('p', 'Wallet ', h('b', { style: { fontFamily: 'ui-monospace, monospace' } }, shortAddress(app.session.wallet)), ' ',
              h('button.pill-btn.dark', { on: { click: () => { close(); app.disconnect(); } } }, 'disconnect')),
          h('div.results-grid',
            stat('gold', `✦${fmt.int(pr.cash)}`),
            stat('lifetime gold', fmt.int(pr.lifetimeCash)),
            stat('catch value', `✦${fmt.int(pr.caught)}`),
            stat('backpack', `${pr.storage.length} / ${GAME.storageMax}`),
            stat('fish landed', fmt.int(pr.landed)),
            stat('snaps', fmt.int(pr.snaps)),
            stat('luck', `🍀 ${pr.luck}`),
            stat('species', `${Object.keys(pr.log).length} / ${SPECIES.length}`),
          ),
          isGuest() ? null : [
            h('h3', 'Reward pool'),
            h('div.check-list',
              check(!!hold?.ok, hold?.dev ? `holding check off (dev mode)` : hold?.test ? 'test wallet: holding check skipped' : hold?.ok
                ? `holding ${fmt.int(hold.balance)} $${CONFIG.tokenSymbol} ≈ ${fmt.usd(hold.usd)}`
                : hold?.error ? `couldn't check holdings: ${hold.error}` : `holding ${fmt.int(hold?.balance || 0)} $${CONFIG.tokenSymbol} ≈ ${fmt.usd(hold?.usd || 0)} — need $${CONFIG.minHoldUsd}`),
              check((pr.sold || 0) >= CONFIG.earnGate, `fish sold ${fmt.int(pr.sold || 0)} / ${fmt.int(CONFIG.earnGate)}`),
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
  // The pool's size and what each rarity cashes in for right now: in How to play and at the chest.
  function loadPool() {
    app.backend.pool().then((d) => { app.poolInfo = d; rerender(); }).catch(() => { app.poolInfo = null; rerender(); });
  }

  function poolTable() {
    const info = app.poolInfo;
    const luck = p()?.luck || 0;
    const odds = rarityOdds(luck);
    return [
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
        }),
        SPECIES.filter((sp) => sp.special).map((sp) => h('tr.special-row',
          h('td', h('span.rar', { style: { color: RARITIES[sp.rarity].color } }, `★ ${sp.name}`)),
          h('td', `${(speciesOdds(sp.id, luck) * 100).toFixed(3)}%`),
          h('td', h('b', fmt.pct(sp.poolPct))),
          h('td', h('span.sol', info ? fmt.sol(Math.floor(info.availableLamports * sp.poolPct)) : '—'))))),
      h('p.note', '★ The Ghost Whale is the rarest fish in the game and pays the biggest share of the pool.'),
    ];
  }

  function pool() {
    loadPool();
    loadPayouts();
    app.recheckHolding?.();
    open('pool', {
      title: '◆ Reward pool',
      cls: 'wide',
      render: () => {
        const pr = p();
        const info = app.poolInfo;
        const status = poolStatus();
        return [
          h('p', `A share of the $${CONFIG.tokenSymbol} creator fees fills this pool. Each rare-or-better fish you cash in pays a fixed % of what is in the pool at that moment, so the pool never runs dry.`),
          poolTable(),
          h('h3', 'Your status'),
          isGuest()
            ? h('p', 'Guests can fish and sell for gold. ', h('button.pill-btn.teal', { on: { click: () => { close(); app.connectWallet(); } } }, 'connect wallet'), ' to cash in.')
            : [
              h('div.check-list',
                check(true, `wallet ${shortAddress(app.session.wallet)}`),
                check(!!app.holding?.ok, app.holding?.dev ? 'holding check off (dev mode)' : app.holding?.test ? 'test wallet: holding check skipped' : `holds ≥ $${CONFIG.minHoldUsd} of $${CONFIG.tokenSymbol}${app.holding ? ` (now ${fmt.usd(app.holding.usd || 0)})` : ''}`),
                check((pr.sold || 0) >= CONFIG.earnGate, `${fmt.int(CONFIG.earnGate)} fish sold (${fmt.int(pr.sold || 0)})`),
              ),
              h('p.note', status.ok
                ? `Cashed in today: ${pr.cashedToday || 0} / ${dailyFish()} fish · at most ${fmt.pct(info?.dailyCapPct ?? 0.1)} of the pool per day.`
                : status.why),
              CONFIG.autoPayouts
                ? h('p', 'Every cash-in is sent straight to your wallet. Each one is listed below with its transaction on Solscan.')
                : h('p', 'Cash-ins add to your claimable SOL. Claim it to queue a payout; once it has been sent, its Solscan transaction shows up below.'),
              // With automatic payouts, claimable only holds a payout that could not be sent.
              CONFIG.autoPayouts && pr.claimable <= 0 ? null : h('div.stat-line', { style: { marginTop: '10px' } },
                h('span', CONFIG.autoPayouts ? 'not sent yet ' : 'claimable ', h('span.sol', fmt.sol(pr.claimable))),
                h('button.pill-btn.teal', {
                  disabled: CONFIG.autoPayouts ? pr.claimable <= 0 : pr.claimable < GAME.minClaimLamports,
                  on: {
                    click: async () => {
                      const res = await act(() => app.call('claim'), (r) => (r.payout.status === 'failed'
                        ? `Could not send it: ${r.payout.error}`
                        : CONFIG.autoPayouts ? `Sending ${fmt.sol(r.payout.lamports)} to your wallet` : `Claim of ${fmt.sol(r.payout.lamports)} queued. It will be sent to your wallet.`));
                      if (res) loadPayouts();
                    },
                  },
                }, CONFIG.autoPayouts ? 'send to my wallet' : 'claim to wallet'),
                CONFIG.autoPayouts ? null : h('span.note', `min ${fmt.sol(GAME.minClaimLamports, 2)}`),
              ),
              payouts?.length ? [h('h3', 'Your payouts'), payoutTable(payouts.slice(0, 10))] : null,
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
        h('p', h('a.x-link', { href: CONFIG.xUrl, target: '_blank', rel: 'noopener' },
          h('span.x-logo', '𝕏'), `@${CONFIG.xUrl.replace(/\/+$/, '').split('/').pop()}`), ' news and updates'),
        h('p.muted', 'Built with three.js. Every model, texture and sound is generated in code.'),
        h('p.muted', 'Gold and items have no value outside the game. Pool cash-ins are paid in SOL from the creator-fee pool, at the rates shown in the reward pool.'),
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
    howTo, rack, shop, rods, catchLog, leaderboard, wheel, profile, pool, settings, credits, noWallet,
    close, rerender,
    get open() { return current?.name || null; },
  };
}
