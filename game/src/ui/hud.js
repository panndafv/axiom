import * as THREE from 'three';
import { h, fmt } from './dom.js';
import { fishIcon } from './icons.js';
import { CONFIG } from '../config.js';
import { GAME, RARITIES, SPECIES_BY_ID, BAITS_BY_ID } from '../../shared/rules.js';
import { shortAddress } from '../net/wallet.js';

const tmp = new THREE.Vector3();
const touch = () => document.body.classList.contains('touch');

export function createHud(app) {
  const ui = document.getElementById('ui');
  const labelsLayer = document.getElementById('labels');

  // ------------------------------------------------------------------ top bar: luck, gold, backpack
  const chip = (cls, icon, label, onClick) => {
    const v = h('span.v');
    const el = h(`button.top-chip.${cls}`, { on: { click: onClick } }, h('span.i', icon), h('span.k', label), v);
    return { el, v };
  };
  const luckChip = chip('luck', '🍀', 'LUCK', () => app.panels.shop('bait'));
  const goldChip = chip('gold', '✦', 'GOLD', () => app.panels.shop('rods'));
  const bagChip = chip('bag', '🎒', 'BACKPACK', () => toggleBag());
  const bagMenu = h('div.bag-menu');
  bagMenu.hidden = true;
  const bagWrap = h('div.chip-wrap', bagChip.el, bagMenu);
  const lobbyChip = chip('lobby', '👥', 'LOBBY', () => {});
  lobbyChip.el.style.display = 'none';
  const topBar = h('div.topbar', luckChip.el, goldChip.el, bagWrap, lobbyChip.el);

  // Your fish in one column, rarest first. Selling still happens at the fish rack.
  function renderBag() {
    const p = app.profile;
    if (!p || bagMenu.hidden) return;
    const worth = (f) => RARITIES[SPECIES_BY_ID[f.sp].rarity].order * 1e6 + f.value;
    const fish = [...p.storage].sort((a, b) => worth(b) - worth(a));
    const total = fish.reduce((sum, f) => sum + f.value, 0);
    bagMenu.replaceChildren(
      h('div.head', h('span', 'BACKPACK'), h('span', `${fish.length}/${GAME.storageMax}`)),
      fish.length
        ? h('div.list', fish.map((f) => {
          const sp = SPECIES_BY_ID[f.sp];
          return h('div.fish', h('span', { style: { color: RARITIES[sp.rarity].color } }, sp.name), h('span.cash', `✦${f.value}`));
        }))
        : h('div.empty-note', 'empty. go catch something!'),
      h('div.total', h('span', `${fish.length} fish`), h('span.cash', `✦${fmt.int(total)}`)),
      h('div.note', fish.length >= GAME.storageMax ? 'full: sell at the fish rack to keep fishing' : 'sell them at the fish rack'),
    );
  }
  function toggleBag(open = bagMenu.hidden) {
    bagMenu.hidden = !open;
    bagChip.el.classList.toggle('open', open);
    renderBag();
  }
  window.addEventListener('pointerdown', (e) => { if (!bagMenu.hidden && !bagWrap.contains(e.target)) toggleBag(false); });
  window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && !bagMenu.hidden) toggleBag(false); });

  function renderTop() {
    const p = app.profile;
    if (!p) return;
    luckChip.v.textContent = `${p.luck}`;
    goldChip.v.textContent = fmt.int(p.cash);
    bagChip.v.textContent = `${p.storage.length}/${GAME.storageMax}`;
    renderBag();
    bagChip.el.classList.toggle('full', p.storage.length >= GAME.storageMax);
    bagChip.el.title = p.storage.length >= GAME.storageMax
      ? 'Backpack full: sell fish at the fish rack to keep fishing'
      : 'Your backpack. Sell fish at the fish rack.';
  }

  // ------------------------------------------------------------------ deck HUD
  const best = h('span.hud-best');
  const unlockNum = h('span.num');
  const unlockOf = h('span');
  const unlockBar = h('i');
  const sub = h('div.hud-sub', 'fish sold · sell fish at the rack to fill it');
  const status = h('div');
  const bait = h('div.hud-bait');
  const deck = h('div.hud',
    h('div.hud-buttons',
      h('button.hud-btn', { on: { click: () => app.open('profile') } }, '👤 PROFILE (P)'),
      h('button.hud-btn.orange', { on: { click: () => app.goHome() } }, '⌂ HOME'),
    ),
    h('div.hud-card',
      h('div.hud-row', best),
      h('div.hud-unlock', 'POOL UNLOCK ', unlockNum, unlockOf),
      h('div.bar', unlockBar),
      sub,
      bait,
      status,
    ),
  );
  const hint = h('div.bottom-hint.passive');
  const root = h('div.passive', { style: { position: 'absolute', inset: '0' } }, hint);
  deck.style.pointerEvents = 'auto';
  root.append(deck, topBar);
  root.style.display = 'none';
  ui.append(root);

  function renderDeck() {
    const p = app.profile;
    if (!p) return;
    renderTop();
    best.textContent = `🐟 ${fmt.int(p.landed)} FISH · ✦${fmt.int(p.caught)} CAUGHT`;
    const gate = CONFIG.earnGate;
    const sold = p.sold || 0;
    unlockNum.textContent = fmt.int(Math.min(sold, gate));
    unlockOf.textContent = ` / ${fmt.int(gate)} fish sold`;
    unlockBar.style.width = `${Math.min(100, (sold / Math.max(1, gate)) * 100)}%`;
    const b = p.bait && BAITS_BY_ID[p.bait];
    bait.textContent = b ? `🪱 ${b.name} on the hook · ${p.baits[p.bait]} casts · +${b.luck} luck` : '';
    status.className = '';
    if (app.mode === 'guest') {
      status.className = 'hud-warn';
      status.textContent = `guest · connect a wallet on the title to earn from the pool`;
    } else {
      const hold = app.holding;
      if (hold?.ok) {
        status.className = 'hud-ok';
        status.textContent = `${shortAddress(app.session?.wallet)} · holding ${hold.dev ? '(dev mode)' : fmt.usd(hold.usd)} of $${CONFIG.tokenSymbol} ✓`;
      } else {
        status.className = 'hud-warn';
        status.textContent = `${shortAddress(app.session?.wallet)} · hold $${CONFIG.minHoldUsd} of $${CONFIG.tokenSymbol} to cash in fish`;
      }
    }
    sub.textContent = sold >= gate
      ? 'pool unlocked · cash in rare fish at the rack or the chest'
      : 'sell fish at the rack to unlock the pool';
  }

  // ------------------------------------------------------------------ world labels
  const labels = new Map();
  function ensureLabels() {
    for (const it of app.world.interactables) {
      if (labels.has(it.id)) continue;
      const el = h('div.world-label',
        h('div.t', { style: { color: it.color } }, `${it.icon} ${it.title}`),
        h('div.h', it.hint),
      );
      labelsLayer.append(el);
      labels.set(it.id, el);
    }
  }

  // Prompt that follows the player along the edge of the pier.
  const edgeHint = h('div.h');
  const edgeLabel = h('div.world-label.near', h('div.t', { style: { color: 'var(--teal)' } }, '✦ FISH HERE'), edgeHint);
  edgeLabel.style.display = 'none';
  labelsLayer.append(edgeLabel);

  function updateLabels(camera, near, visible, level = 'deck') {
    ensureLabels();
    const w = window.innerWidth, hgt = window.innerHeight;
    if (visible && near?.id === 'edge') {
      tmp.copy(near.pos);
      tmp.y += 2.1;
      tmp.project(camera);
      edgeLabel.style.display = tmp.z > 1 ? 'none' : '';
      edgeHint.textContent = touch() ? 'tap FISH to cast a line' : '(E) cast a line';
      edgeLabel.style.left = `${((tmp.x + 1) / 2) * w}px`;
      edgeLabel.style.top = `${((1 - tmp.y) / 2) * hgt}px`;
    } else {
      edgeLabel.style.display = 'none';
    }
    for (const it of app.world.interactables) {
      const el = labels.get(it.id);
      if (!visible || !app.world.labelVisible(it, level, near)) { el.style.display = 'none'; continue; }
      tmp.copy(it.pos);
      tmp.y += it.labelY ?? 2.7;
      const dist = tmp.distanceTo(camera.position);
      tmp.project(camera);
      if (tmp.z > 1 || dist > 60) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.left = `${((tmp.x + 1) / 2) * w}px`;
      el.style.top = `${((1 - tmp.y) / 2) * hgt}px`;
      const isNear = near === it;
      el.classList.toggle('near', isNear);
      const scale = THREE.MathUtils.clamp(14 / dist, 0.45, 1.15);
      el.style.transform = `translate(-50%, -100%) scale(${isNear ? Math.max(1, scale) : scale})`;
      el.style.opacity = isNear ? 1 : THREE.MathUtils.clamp(1.4 - dist / 45, 0.35, 0.95);
    }
  }

  // ------------------------------------------------------------------ fishing HUD
  const prompt = h('div.prompt');
  const progBar = h('i');
  const tenBar = h('i');
  const reelTag = h('span');
  const reel = h('div.reel',
    h('div.lbl', h('span', 'LINE IN'), reelTag),
    h('div.bar.progress', progBar),
    h('div.lbl', h('span', 'TENSION'), h('span', 'release to bleed it')),
    h('div.bar.tension', tenBar),
  );
  reel.style.display = 'none';
  const fishRoot = h('div.fish-hud.passive', prompt, reel);
  fishRoot.style.display = 'none';
  ui.append(fishRoot);

  let revealEl = null;
  let bannerEl = null;

  const fishing = {
    show() { fishRoot.style.display = ''; hint.textContent = 'click / [Space] to cast · HOLD to reel · (E) stop fishing'; },
    hide() { fishRoot.style.display = 'none'; reel.style.display = 'none'; },
    setPrompt(state, { full }) {
      prompt.replaceChildren();
      const add = (...els) => prompt.append(...els.filter(Boolean));
      if (state === 'idle' && full) {
        add(
          h('div.big', '🎒 BACKPACK FULL'),
          h('div.line', 'sell fish at the fish rack to keep fishing'),
          touch() ? null : h('div.small', '(E) stop fishing'),
        );
      } else if (state === 'idle') {
        add(
          h('div.big', 'CAST A LINE'),
          touch() ? h('div.line', 'tap to cast out') : h('div.line', 'click / ', h('span.kbd', 'Space'), ' to cast out'),
          touch() ? null : h('div.small', '(E) stop fishing'),
        );
      } else if (state === 'casting' || state === 'waiting') {
        add(
          h('div.big', 'WAITING FOR A BITE…'),
          touch() ? null : h('div.small', '(E) stop fishing'),
        );
      } else if (state === 'fighting') {
        prompt.append(touch()
          ? h('div.line', 'HOLD the screen to reel · let go when it surges')
          : h('div.line', 'HOLD ', h('span.kbd', 'Space'), ' / mouse to reel · let go when it surges'));
        prompt.style.top = '62%';
        return;
      }
      prompt.style.top = '46%';
    },
    bite() {
      prompt.replaceChildren(h('div.alert', '!'));
      reel.style.display = '';
    },
    setReel(prog, ten, surge, holding) {
      reel.style.display = '';
      progBar.style.width = `${Math.max(0, prog) * 100}%`;
      tenBar.style.width = `${Math.min(1, ten) * 100}%`;
      reel.classList.toggle('surge', surge);
      reelTag.className = surge ? 'surge-tag' : '';
      reelTag.textContent = surge ? 'SURGE — LET GO!' : holding ? 'reeling…' : 'hold to reel';
    },
    hideReel() { reel.style.display = 'none'; reel.classList.remove('surge'); },
    cooldown(ms) {
      const until = performance.now() + ms;
      const tick = () => {
        const left = until - performance.now();
        if (left <= 0) return;
        prompt.replaceChildren(h('div.big', 'RE-TYING YOUR LINE…'), h('div.line', `${Math.ceil(left / 1000)}s`));
        prompt.style.top = '46%';
        setTimeout(tick, 200);
      };
      setTimeout(tick, 900);
    },
    reveal(sp, fish, isNew) {
      revealEl?.remove();
      const r = RARITIES[sp.rarity];
      revealEl = h('div.reveal', { style: { '--rc': r.color } },
        fishIcon(sp, 84),
        h('div',
          h('div.rar', { style: { color: r.color } }, r.label.toUpperCase(), isNew ? h('span.new', 'NEW') : null),
          h('div.nm', sp.name),
          h('div.meta', `${fmt.kg(fish.kg)} · `, h('span.cash', `✦${fish.value}`)),
        ),
      );
      revealEl.style.setProperty('--rc', r.color);
      fishRoot.append(revealEl);
      const el = revealEl;
      setTimeout(() => { el.style.transition = 'opacity 0.4s'; el.style.opacity = '0'; }, 1700);
      setTimeout(() => el.remove(), 2200);
    },
    banner(text, kind = 'info') {
      bannerEl?.remove();
      bannerEl = h(`div.banner.${kind}`, text);
      fishRoot.append(bannerEl);
      const el = bannerEl;
      setTimeout(() => el.remove(), 1500);
    },
  };

  // "someone landed something rare" across the lobby
  let shoutEl = null;
  function shout(name, sp, kg) {
    const r = RARITIES[sp.rarity];
    shoutEl?.remove();
    shoutEl = h('div.shout.passive', { style: { '--rc': r.color } },
      fishIcon(sp, 44),
      h('div', h('b', name), ' landed a ', h('b', { style: { color: r.color } }, `${r.label.toUpperCase()} ${sp.name}`), ` (${fmt.kg(kg)})`));
    ui.append(shoutEl);
    const el = shoutEl;
    setTimeout(() => { el.style.opacity = '0'; }, 4500);
    setTimeout(() => el.remove(), 5000);
  }

  return {
    fishing,
    shout,
    setLobby(info) {
      lobbyChip.el.style.display = info ? '' : 'none';
      if (info) {
        lobbyChip.v.textContent = `#${info.lobby} · ${info.count}/${info.size}`;
        lobbyChip.el.title = `Lobby ${info.lobby}: ${info.count} of ${info.size} players`;
      }
    },
    render: renderDeck,
    setMode(mode) {
      root.style.display = mode === 'walk' || mode === 'fish' || mode === 'sit' ? '' : 'none';
      deck.style.display = mode === 'fish' ? 'none' : '';
      if (mode === 'walk') hint.textContent = 'click to look · WASD walk · Shift run · walk to any edge + E to fish · E interact · V view · P profile';
      if (mode === 'sit') hint.textContent = '(E) stand up';
    },
    updateLabels,
  };
}
