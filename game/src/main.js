import '@fontsource/lilita-one/latin-400.css';
import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/latin-600.css';
import '@fontsource/pixelify-sans/latin-700.css';
import './styles.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { CONFIG, applyServerConfig } from './config.js';
import { createEnvironment } from './scene/environment.js';
import { createWorld } from './scene/world.js';
import { createInput } from './game/input.js';
import { createPlayer } from './game/player.js';
import { createFishing } from './game/fishing.js';
import { sfx } from './game/audio.js';
import { createHud } from './ui/hud.js';
import { createPanels } from './ui/panels.js';
import { createTitle } from './ui/title.js';
import { createTouchControls, isTouchDevice } from './ui/touch.js';
import { h, fmt, toast } from './ui/dom.js';
import { createLocalBackend, createRemoteBackend, publicApi } from './net/api.js';
import { connectAndSignIn, disconnect as walletDisconnect, hasWallet, loadSession, saveSession } from './net/wallet.js';
import { createLobbyClient } from './net/lobby.js';
import { createRemotes } from './scene/remotes.js';
import { RARITIES, SPECIES_BY_ID, RODS_BY_ID } from '../shared/rules.js';

// ------------------------------------------------------------------------------------------------
// Renderer

const canvas = document.getElementById('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch {
  document.getElementById('ui').append(h('div.modal-wrap', h('div.modal', h('h2.modal-title', 'WebGL needed'),
    h('p', 'Your browser could not start 3D graphics. Try a recent Chrome, Firefox or Safari, or turn on hardware acceleration.'))));
  throw new Error('WebGL unavailable');
}
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2000);

const SETTINGS_KEY = 'pp.settings';
const settings = (() => {
  const defaults = { quality: 'high', sensitivity: 1, invertY: false };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return defaults; }
})();

const env = createEnvironment(scene, renderer);
const world = createWorld(scene);
const input = createInput(canvas);
const player = createPlayer(scene, camera, world, input, settings);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.55, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function applyQuality() {
  const q = settings.quality;
  const dpr = window.devicePixelRatio || 1;
  renderer.setPixelRatio(Math.min(dpr, q === 'high' ? 1.75 : q === 'medium' ? 1.25 : 1));
  bloom.enabled = q === 'high';
  const shadows = q !== 'low';
  if (renderer.shadowMap.enabled !== shadows) {
    env.setShadows(shadows);
    scene.traverse((o) => { if (o.material) [o.material].flat().forEach((m) => { m.needsUpdate = true; }); });
  }
  resize();
}

function resize() {
  const w = window.innerWidth, hh = window.innerHeight;
  renderer.setSize(w, hh, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, hh);
  camera.aspect = w / hh;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ------------------------------------------------------------------------------------------------
// App state shared by the UI modules

const app = {
  mode: 'guest',        // 'guest' | 'wallet'
  session: null,        // { token, wallet }
  backend: createLocalBackend(),
  profile: null,
  holding: null,
  poolInfo: null,
  serverOnline: false,
  settings,
  world,
  toast,
};

let shakeAmt = 0;
app.shake = (a) => { shakeAmt = Math.max(shakeAmt, a); };

app.saveSettings = () => {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
  applyQuality();
};

app.setMuted = (m) => {
  sfx.setMuted(m);
  title.renderMute();
  toast(m ? 'Sound off (M)' : 'Sound on (M)');
};

let lastRod = null, lastOutfit = null, lastHalo, lastName;
function setProfile(p) {
  app.profile = p;
  const outfitKey = `${p.outfit}:${p.look?.shirt}:${p.look?.hair}`;
  const halo = p.halo || null;
  const name = p.name || null;
  const looksChanged = p.rod !== lastRod || outfitKey !== lastOutfit || halo !== lastHalo || name !== lastName;
  lastName = name;
  if (p.rod !== lastRod) { player.setRod(p.rod); lastRod = p.rod; }
  if (outfitKey !== lastOutfit) { player.setOutfit(p.outfit, p.look); lastOutfit = outfitKey; }
  if (halo !== lastHalo) { player.setHalo(halo); lastHalo = halo; }
  if (looksChanged) lobby.send({ t: 'look', name, outfit: p.outfit, rod: p.rod, halo, look: p.look });
  world.setRackRods(p.rods);
  world.setBeaconFound(p.rods.includes('beacon'));
  hud.render();
  if (title.visible) title.render();
  panels.rerender();
}

app.call = async (method, ...args) => {
  try {
    const res = await app.backend[method](...args);
    if (res?.profile) setProfile(res.profile);
    if (res && 'holding' in res && res.holding) app.holding = res.holding;
    if (res?.pool) app.poolInfo = res.pool;
    return res;
  } catch (err) {
    if (err.status === 401 && app.mode === 'wallet') {
      toast('Your session expired. Connect your wallet again.', 'error');
      await app.disconnect();
    }
    if (err.code === 'hold' && err.holding) app.holding = err.holding;
    if (err.code === 'maintenance') {
      CONFIG.maintenance = err.message;
      app.goHome();
    }
    throw err;
  }
};

app.modalOpen = () => !!panels.open;
app.onModalChange = (open) => {
  input.enabled = !open;
  if (open) input.unlockPointer();
};

app.open = (name) => panels[name]?.();

app.onLeaveFishing = () => {
  hud.setMode('walk');
  refreshScoreboard();
};

app.recheckHolding = async (force = false) => {
  if (app.mode !== 'wallet') return;
  try {
    const res = await app.backend.holding(force);
    app.holding = res.holding;
    hud.render();
    panels.rerender();
    if (force) toast(res.holding?.ok ? 'Holdings check passed ✓' : `Holding ${fmt.usd(res.holding?.usd || 0)} — need $${CONFIG.minHoldUsd}`, res.holding?.ok ? 'good' : 'error');
  } catch (err) {
    if (force) toast(err.message, 'error');
  }
};

function startPlaying() {
  sfx.unlock();
  title.hide();
  panels.close();
  player.setMode('walk', { reset: true });
  hud.setMode('walk');
  hud.render();
  joinLobby();
  let seen = false;
  try {
    seen = !!localStorage.getItem('pp.seenHowTo');
    localStorage.setItem('pp.seenHowTo', '1');
  } catch { /* storage blocked: just show it */ }
  if (!seen) panels.howTo();
}

app.playGuest = async () => {
  if (CONFIG.maintenance) return;
  if (app.mode === 'wallet') {
    app.mode = 'guest';
    app.backend = createLocalBackend();
    app.holding = null;
    const res = await app.backend.me();
    setProfile(res.profile);
  }
  startPlaying();
};

app.connectWallet = async () => {
  if (CONFIG.maintenance) return;
  if (app.mode === 'wallet') return startPlaying();
  if (!app.serverOnline) {
    await checkServer();
    if (!app.serverOnline) {
      toast('The game server is offline right now — play as a guest for the moment.', 'error');
      return;
    }
  }
  if (!hasWallet()) return panels.noWallet();
  title.setStatus('Check your wallet to connect and sign…');
  try {
    const res = await connectAndSignIn();
    app.session = res.session;
    app.backend = createRemoteBackend(res.session.token);
    app.mode = 'wallet';
    app.holding = res.holding;
    setProfile(res.profile);
    title.setStatus('');
    toast('Wallet connected — progress is saved', 'good');
    startPlaying();
  } catch (err) {
    title.setStatus('');
    toast(err.message, 'error');
  }
};

app.disconnect = async () => {
  await app.backend.logout?.();
  await walletDisconnect();
  saveSession(null);
  app.session = null;
  app.mode = 'guest';
  app.holding = null;
  app.backend = createLocalBackend();
  const res = await app.backend.me();
  setProfile(res.profile);
  app.goHome();
};

app.goHome = async () => {
  if (fishing.active) await fishing.forceEnd();
  lobby.disconnect();
  panels.close();
  input.unlockPointer();
  player.setMode('title');
  hud.setMode('title');
  title.show();
};

// ------------------------------------------------------------------------------------------------
// UI

const panels = createPanels(app);
app.panels = panels;
const hud = createHud(app);
const title = createTitle(app);
const fishing = createFishing({ scene, player, app, hud, input });
const touch = isTouchDevice() ? createTouchControls(app, input) : null;
if (touch) document.body.classList.add('touch');
// on-screen buttons replay the matching key
app.touchAction = (code) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code }));
};

// ------------------------------------------------------------------------------------------------
// Lobby: up to 50 anglers on one pier

const remotes = createRemotes(scene, document.getElementById('labels'));
let lobbyInfo = null;
let myLobbyId = null;
const showLobby = () => hud.setLobby(lobbyInfo && { ...lobbyInfo, count: remotes.count + 1 });

const lobby = createLobbyClient({
  welcome(msg) {
    myLobbyId = msg.id;
    remotes.clear();
    for (const p of msg.players) remotes.add(p);
    lobbyInfo = { lobby: msg.lobby, size: msg.size };
    showLobby();
    hud.chat.reset(msg.chat || []);
  },
  chat(msg) { hud.chat.add({ ...msg, mine: msg.id === myLobbyId }); },
  chat_no(msg) { hud.chat.refused(msg.why, msg.waitMs); },
  join(msg) { remotes.add(msg.p); showLobby(); },
  leave(msg) { remotes.remove(msg.id); showLobby(); },
  u(msg) { for (const [id, ...s] of msg.p) if (id !== myLobbyId) remotes.setState(id, s); },
  look(msg) { remotes.setLook(msg.id, msg.outfit, msg.rod, msg.look, msg.halo, msg.name); },
  shout(msg) {
    const sp = SPECIES_BY_ID[msg.sp];
    if (!sp) return;
    hud.shout(msg.name, sp, msg.kg);
    sfx.land(RARITIES[sp.rarity].order);
  },
  disconnected() {
    remotes.clear();
    lobbyInfo = null;
    showLobby();
    hud.chat.offline();
  },
});

const MODE_CODES = { walk: 0, fish: 1, sit: 2 };
const UP_THE_LIGHTHOUSE = 3;
function myState() {
  const st = player.state;
  const mode = st.level === 'top' ? UP_THE_LIGHTHOUSE : MODE_CODES[st.mode] ?? 0;
  const s = [st.pos.x, st.pos.z, st.facing, mode, Math.min(1, st.speed)];
  const b = fishing.bobberPosition();
  if (b) s.push(b.x, b.z);
  return s.map((n) => Math.round(n * 100) / 100);
}

function joinLobby() {
  if (!app.serverOnline) return; // the static demo has no server to meet people on
  lobby.disconnect(); // a fresh hello, in case we just switched between wallet and guest
  lobby.connect(() => ({
    token: app.mode === 'wallet' ? app.session?.token : undefined,
    outfit: app.profile?.outfit,
    rod: app.profile?.rod,
    halo: app.profile?.halo || null,
    name: app.profile?.name || undefined,
    look: app.profile?.look,
    s: myState(),
  }));
}

// sends our position about 8 times a second, only when it changed
let lastSent = '';
let sendTimer = 0;
function sendState(dt) {
  sendTimer -= dt;
  if (sendTimer > 0 || !lobby.connected || player.state.mode === 'title') return;
  sendTimer = 0.125;
  const s = myState();
  const key = s.join(',');
  if (key === lastSent) return;
  lastSent = key;
  lobby.send({ t: 's', s });
}

function interact(it) {
  sfx.click();
  switch (it.kind) {
    case 'fish':
      input.unlockPointer();
      hud.setMode('fish');
      fishing.enter(it);
      break;
    case 'shop': panels.shop(); break;
    case 'rods': panels.rods(); break;
    case 'rack': panels.rack(); break;
    case 'scores': panels.leaderboard(); break;
    case 'portal':
      sfx.open();
      toast(`${it.title} is coming soon. Keep an eye on the pier!`, 'good');
      break;
    case 'pool': panels.pool(); break;
    case 'rest':
      player.setMode('sit', { spot: it });
      hud.setMode('sit');
      break;
    case 'climb':
      sfx.open();
      player.climb('top');
      break;
    case 'down':
      sfx.open();
      player.climb('deck');
      break;
    case 'find':
      app.call('find', it.rod).then((res) => {
        if (res.already) return;
        sfx.land(5);
        toast(`★ You found the BEACON rod: +${RODS_BY_ID.beacon.luck} luck. It is on your rod rack now.`, 'good');
      }).catch((err) => toast(err.message, 'error'));
      break;
    default: break;
  }
}

function standUp() {
  // step off in front of the bench, clear of it
  player.setMode('walk', { at: player.state.sitSpot?.standAt });
  hud.setMode('walk');
}

app.sendChat = (text) => lobby.send({ t: 'chat', text });
app.onChatFocus = () => input.unlockPointer();
input.on('Enter', () => {
  if (!panels.open && !title.visible) hud.chat.focus();
});

input.on('Escape', () => {
  if (panels.open) return panels.close();
  if (player.state.mode === 'sit') standUp();
});
input.on('KeyM', () => app.setMuted(!sfx.muted));
input.on('KeyP', () => {
  if (title.visible) return;
  if (panels.open === 'profile') panels.close(); else if (!panels.open) panels.profile();
});
input.on('KeyV', () => { if (!panels.open && player.state.mode === 'walk') player.cycleView(); });
input.on('KeyE', () => {
  if (panels.open || title.visible) return;
  if (player.state.mode === 'sit') return standUp();
  if (player.state.mode !== 'walk' || fishing.justLeft) return;
  const near = player.nearestInteractable();
  if (near) interact(near);
});
input.on('Click', () => {
  if (!panels.open && player.state.mode === 'walk') input.lockPointer();
});
for (const code of ['ArrowUp', 'ArrowDown', 'Enter']) {
  input.on(code, () => { if (title.visible && !panels.open) title.key(code); });
}
window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });
window.addEventListener('keydown', () => sfx.unlock(), { once: true });

// ------------------------------------------------------------------------------------------------
// Server

async function checkServer() {
  try {
    const cfg = await publicApi.config();
    applyServerConfig(cfg);
    app.serverOnline = true;
  } catch {
    app.serverOnline = false;
  }
  return app.serverOnline;
}

async function refreshScoreboard() {
  try {
    const lb = await app.backend.leaderboard();
    world.board.draw('TOP ANGLERS', (lb.top || []).slice(0, 7).map((r) => [r.name, fmt.short(r.caught)]));
  } catch { /* offline */ }
}

async function boot() {
  const guest = await app.backend.me();
  setProfile(guest.profile);
  title.show();

  if (await checkServer()) {
    publicApi.pool().then((d) => { app.poolInfo = d; title.render(); }).catch(() => {});
    const session = loadSession();
    if (session) {
      try {
        const remote = createRemoteBackend(session.token);
        const me = await remote.me();
        app.session = session;
        app.backend = remote;
        app.mode = 'wallet';
        app.holding = me.holding;
        setProfile(me.profile);
      } catch (err) {
        if (err.status === 401) saveSession(null);
      }
    }
  }
  title.render();
  // canvas text (the scoreboard) needs the pixel font loaded first
  document.fonts?.ready.then(refreshScoreboard);
  refreshScoreboard();
}

// ------------------------------------------------------------------------------------------------
// Main loop

applyQuality();
let last = performance.now();
let t = 0;
function frame(now) {
  const raw = (now - last) / 1000;
  const dt = Math.min(0.05, raw);
  last = now;
  t += dt;

  world.update(t, dt);
  player.update(dt, t);
  // the fight runs on real time (capped after a tab switch), so a slow device doesn't drag out
  // every fight
  fishing.update(Math.min(0.25, raw), t);
  remotes.update(dt, camera, player.state.mode !== 'title');
  sendState(raw);
  if (shakeAmt > 0.001) {
    camera.position.x += (Math.random() - 0.5) * shakeAmt;
    camera.position.y += (Math.random() - 0.5) * shakeAmt;
    shakeAmt *= Math.exp(-dt * 7);
  }
  env.update(t, camera);

  const mode = player.state.mode;
  const near = mode === 'walk' && !panels.open ? player.nearestInteractable() : null;
  hud.updateLabels(camera, near, mode === 'walk', player.state.level);
  touch?.update(mode, near, !!panels.open);

  if (bloom.enabled) composer.render(dt);
  else renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
boot();

// handy for testing from the console (dev server, or add ?debug to the URL)
if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
  window.__game = { app, player, world, fishing, camera, scene, renderer };
}
