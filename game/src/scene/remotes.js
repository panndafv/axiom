import * as THREE from 'three';
import { createCharacter, rodTipWorld } from './characters.js';
import { makeBobber } from '../game/fishing.js';
import { DECK_Y } from './world.js';
import { OUTFITS_BY_ID, RODS_BY_ID } from '../../shared/rules.js';

// Everyone else in the lobby. Their positions arrive ~8 times a second, so each one glides toward
// its latest position and turns smoothly instead of jumping.

const MODES = ['walk', 'fish', 'sit'];
const TAG_RANGE = 32; // metres; name tags further away are hidden
const lineMat = new THREE.LineBasicMaterial({ color: '#f5efe2', transparent: true, opacity: 0.7 });
const tmp = new THREE.Vector3();
const tip = new THREE.Vector3();

function dampAngle(a, b, k) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export function createRemotes(scene, labelsLayer) {
  const players = new Map();

  function applyState(p, s, snap = false) {
    const [x, z, f, m, sp, bx, bz] = s;
    p.target.set(x, DECK_Y, z);
    p.targetFacing = f;
    p.mode = MODES[m] || 'walk';
    p.netSpeed = sp;
    p.bob = Number.isFinite(bx) ? [bx, bz] : null;
    if (snap || p.pos.distanceTo(p.target) > 6) {
      p.pos.copy(p.target);
      p.facing = f;
    }
  }

  function add(info) {
    if (players.has(info.id)) remove(info.id);
    const outfit = OUTFITS_BY_ID[info.outfit] || OUTFITS_BY_ID.deckhand;
    const char = createCharacter({ ...outfit.colors, rod: RODS_BY_ID[info.rod], shadows: false });
    scene.add(char.root);
    const tag = document.createElement('div');
    tag.className = `world-label player-tag${info.wallet ? ' wallet' : ''}`;
    tag.textContent = info.name;
    labelsLayer.append(tag);
    const bobber = makeBobber();
    bobber.visible = false;
    scene.add(bobber);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(lineGeo, lineMat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    const p = {
      id: info.id, name: info.name, char, tag, bobber, line,
      pos: new THREE.Vector3(), target: new THREE.Vector3(), facing: 0, targetFacing: 0,
      mode: 'walk', netSpeed: 0, speed: 0, bob: null,
    };
    applyState(p, info.s, true);
    players.set(info.id, p);
  }

  function remove(id) {
    const p = players.get(id);
    if (!p) return;
    scene.remove(p.char.root, p.bobber, p.line);
    p.char.dispose();
    p.line.geometry.dispose();
    p.tag.remove();
    players.delete(id);
  }

  return {
    add,
    remove,
    get count() { return players.size; },
    setState(id, s) {
      const p = players.get(id);
      if (p) applyState(p, s);
    },
    setLook(id, outfitId, rodId) {
      const p = players.get(id);
      if (!p) return;
      p.char.setOutfit((OUTFITS_BY_ID[outfitId] || OUTFITS_BY_ID.deckhand).colors);
      p.char.setRod(RODS_BY_ID[rodId] || RODS_BY_ID.driftwood);
      if (p.mode === 'fish') p.char.rodInHand(); else p.char.rodOnBack();
    },
    clear() {
      for (const id of [...players.keys()]) remove(id);
    },
    update(dt, camera, showTags) {
      const k = 1 - Math.exp(-dt * 8);
      const w = window.innerWidth, h = window.innerHeight;
      for (const p of players.values()) {
        const before = tmp.copy(p.pos);
        p.pos.lerp(p.target, k);
        const moved = before.distanceTo(p.pos) / Math.max(dt, 1e-3);
        p.speed += ((p.mode === 'walk' ? Math.min(1, moved / 6) : 0) - p.speed) * Math.min(1, dt * 10);
        p.facing = dampAngle(p.facing, p.targetFacing, Math.min(1, dt * 10));
        p.char.root.position.copy(p.pos);
        p.char.root.rotation.y = p.facing;
        if ((p.mode === 'fish') !== p.char.holdingRod) {
          if (p.mode === 'fish') p.char.rodInHand(); else p.char.rodOnBack();
        }
        p.char.animate(dt, p.speed, p.mode, p.mode === 'fish' ? 0.2 : 0);

        const fishing = p.mode === 'fish' && p.bob;
        p.bobber.visible = p.line.visible = !!fishing;
        if (fishing) {
          p.bobber.position.set(p.bob[0], 0.02, p.bob[1]);
          rodTipWorld(p.char, tip);
          const arr = p.line.geometry.attributes.position.array;
          arr.set([tip.x, tip.y, tip.z, p.bob[0], 0.12, p.bob[1]]);
          p.line.geometry.attributes.position.needsUpdate = true;
        }

        // name tag above the head
        tmp.copy(p.pos);
        tmp.y += 1.95;
        const dist = tmp.distanceTo(camera.position);
        tmp.project(camera);
        if (!showTags || tmp.z > 1 || dist > TAG_RANGE) {
          p.tag.style.display = 'none';
          continue;
        }
        p.tag.style.display = '';
        p.tag.style.left = `${((tmp.x + 1) / 2) * w}px`;
        p.tag.style.top = `${((1 - tmp.y) / 2) * h}px`;
        p.tag.style.opacity = THREE.MathUtils.clamp(1.3 - dist / TAG_RANGE, 0.35, 1);
      }
    },
  };
}
