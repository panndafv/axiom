import * as THREE from 'three';
import { createCharacter } from '../scene/characters.js';
import { DECK_Y } from '../scene/world.js';
import { OUTFITS_BY_ID, RODS_BY_ID } from '../../shared/rules.js';

// The player's angler plus the camera that follows it.
// Camera modes: 'title' (slow orbit), 'walk' (third/first person), 'fish' (behind the angler at a
// fishing spot), 'sit' (watching the sunset from the bench).

const VIEWS = [
  { dist: 5, lift: 1.45 },
  { dist: 8.5, lift: 1.8 },
  { dist: 0, lift: 1.45 }, // first person
];
const RADIUS = 0.25; // how close the angler gets to props

const tmpV = new THREE.Vector3();
const tmpT = new THREE.Vector3();
const tmpR = new THREE.Vector3();

function dampAngle(a, b, k) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export function createPlayer(scene, camera, world, input, settings) {
  const char = createCharacter();
  scene.add(char.root);

  const state = {
    pos: world.spawn.pos.clone(),
    facing: world.spawn.yaw,
    camYaw: 0,
    camPitch: 0.38,
    view: 0,
    mode: 'title',
    speed: 0,
    fishSpot: null,
    sitSpot: null,
    reel: 0,
  };
  const camTarget = new THREE.Vector3(0, 3, -8);
  const camPos = new THREE.Vector3(0, 20, 36);
  camera.position.copy(camPos);

  function setOutfit(id) {
    const o = OUTFITS_BY_ID[id] || OUTFITS_BY_ID.deckhand;
    char.setOutfit(o.colors);
  }

  function setRod(id) {
    char.setRod(RODS_BY_ID[id] || RODS_BY_ID.driftwood);
    if (state.mode === 'fish') char.rodInHand(); else char.rodOnBack();
  }

  function setMode(mode, opts = {}) {
    state.mode = mode;
    if (mode === 'fish') {
      state.fishSpot = opts.spot;
      state.pos.copy(opts.spot.pos);
      state.facing = Math.atan2(opts.spot.face.x, opts.spot.face.z);
      char.rodInHand();
    } else if (mode === 'sit') {
      state.sitSpot = opts.spot;
      state.pos.copy(opts.spot.sitAt || opts.spot.pos);
      state.facing = opts.spot.sitFacing ?? Math.PI;
      char.rodOnBack();
    } else {
      char.rodOnBack();
      if (mode === 'walk' && opts.reset) {
        state.pos.copy(world.spawn.pos);
        state.facing = world.spawn.yaw;
        state.camYaw = 0;
      } else if (mode === 'walk' && opts.at) {
        state.pos.copy(opts.at);
      }
    }
    if (mode === 'walk') {
      // look the way the angler faces
      state.camYaw = state.facing - Math.PI;
    }
    char.root.visible = !(mode === 'walk' && VIEWS[state.view].dist === 0);
  }

  function cycleView() {
    state.view = (state.view + 1) % VIEWS.length;
    char.root.visible = !(state.mode === 'walk' && VIEWS[state.view].dist === 0);
    return state.view;
  }

  function tryMove(nx, nz) {
    if (!world.isWalkable(nx, nz)) return false;
    for (const c of world.colliders) {
      const r2 = (c.r + RADIUS) ** 2;
      const dNew = (nx - c.x) ** 2 + (nz - c.z) ** 2;
      if (dNew >= r2) continue;
      // Already overlapping something (e.g. just stood up from the bench): stepping away from
      // it is always allowed, so the player can never get wedged.
      const dOld = (state.pos.x - c.x) ** 2 + (state.pos.z - c.z) ** 2;
      if (dOld < r2 && dNew > dOld) continue;
      return false;
    }
    return true;
  }

  function updateWalk(dt) {
    const sens = 0.0024 * (settings.sensitivity ?? 1);
    const [dx, dy] = input.takeLook();
    state.camYaw -= dx * sens;
    state.camPitch += dy * sens * (settings.invertY ? -1 : 1);
    if (input.down('ArrowLeft')) state.camYaw += dt * 2.2;
    if (input.down('ArrowRight')) state.camYaw -= dt * 2.2;
    if (input.down('ArrowUp')) state.camPitch -= dt * 1.4;
    if (input.down('ArrowDown')) state.camPitch += dt * 1.4;
    const fp = VIEWS[state.view].dist === 0;
    state.camPitch = THREE.MathUtils.clamp(state.camPitch, fp ? -1.1 : -0.25, fp ? 1.1 : 1.25);

    const f = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0) + input.axis.y;
    const s = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0) + input.axis.x;
    const fx = -Math.sin(state.camYaw), fz = -Math.cos(state.camYaw);
    const rx = -fz, rz = fx;
    let mx = fx * f + rx * s, mz = fz * f + rz * s;
    const len = Math.hypot(mx, mz);
    const run = input.down('ShiftLeft') || input.down('ShiftRight') || Math.hypot(input.axis.x, input.axis.y) > 0.85;
    const target = len > 0 ? (run ? 1 : 0.62) : 0;
    state.speed += (target - state.speed) * Math.min(1, dt * 10);
    if (len > 0) {
      mx /= len; mz /= len;
      const v = 6 * state.speed * dt;
      const nx = state.pos.x + mx * v, nz = state.pos.z + mz * v;
      if (tryMove(nx, nz)) { state.pos.x = nx; state.pos.z = nz; }
      else if (tryMove(nx, state.pos.z)) state.pos.x = nx;
      else if (tryMove(state.pos.x, nz)) state.pos.z = nz;
      state.facing = dampAngle(state.facing, Math.atan2(mx, mz), Math.min(1, dt * 12));
    }
    if (fp) state.facing = dampAngle(state.facing, state.camYaw + Math.PI, 1);
  }

  // The shop, rack, bench etc. win when you are next to one; otherwise any edge of the pier is
  // a place to fish.
  function nearestInteractable() {
    let best = null, bestD = Infinity;
    for (const it of world.interactables) {
      const d = Math.hypot(it.pos.x - state.pos.x, it.pos.z - state.pos.z);
      if (d < it.radius && d < bestD) { best = it; bestD = d; }
    }
    return best || world.edgeSpot(state.pos.x, state.pos.z);
  }

  function updateCamera(dt, t) {
    const k = 1 - Math.exp(-dt * 6);
    if (state.mode === 'title') {
      const a = 0.32 + Math.sin(t * 0.045) * 0.3;
      tmpV.set(Math.sin(a) * 44 - 6, 14 + Math.sin(t * 0.07) * 1.2, -8 + Math.cos(a) * 44);
      tmpT.set(-6, 5.5, -14);
      camPos.lerp(tmpV, 1 - Math.exp(-dt * 1.5));
      camTarget.lerp(tmpT, 1 - Math.exp(-dt * 1.5));
    } else if (state.mode === 'walk') {
      const v = VIEWS[state.view];
      const head = tmpT.set(state.pos.x, state.pos.y + v.lift, state.pos.z);
      if (v.dist === 0) {
        camPos.copy(head);
        camTarget.set(
          head.x - Math.sin(state.camYaw) * Math.cos(state.camPitch),
          head.y - Math.sin(state.camPitch),
          head.z - Math.cos(state.camYaw) * Math.cos(state.camPitch),
        );
      } else {
        tmpV.set(
          Math.sin(state.camYaw) * Math.cos(state.camPitch),
          Math.sin(state.camPitch),
          Math.cos(state.camYaw) * Math.cos(state.camPitch),
        ).multiplyScalar(v.dist).add(head);
        tmpV.y = Math.max(tmpV.y, 0.6);
        camPos.lerp(tmpV, 1 - Math.exp(-dt * 12));
        camTarget.lerp(head, 1 - Math.exp(-dt * 16));
      }
    } else if (state.mode === 'fish') {
      const s = state.fishSpot;
      const right = tmpR.set(-s.face.z, 0, s.face.x);
      tmpV.copy(s.pos).addScaledVector(s.face, -4.2).addScaledVector(right, 1.6);
      tmpV.y = DECK_Y + 2.7;
      camPos.lerp(tmpV, k);
      tmpT.copy(s.pos).addScaledVector(s.face, 12).addScaledVector(right, -0.5);
      tmpT.y = 0.8;
      camTarget.lerp(tmpT, k);
    } else if (state.mode === 'sit') {
      const s = state.sitSpot.pos;
      tmpV.set(s.x + 1.6, DECK_Y + 2.6, s.z + 3.6);
      tmpT.set(s.x - 6, DECK_Y + 2.2, s.z - 30);
      camPos.lerp(tmpV, 1 - Math.exp(-dt * 3));
      camTarget.lerp(tmpT, 1 - Math.exp(-dt * 3));
    }
    camera.position.copy(camPos);
    camera.lookAt(camTarget);
  }

  return {
    char,
    state,
    setMode,
    setOutfit,
    setRod,
    cycleView,
    nearestInteractable,
    update(dt, t) {
      if (state.mode === 'walk') updateWalk(dt);
      else { input.takeLook(); state.speed += (0 - state.speed) * Math.min(1, dt * 10); }
      char.root.position.copy(state.pos);
      char.root.rotation.y = state.facing;
      const pose = state.mode === 'fish' ? 'fish' : state.mode === 'sit' ? 'sit' : 'walk';
      char.animate(dt, state.speed, pose, state.reel);
      char.root.visible = !(state.mode === 'walk' && VIEWS[state.view].dist === 0);
      updateCamera(dt, t);
    },
  };
}
