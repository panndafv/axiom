import * as THREE from 'three';
import { GAME, RARITIES, RODS_BY_ID, SPECIES_BY_ID, reelParams } from '../../shared/rules.js';
import { createFish } from '../scene/fish3d.js';
import { rodTipWorld } from '../scene/characters.js';
import { sfx } from './audio.js';

// One run at a fishing spot: cast → wait → reel → land or snap → bank, until the lantern is out.
// The backend (server or local engine) decides what bites and checks every landing; this file
// only plays the fight and shows it.

const LINE_POINTS = 24;

function makeBobber() {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#e8333a', emissive: '#6a0a0a', flatShading: true }));
  const bot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#f7f3ea', flatShading: true }));
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.16, 4), new THREE.MeshStandardMaterial({ color: '#2a2a2a' }));
  stick.position.y = 0.17;
  g.add(top, bot, stick);
  return g;
}

function makeSplashes(scene) {
  const max = 160;
  const pos = new Float32Array(max * 3);
  const life = new Float32Array(max);
  const vel = Array.from({ length: max }, () => new THREE.Vector3());
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('life', new THREE.BufferAttribute(life, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
      attribute float life;
      varying float vL;
      void main() {
        vL = life;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = life > 0.0 ? (6.0 + 10.0 * life) * 10.0 / -mv.z : 0.0;
      }`,
    fragmentShader: /* glsl */`
      varying float vL;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(1.0, 1.0, 1.0, smoothstep(0.5, 0.2, d) * vL);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  let next = 0;
  return {
    burst(at, n = 14, power = 1) {
      for (let i = 0; i < n; i++) {
        const k = next++ % max;
        pos.set([at.x, 0.05, at.z], k * 3);
        vel[k].set((Math.random() - 0.5) * 2.2 * power, (1.5 + Math.random() * 2.5) * power, (Math.random() - 0.5) * 2.2 * power);
        life[k] = 1;
      }
    },
    update(dt) {
      for (let k = 0; k < max; k++) {
        if (life[k] <= 0) continue;
        vel[k].y -= 9.8 * dt;
        pos[k * 3] += vel[k].x * dt;
        pos[k * 3 + 1] = Math.max(0, pos[k * 3 + 1] + vel[k].y * dt);
        pos[k * 3 + 2] += vel[k].z * dt;
        life[k] -= dt * 1.6;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.life.needsUpdate = true;
    },
  };
}

function makeRings(scene) {
  const rings = [];
  const geo = new THREE.RingGeometry(0.3, 0.4, 24);
  geo.rotateX(-Math.PI / 2);
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false;
    scene.add(m);
    rings.push({ m, t: 1 });
  }
  let next = 0;
  return {
    spawn(at, size = 1) {
      const r = rings[next++ % rings.length];
      r.m.position.set(at.x, 0.04, at.z);
      r.t = 0;
      r.size = size;
      r.m.visible = true;
    },
    update(dt) {
      for (const r of rings) {
        if (r.t >= 1) { r.m.visible = false; continue; }
        r.t += dt * 0.9;
        r.m.scale.setScalar((1 + r.t * 4) * r.size);
        r.m.material.opacity = (1 - r.t) * 0.8;
      }
    },
  };
}

export function createFishing({ scene, player, app, hud, input }) {
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LINE_POINTS * 3), 3));
  const lineMat = new THREE.LineBasicMaterial({ color: '#f5efe2', transparent: true, opacity: 0.85 });
  const line = new THREE.Line(lineGeo, lineMat);
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);

  const bobber = makeBobber();
  bobber.visible = false;
  scene.add(bobber);
  const splashes = makeSplashes(scene);
  const rings = makeRings(scene);

  let spot = null;
  let state = 'off'; // off | idle | casting | waiting | fighting | busy | results
  let run = null;
  let runEnd = 0;
  let cast = null;
  let landed = null; // flying fish animation
  let castAnim = null;
  let finishing = false;
  let reelTick = 0;
  const tip = new THREE.Vector3();
  const bobberRest = new THREE.Vector3();
  const shore = new THREE.Vector3();

  const now = () => performance.now();
  const errorToast = (err) => app.toast(err.message || String(err), 'error');

  function setRun(r) {
    run = r;
    if (r) runEnd = now() + r.msLeft;
    hud.fishing.setRun(run, app.profile);
  }

  let enteredAt = 0;
  function enter(s) {
    spot = s;
    state = 'idle';
    enteredAt = now();
    finishing = false;
    player.setMode('fish', { spot });
    hud.fishing.show();
    // resume a run that is still burning (e.g. left and came back quickly)
    const r = app.profile?.run;
    setRun(r && r.msLeft > 0 ? r : null);
    if (run?.cast) {
      // a cast left in the water by a page reload: reel it in
      app.call('lose', run.id, run.cast.id, 'cancel').then((res) => setRun(res.run)).catch(() => {});
    }
    refreshPrompt();
  }

  async function leave() {
    if (state === 'off') return;
    if (state === 'fighting' || state === 'casting' || state === 'waiting') {
      if (cast?.castId) await app.call('lose', run.id, cast.castId, 'cancel').catch(() => {});
      clearCast();
    }
    if (run) {
      pendingLeave = true;
      await finishRun();
      if (state === 'results') return; // exit once the results are closed
    }
    exit();
  }

  let pendingLeave = false;
  function exit() {
    state = 'off';
    pendingLeave = false;
    clearCast();
    hud.fishing.hide();
    player.setMode('walk');
    app.onLeaveFishing?.();
  }

  function clearCast() {
    cast = null;
    castAnim = null;
    line.visible = false;
    bobber.visible = false;
    player.state.reel = 0;
    hud.fishing.hideReel();
  }

  function refreshPrompt() {
    hud.fishing.setPrompt(state, { mult: run?.mult || 1, stringer: run?.stringer?.length || 0 });
  }

  async function doCast() {
    if (state !== 'idle') return;
    // the lantern just went out: show this run's results before a new one starts
    if (run && runEnd - now() <= 0) return finishRun();
    state = 'casting';
    refreshPrompt();
    try {
      if (!run) {
        const res = await app.call('startRun');
        setRun(res.run);
      }
    } catch (err) {
      state = 'idle';
      refreshPrompt();
      return errorToast(err);
    }

    // Pick where the bobber lands ("it lands where it lands"), but always in open water: from
    // some edges another deck or the lighthouse rocks are in the way, so try shorter casts and
    // other angles until one clears.
    const right = new THREE.Vector3(-spot.face.z, 0, spot.face.x);
    for (let attempt = 0; attempt < 24; attempt++) {
      const reach = Math.max(0.25, 1 - attempt / 20);
      const dist = 2.5 + (6.5 + Math.random() * 7) * reach;
      const side = (Math.random() - 0.5) * (0.7 + attempt * 0.05);
      bobberRest.copy(spot.pos).addScaledVector(spot.face, dist).addScaledVector(right, dist * side);
      if (app.world.isOverWater(bobberRest.x, bobberRest.z)) break;
    }
    bobberRest.y = 0.02;
    shore.copy(spot.pos).addScaledVector(spot.face, 1.6);
    shore.y = 0.02;

    castAnim = { t: 0, from: rodTipWorld(player.char, new THREE.Vector3()), flew: false };
    sfx.cast();
    cast = { castId: null, pending: true };
    try {
      const res = await app.call('cast', run.id);
      cast = {
        castId: res.castId,
        biteAt: now() + res.biteInMs,
        fight: res.fight,
        luck: res.luck,
        params: reelParams({ difficulty: res.fight.difficulty }, RODS_BY_ID[app.profile.rod] || RODS_BY_ID.driftwood),
      };
      hud.fishing.setRun(run, app.profile);
    } catch (err) {
      clearCast();
      state = 'idle';
      refreshPrompt();
      errorToast(err);
      if (err.code === 'oil_out' || err.code === 'no_run') finishRun();
    }
  }

  function startFight() {
    state = 'fighting';
    const p = cast.params;
    cast.prog = GAME.startProgress;
    cast.ten = 0;
    cast.surgeUntil = 0;
    cast.nextSurge = now() + 1000 * (p.surgeGap[0] + Math.random() * (p.surgeGap[1] - p.surgeGap[0])) * 0.6;
    sfx.bite();
    splashes.burst(bobberRest, 10, 0.7);
    rings.spawn(bobberRest, 1.2);
    hud.fishing.bite();
    refreshPrompt();
  }

  async function resolve(kind) {
    state = 'busy';
    const c = cast;
    hud.fishing.hideReel();
    refreshPrompt();
    try {
      if (kind === 'land') {
        let res;
        for (let attempt = 0; ; attempt++) {
          try {
            res = await app.call('land', run.id, c.castId);
            break;
          } catch (err) {
            // the server says we were a hair too quick (clock drift): wait and try again
            if (err.code === 'too_fast' && attempt < 6) { await new Promise((r) => setTimeout(r, 300)); continue; }
            throw err;
          }
        }
        setRun(res.run);
        const sp = SPECIES_BY_ID[res.fish.sp];
        showLanded(sp, res.fish, res.isNew);
        line.visible = false;
        bobber.visible = false;
        setTimeout(() => { if (state === 'busy') { state = 'idle'; refreshPrompt(); } }, 1500);
      } else {
        const res = await app.call('lose', run.id, c.castId, kind);
        setRun(res.run);
        line.visible = false;
        if (kind === 'snap') {
          sfx.snap();
          app.shake(0.35);
          hud.fishing.banner(res.lost.length ? `Snapped! −${res.lost.length} fish` : 'Snapped!', 'snap');
        } else {
          sfx.escape();
          hud.fishing.banner('It got away', 'info');
          bobber.visible = false;
        }
        // a lost fish frees the line no sooner than landing it would have
        const wait = Math.max(900, res.run?.readyInMs || 0);
        if (wait > 1500) hud.fishing.cooldown(wait);
        setTimeout(() => { bobber.visible = false; if (state === 'busy') { state = 'idle'; refreshPrompt(); } }, wait);
      }
    } catch (err) {
      errorToast(err);
      clearCast();
      state = 'idle';
      refreshPrompt();
      if (err.code === 'oil_out' || err.code === 'no_run') finishRun();
    }
    cast = null;
    player.state.reel = 0;
  }

  function showLanded(sp, fish, isNew) {
    const rarity = RARITIES[sp.rarity];
    sfx.land(rarity.order);
    splashes.burst(bobber.position, 22, 1.2);
    const mesh = createFish(sp, { glow: rarity.order >= 4 });
    const [lo, hi] = sp.kg;
    const size = hi > lo ? (fish.kg - lo) / (hi - lo) : 0.5;
    mesh.scale.setScalar(0.45 + size * 0.5 + rarity.order * 0.06);
    scene.add(mesh);
    const to = rodTipWorld(player.char, new THREE.Vector3());
    to.y -= 0.6;
    landed = { mesh, t: 0, from: bobber.position.clone(), to };
    hud.fishing.reveal(sp, fish, isNew);
    hud.fishing.lastCatch(`${rarity.label} · ${sp.name} +${fish.value}`, rarity.color);
  }

  async function bank() {
    if (!run?.stringer?.length || !['idle', 'waiting'].includes(state)) return;
    try {
      const res = await app.call('bank', run.id);
      setRun(res.run);
      sfx.bank();
      hud.fishing.banner(`+${res.score} banked${res.mult > 1 ? ` ×${res.mult.toFixed(2)}` : ''}`, 'bank');
      if (res.autoSold) app.toast(`🎒 Backpack full: sold your ${res.autoSold} cheapest fish for ✦${res.autoSoldCash}`);
      refreshPrompt();
    } catch (err) {
      errorToast(err);
    }
  }

  async function finishRun() {
    if (finishing || !run) return;
    finishing = true;
    const prev = state;
    state = 'busy';
    clearCast();
    try {
      const res = await app.call('endRun', run.id);
      run = null;
      hud.fishing.setRun(null, app.profile);
      if (res.results && (res.results.landed > 0 || !pendingLeave)) {
        sfx.oilOut();
        state = 'results';
        app.showResults(res.results, () => {
          if (state !== 'results') return; // already left (e.g. went home)
          state = 'idle';
          refreshPrompt();
          if (pendingLeave) exit();
        });
      } else {
        state = prev === 'busy' ? 'idle' : 'idle';
      }
    } catch (err) {
      errorToast(err);
      run = null;
      state = 'idle';
    }
    finishing = false;
    refreshPrompt();
  }

  // ------------------------------------------------------------------------------------------

  function drawLine(slack) {
    rodTipWorld(player.char, tip);
    const end = bobber.position;
    const arr = lineGeo.attributes.position.array;
    for (let i = 0; i < LINE_POINTS; i++) {
      const t = i / (LINE_POINTS - 1);
      const x = tip.x + (end.x - tip.x) * t;
      const z = tip.z + (end.z - tip.z) * t;
      let y = tip.y + (end.y + 0.1 - tip.y) * t;
      y -= Math.sin(Math.PI * t) * slack;
      arr[i * 3] = x; arr[i * 3 + 1] = Math.max(y, end.y); arr[i * 3 + 2] = z;
    }
    lineGeo.attributes.position.needsUpdate = true;
  }

  function update(dt, t) {
    splashes.update(dt);
    rings.update(dt);

    if (landed) {
      landed.t += dt / 0.75;
      const k = Math.min(1, landed.t);
      landed.mesh.position.lerpVectors(landed.from, landed.to, k);
      landed.mesh.position.y += Math.sin(k * Math.PI) * 3;
      landed.mesh.rotation.set(Math.sin(t * 20) * 0.4, -player.state.facing, Math.PI / 2 + Math.sin(t * 14) * 0.5);
      if (landed.t > 2.2) {
        scene.remove(landed.mesh);
        landed = null;
      } else if (landed.t > 1.8) {
        landed.mesh.scale.multiplyScalar(0.85);
      }
    }

    if (state === 'off') return;

    // lantern
    if (run) {
      const left = runEnd - now();
      hud.fishing.setOil(Math.max(0, left), GAME.oilMs);
      if (left <= 0 && !finishing && state !== 'busy' && state !== 'results') finishRun();
    } else {
      hud.fishing.setOil(null, GAME.oilMs);
    }

    // cast swing + bobber flight
    if (castAnim) {
      castAnim.t += dt;
      const a = castAnim.t;
      player.state.reel = a < 0.22 ? (a / 0.22) * 6 : a < 0.4 ? 6 - ((a - 0.22) / 0.18) * 6.8 : -0.8 + Math.min(1, (a - 0.4) / 0.4) * 0.8;
      if (a >= 0.38) {
        const f = Math.min(1, (a - 0.38) / 0.8);
        rodTipWorld(player.char, tip);
        if (!castAnim.flew) { castAnim.from.copy(tip); castAnim.flew = true; }
        bobber.visible = true;
        line.visible = true;
        bobber.position.lerpVectors(castAnim.from, bobberRest, f);
        bobber.position.y = THREE.MathUtils.lerp(castAnim.from.y, bobberRest.y, f) + Math.sin(f * Math.PI) * 4;
        if (f >= 1) {
          castAnim = null;
          player.state.reel = 0;
          sfx.plop();
          splashes.burst(bobberRest, 8, 0.5);
          rings.spawn(bobberRest);
          if (state === 'casting') { state = 'waiting'; refreshPrompt(); }
        }
      }
      drawLine(0.8);
    }

    if (state === 'waiting' && cast && !castAnim) {
      bobber.position.copy(bobberRest);
      bobber.position.y = Math.sin(t * 2.2) * 0.04;
      drawLine(1.0);
      if (cast.biteAt && now() >= cast.biteAt) startFight();
      else if (Math.random() < dt * 0.6) rings.spawn(bobberRest, 0.6);
    }

    if (state === 'fighting' && cast) {
      const p = cast.params;
      const holding = input.down('Space') || input.mouseHeld;
      const n = now();
      if (n >= cast.nextSurge && n > cast.surgeUntil) {
        cast.surgeUntil = n + p.surgeLen * 1000;
        cast.nextSurge = cast.surgeUntil + 1000 * (p.surgeGap[0] + Math.random() * (p.surgeGap[1] - p.surgeGap[0]));
        sfx.splash();
      }
      const surge = n < cast.surgeUntil;
      if (holding) {
        cast.prog += p.pull * dt;
        cast.ten += (p.rise + (surge ? p.surgeRise : 0)) * dt;
        reelTick -= dt;
        if (reelTick <= 0) { sfx.reelTick(); reelTick = 0.07; }
      } else {
        cast.prog -= p.slip * dt;
        cast.ten = Math.max(0, cast.ten - p.bleed * dt);
      }
      if (surge) {
        cast.prog -= p.surgeSlip * dt;
        if (Math.random() < dt * 8) splashes.burst(bobber.position, 3, 0.6);
      }
      cast.prog = Math.min(1, cast.prog);

      // fish drags the bobber toward the jetty as progress rises
      const k = THREE.MathUtils.clamp((cast.prog - GAME.startProgress) / (1 - GAME.startProgress), 0, 1);
      bobber.position.lerpVectors(bobberRest, shore, k * 0.85);
      bobber.position.x += Math.sin(t * 9) * 0.15 * (surge ? 2.5 : 1);
      bobber.position.z += Math.cos(t * 7) * 0.12 * (surge ? 2.5 : 1);
      bobber.position.y = -0.06 + Math.sin(t * 14) * 0.03;
      if (Math.random() < dt * 3) rings.spawn(bobber.position, 0.7);
      lineMat.color.setRGB(1, 1 - cast.ten * 0.6, 1 - cast.ten * 0.75);
      drawLine(holding ? 0.05 : 0.35);
      player.state.reel = holding ? 1 + Math.sin(t * 30) * 0.1 : 0.2;
      hud.fishing.setReel(cast.prog, cast.ten, surge, holding);

      if (cast.ten >= 1) resolve('snap');
      else if (cast.prog <= 0) resolve('escape');
      else if (cast.prog >= 1) resolve('land');
    } else {
      lineMat.color.set('#f5efe2');
    }
  }

  // controls
  input.on('Space', () => { if (state === 'idle' && !app.modalOpen()) doCast(); });
  input.on('Click', () => { if (state === 'idle' && !app.modalOpen()) doCast(); });
  input.on('KeyB', () => { if (!app.modalOpen()) bank(); });
  // Leaving is allowed between server calls only. The same E press that walked us onto the jetty
  // must not also walk us off it.
  const canLeave = () => ['idle', 'waiting', 'fighting'].includes(state) && !app.modalOpen() && now() - enteredAt > 250;
  input.on('KeyE', () => { if (canLeave()) leave(); });
  input.on('Escape', () => { if (canLeave()) leave(); });

  return {
    enter,
    leave,
    update,
    get active() { return state !== 'off'; },
    get state() { return state; },
    get run() { return run; },
    // HOME button: end the run quietly (no results screen) and step off the jetty
    async forceEnd() {
      if (state === 'off') return;
      const r = run, c = cast;
      state = 'busy';
      run = null;
      if (r) {
        if (c?.castId) await app.call('lose', r.id, c.castId, 'cancel').catch(() => {});
        await app.call('endRun', r.id).catch(() => {});
      }
      exit();
    },
  };
}
