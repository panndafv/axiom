import { h, fmt } from './dom.js';
import { CONFIG } from '../config.js';
import { SPECIES } from '../../shared/rules.js';
import { shortAddress } from '../net/wallet.js';
import { sfx } from '../game/audio.js';

// Title screen over the slowly orbiting pier. Arrow keys move the selection, Enter opens it.

export function createTitle(app) {
  const ui = document.getElementById('ui');
  let selected = 0;
  let items = [];
  let buttons = [];
  const status = h('div.title-status');
  const connectLabel = h('span');
  const connect = h('button.btn-connect', { on: { click: () => { sfx.click(); app.connectWallet(); } } }, h('span.icon', '🔗'), connectLabel);
  const howToSlot = h('div.title-main-slot');
  // Play and How to play sit together as one block, with the smaller buttons set apart below.
  const main = h('div.title-main', connect, howToSlot);
  const menu = h('div.menu');
  const guestBtn = h('button.btn-guest', { on: { click: () => { sfx.click(); app.playGuest(); } } }, 'play as guest');
  const note = h('div.title-note', 'wallet = your progress is saved · guest = saved on this device only');
  const pausedMsg = h('p');
  const paused = h('div.paused-card', h('div.big', '⏸ PAUSED'), pausedMsg, h('p.small', 'Your fish, gold and SOL are safe.'));
  const logo = h('h1.logo');
  const addr = h('span.addr');
  const copy = h('button.copy', { on: { click: copyMint } }, 'COPY');
  const explorer = h('a', { target: '_blank', rel: 'noopener' }, 'solscan');
  const buy = h('a', { target: '_blank', rel: 'noopener' }, 'buy');
  const sym = h('span.sym');
  const bar = h('div.contract-bar', sym, addr, copy, explorer, buy);
  const muteBtn = h('button.mute-btn', { title: 'Mute (M)', on: { click: () => app.setMuted(!sfx.muted) } });
  const root = h('div.title-screen',
    logo, paused, main, status, menu, guestBtn, note,
    h('div.key-hints.passive', '↑↓ select · Enter open · Esc close · M mute'),
    bar,
  );
  ui.append(root, muteBtn);

  function copyMint() {
    if (!CONFIG.tokenMint) return;
    navigator.clipboard?.writeText(CONFIG.tokenMint).then(() => app.toast('Contract address copied', 'good')).catch(() => {});
  }

  function render() {
    const p = app.profile;
    logo.textContent = CONFIG.gameName;
    document.title = CONFIG.gameName;
    connectLabel.textContent = app.mode === 'wallet' ? `PLAY · ${shortAddress(app.session.wallet)}` : 'CONNECT WALLET & PLAY';
    guestBtn.textContent = app.mode === 'wallet' ? 'switch to guest' : 'play as guest';
    sym.textContent = `$${CONFIG.tokenSymbol}`;
    addr.textContent = CONFIG.tokenMint || 'contract address coming soon';
    copy.style.display = explorer.style.display = CONFIG.tokenMint ? '' : 'none';
    explorer.href = CONFIG.tokenMint ? CONFIG.explorerUrl(CONFIG.tokenMint) : '#';
    buy.href = CONFIG.buyUrl || '#';
    buy.style.display = CONFIG.buyUrl ? '' : 'none';
    muteBtn.textContent = sfx.muted ? '🔇' : '🔊';
    // paused by the server: no way into the game, just the message
    const isPaused = !!CONFIG.maintenance;
    paused.style.display = isPaused ? '' : 'none';
    pausedMsg.textContent = CONFIG.maintenance;
    for (const el of [main, guestBtn, note]) el.style.display = isPaused ? 'none' : '';

    const found = p ? Object.keys(p.log || {}).length : 0;
    items = [
      ['How to play', '', () => app.panels.howTo()],
      ['Leaderboard', p?.caught ? `✦${fmt.short(p.caught)} CAUGHT` : '', () => app.panels.leaderboard()],
      ['Catch log', `${found}/${SPECIES.length} SPECIES`, () => app.panels.catchLog()],
      ['Profile', p ? `✦${fmt.short(p.cash)} GOLD` : '', () => app.panels.profile()],
      ['Settings', '', () => app.panels.settings()],
      ['Credits', '', () => app.panels.credits()],
    ];
    buttons = items.map(([label, badge, fn], i) =>
      h(`button.menu-item${i === 0 ? '.primary' : ''}${i === selected ? '.selected' : ''}`, {
        on: {
          click: () => { selected = i; sfx.click(); fn(); render(); },
          mouseenter: () => { if (selected !== i) { selected = i; sfx.hover(); highlight(); } },
        },
      }, h('span', label), h('span.badge', badge)));
    howToSlot.replaceChildren(buttons[0]);
    menu.replaceChildren(...buttons.slice(1));
    connect.classList.toggle('selected', selected === -1);
  }

  function highlight() {
    buttons.forEach((el, i) => el.classList.toggle('selected', i === selected));
    connect.classList.toggle('selected', selected === -1);
  }

  return {
    render,
    setStatus(text) { status.textContent = text || ''; },
    show() { root.style.display = ''; render(); },
    hide() { root.style.display = 'none'; },
    get visible() { return root.style.display !== 'none'; },
    renderMute() { muteBtn.textContent = sfx.muted ? '🔇' : '🔊'; },
    key(code) {
      if (code === 'ArrowDown') { selected = Math.min(items.length - 1, selected + 1); sfx.hover(); highlight(); }
      else if (code === 'ArrowUp') { selected = Math.max(-1, selected - 1); sfx.hover(); highlight(); }
      else if (code === 'Enter') {
        sfx.click();
        if (selected === -1) app.connectWallet();
        else items[selected]?.[2]();
      }
    },
  };
}
