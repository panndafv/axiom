import * as THREE from 'three';
import { h, fmt } from './dom.js';
import { fishIcon, rodIcon, baitIcon, haloIcon, specialRodIcon } from './icons.js';
import {
  GAME, RARITIES, SPECIES_BY_ID, BAITS_BY_ID, RODS_BY_ID, HALOS_BY_ID, SPECIAL_CASTS, specialCast, sellPrice,
} from '../../shared/rules.js';

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
  const luckBoost = h('span.boost'); // ×2 / ×5 when the next cast is golden or rainbow
  luckChip.el.append(luckBoost);
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
    const total = fish.reduce((sum, f) => sum + sellPrice(f.value, p.halo), 0);
    bagMenu.replaceChildren(
      h('div.head', h('span', 'BACKPACK'), h('span', `${fish.length}/${GAME.storageMax}`)),
      fish.length
        ? h('div.list', fish.map((f) => {
          const sp = SPECIES_BY_ID[f.sp];
          return h('div.fish', h('span', { style: { color: RARITIES[sp.rarity].color } }, sp.name), h('span.cash', `✦${sellPrice(f.value, p.halo)}`));
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
    const next = specialCast((p.casts || 0) + 1);
    luckBoost.textContent = next ? `×${next.boost}` : '';
    luckBoost.className = `boost ${next?.kind || ''}`;
    luckChip.el.title = next ? `Your next cast is a ${next.label.toLowerCase()}: ${next.boost}× luck` : 'Luck from your rod and bait';
    renderGear(p);
    renderSpecials(p);
    goldChip.v.textContent = fmt.int(p.cash);
    bagChip.v.textContent = `${p.storage.length}/${GAME.storageMax}`;
    renderBag();
    bagChip.el.classList.toggle('full', p.storage.length >= GAME.storageMax);
    bagChip.el.title = p.storage.length >= GAME.storageMax
      ? 'Backpack full: sell fish at the fish rack to keep fishing'
      : 'Your backpack. Sell fish at the fish rack.';
  }

  // ------------------------------------------------------------------ deck HUD
  const deck = h('div.hud',
    h('div.hud-buttons',
      h('button.hud-btn', { on: { click: () => app.open('profile') } }, '👤 PROFILE (P)'),
      h('button.hud-btn.orange', { on: { click: () => app.goHome() } }, '⌂ HOME'),
    ),
  );

  // ------------------------------------------------------------------ lobby chat (top left)
  // Enter to type, Enter to send, Esc to stop typing. The server allows one line every 5 seconds.
  // Each line fades away 15 seconds after it appears, and the box never holds more than a few
  // lines, so it never grows down the screen.
  const CHAT_COOLDOWN_MS = 5_000;
  const CHAT_LIFE_MS = 15_000;
  const chatMaxLines = () => (window.innerWidth <= 640 ? 4 : 6);
  const chatLog = h('div.chat-log');
  const chatInput = h('input.chat-input', { maxlength: 120, placeholder: 'Press Enter to chat', enterkeyhint: 'send' });
  const chatBox = h('div.chat', chatLog, chatInput);
  let chatReadyAt = 0;
  let chatTimer = null;
  let chatOnline = false;
  function chatPlaceholder() {
    const wait = chatReadyAt - Date.now();
    chatInput.disabled = !chatOnline || wait > 0;
    chatInput.placeholder = !chatOnline ? 'chat is offline'
      : wait > 0 ? `you can chat again in ${Math.ceil(wait / 1000)}s`
        : touch() ? 'tap to chat' : 'Press Enter to chat';
    clearTimeout(chatTimer);
    if (chatOnline && wait > 0) chatTimer = setTimeout(chatPlaceholder, Math.min(wait, 250));
  }
  function chatLine(m, lifeMs = CHAT_LIFE_MS) {
    // text only, never HTML
    const el = h(`div.cl${m.mine ? '.mine' : ''}${m.system ? '.system' : ''}`,
      m.name ? h(`b.nm${m.wallet ? '.wallet' : ''}`, `${m.name}: `) : null, m.text);
    chatLog.append(el);
    while (chatLog.childElementCount > chatMaxLines()) chatLog.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add('fade');
      setTimeout(() => el.remove(), 600);
    }, Math.max(0, lifeMs));
  }
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const text = chatInput.value.replace(/\s+/g, ' ').trim();
      if (text && app.sendChat?.(text)) {
        chatInput.value = '';
        chatReadyAt = Date.now() + CHAT_COOLDOWN_MS;
        chatPlaceholder();
      }
      chatInput.blur();
    } else if (e.key === 'Escape') {
      chatInput.blur();
    }
  });
  chatInput.addEventListener('focus', () => app.onChatFocus?.());
  const chat = {
    // the lobby's recent lines when we join
    reset(lines = []) {
      chatLog.replaceChildren();
      chatOnline = true;
      // only what is still young enough to be on screen, for the time it has left
      for (const m of lines) if ((m.ageMs ?? 0) < CHAT_LIFE_MS) chatLine(m, CHAT_LIFE_MS - (m.ageMs ?? 0));
      chatPlaceholder();
    },
    add(m) { chatLine(m); },
    refused(why, waitMs) {
      chatLine({ system: true, text: why });
      if (waitMs) chatReadyAt = Date.now() + waitMs;
      chatPlaceholder();
    },
    offline() {
      chatOnline = false;
      chatPlaceholder();
    },
    focus() {
      if (root.style.display === 'none' || chatInput.disabled) return false;
      chatInput.focus();
      return true;
    },
  };
  chat.offline();
  const hint = h('div.bottom-hint.passive');
  const root = h('div.passive', { style: { position: 'absolute', inset: '0' } }, hint);
  deck.style.pointerEvents = 'auto';

  // ------------------------------------------------------------------ gear (top right)
  // What you have on: rod, bait and halo. Each opens the place to change it.
  const gear = h('div.gear');
  let gearKey = '';
  function gearSlot(icon, name, sub, onClick, empty = false) {
    return h(`button.gear-slot${empty ? '.empty' : ''}`, { title: `${name} · ${sub}`, on: { click: onClick } },
      h('div.ic', icon), h('div.nm', name), h('div.sub', sub));
  }
  function renderGear(p) {
    const rod = RODS_BY_ID[p.rod] || RODS_BY_ID.driftwood;
    const bait = p.bait && p.baits?.[p.bait] > 0 ? BAITS_BY_ID[p.bait] : null;
    const halo = HALOS_BY_ID[p.halo] || null;
    const key = `${rod.id}|${bait?.id}|${bait ? p.baits[p.bait] : 0}|${halo?.id}`;
    if (key === gearKey) return;
    gearKey = key;
    gear.replaceChildren(
      gearSlot(rodIcon(rod, { size: 40 }), rod.name, `+${rod.luck} luck`, () => app.panels.rods()),
      bait
        ? gearSlot(baitIcon(bait, 36), bait.name, `+${bait.luck} · ×${p.baits[p.bait]}`, () => app.panels.shop('bait'))
        : gearSlot(h('span.plus', '+'), 'No bait', 'shop', () => app.panels.shop('bait'), true),
      halo
        ? gearSlot(haloIcon(halo, 40), halo.name, `+${Math.round(halo.gold * 100)}% gold`, () => app.panels.shop('halos'))
        : gearSlot(h('span.plus', '+'), 'No halo', 'shop', () => app.panels.shop('halos'), true),
    );
  }

  // ------------------------------------------------------------------ golden / rainbow casts
  // Counters along the bottom: which cast of 10 (golden) and of 50 (rainbow) comes next.
  const specials = h('div.special-casts');
  let specialsKey = '';
  function renderSpecials(p) {
    const n = (p.casts || 0) + 1;
    if (String(n) === specialsKey) return;
    specialsKey = String(n);
    const next = specialCast(n);
    specials.replaceChildren(...[...SPECIAL_CASTS].reverse().map((s) => {
      const at = ((n - 1) % s.every) + 1;
      return h(`div.sc.${s.kind}${next?.kind === s.kind ? '.ready' : ''}`,
        { title: `Every ${s.every}th cast is a ${s.label.toLowerCase()}: ${s.boost}× luck` },
        specialRodIcon(s.kind, { size: 44 }),
        h('span.n', `${at}/${s.every}`));
    }));
  }

  root.append(deck, chatBox, topBar, gear, specials);
  root.style.display = 'none';
  ui.append(root);

  function renderDeck() {
    if (!app.profile) return;
    renderTop();
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
          h('div.meta', `${fmt.kg(fish.kg)} · `, h('span.cash', `✦${sellPrice(fish.value, app.profile?.halo)}`)),
        ),
      );
      revealEl.style.setProperty('--rc', r.color);
      fishRoot.append(revealEl);
      const el = revealEl;
      setTimeout(() => { el.style.transition = 'opacity 0.4s'; el.style.opacity = '0'; }, 1700);
      setTimeout(() => el.remove(), 2200);
    },
    // Big "2× LUCK" (gold) / "5× LUCK" (rainbow) when a golden or rainbow cast goes out.
    luckPopup(kind, boost, label) {
      fishRoot.querySelector('.luck-pop')?.remove();
      const el = h(`div.luck-pop.${kind}`, h('div.big', `${boost}× LUCK`), h('div.small', label.toUpperCase()));
      fishRoot.append(el);
      setTimeout(() => el.remove(), 2600);
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
    chat,
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
