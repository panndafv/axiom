import * as THREE from 'three';
import { rodMesh } from './props.js';

// Blocky angler. Faces +z. Modelled ~2.3 m tall and drawn at CHAR_SCALE (about 1.6 m) so a deck
// with dozens of players still has room. Parts pivot at the joints so they can swing.

export const CHAR_SCALE = 0.7;
const SEAT_HEIGHT = 0.49; // bench seat top, in world metres

const SKIN = '#f0c39a';

function part(w, h, d, color, pivotTop = true) {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (pivotTop) geo.translate(0, -h / 2, 0);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85 }));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function createCharacter({ shirt = '#1f6c75', pants = '#1e2a4b', hair = '#d8662a', hat = null, rod = null } = {}) {
  const root = new THREE.Group();
  root.scale.setScalar(CHAR_SCALE);
  const body = new THREE.Group(); // bobs while walking
  root.add(body);

  const hips = new THREE.Group();
  hips.position.y = 0.92;
  body.add(hips);

  const legL = new THREE.Group(); legL.position.set(-0.17, 0, 0);
  const legR = new THREE.Group(); legR.position.set(0.17, 0, 0);
  for (const leg of [legL, legR]) {
    const thigh = part(0.3, 0.8, 0.32, pants);
    const shoe = part(0.32, 0.14, 0.42, '#2a2630');
    shoe.position.set(0, -0.78, 0.04);
    leg.add(thigh, shoe);
    hips.add(leg);
  }

  const torso = part(0.74, 0.78, 0.44, shirt, false);
  torso.position.y = 0.39;
  hips.add(torso);
  const collar = part(0.5, 0.06, 0.46, shirt, false);
  collar.position.y = 0.8;
  hips.add(collar);

  const armL = new THREE.Group(); armL.position.set(-0.49, 0.74, 0);
  const armR = new THREE.Group(); armR.position.set(0.49, 0.74, 0);
  for (const arm of [armL, armR]) {
    const sleeve = part(0.24, 0.5, 0.28, shirt);
    const hand = part(0.2, 0.24, 0.22, SKIN);
    hand.position.y = -0.5;
    arm.add(sleeve, hand);
    hips.add(arm);
  }

  const head = new THREE.Group();
  head.position.y = 0.8;
  hips.add(head);
  const face = part(0.58, 0.56, 0.54, SKIN, false);
  face.position.y = 0.3;
  head.add(face);
  for (const x of [-0.13, 0.13]) {
    const eye = part(0.07, 0.1, 0.03, '#2a1d16', false);
    eye.position.set(x, 0.32, 0.275);
    head.add(eye);
  }
  const nose = part(0.08, 0.08, 0.06, '#e3a77c', false);
  nose.position.set(0, 0.24, 0.29);
  head.add(nose);

  const hairGroup = new THREE.Group();
  head.add(hairGroup);
  const hatGroup = new THREE.Group();
  head.add(hatGroup);

  function buildHair(color) {
    hairGroup.clear();
    const add = (w, h, d, x, y, z, rx = 0, rz = 0) => {
      const p = part(w, h, d, color, false);
      p.position.set(x, y, z);
      p.rotation.set(rx, 0, rz);
      hairGroup.add(p);
    };
    add(0.64, 0.2, 0.6, 0, 0.62, -0.01);          // top
    add(0.64, 0.42, 0.14, 0, 0.42, -0.25);        // back
    add(0.12, 0.3, 0.5, -0.3, 0.46, -0.02);       // sides
    add(0.12, 0.3, 0.5, 0.3, 0.46, -0.02);
    add(0.22, 0.16, 0.14, -0.17, 0.52, 0.26, 0.3, 0.2);  // fringe chunks
    add(0.22, 0.16, 0.14, 0.05, 0.53, 0.27, 0.3, -0.1);
    add(0.18, 0.14, 0.14, 0.22, 0.51, 0.25, 0.3, -0.3);
    add(0.22, 0.12, 0.26, -0.1, 0.72, 0.02, 0, 0.25); // tufts
    add(0.2, 0.1, 0.22, 0.13, 0.71, -0.12, 0, -0.3);
  }

  function buildHat(color) {
    hatGroup.clear();
    if (!color) return;
    const crown = part(0.66, 0.24, 0.62, color, false);
    crown.position.set(0, 0.7, -0.01);
    const brim = part(0.6, 0.05, 0.3, color, false);
    brim.position.set(0, 0.6, 0.38);
    hatGroup.add(crown, brim);
  }

  buildHair(hair);
  buildHat(hat);

  // Rod holder: on the back while walking, in the right hand while fishing.
  const rodSlot = new THREE.Group();
  hips.add(rodSlot);
  let rodObj = null;

  function setRod(def) {
    if (rodObj) rodSlot.remove(rodObj);
    rodObj = def ? rodMesh(def.color, def.tip) : rodMesh();
    rodSlot.add(rodObj);
    return rodObj;
  }
  setRod(rod);

  function rodOnBack() {
    hips.add(rodSlot);
    rodSlot.position.set(0.1, 0.1, -0.3);
    rodSlot.rotation.set(0.15, 0, -0.55);
  }

  function rodInHand() {
    armR.add(rodSlot);
    rodSlot.position.set(0, -0.55, 0.05);
    rodSlot.rotation.set(2.2, 0, 0); // ~40° above the water once the arm is raised
  }
  rodOnBack();

  function setOutfit(c) {
    torso.material.color.set(c.shirt);
    collar.material.color.set(c.shirt);
    armL.children[0].material.color.set(c.shirt);
    armR.children[0].material.color.set(c.shirt);
    legL.children[0].material.color.set(c.pants);
    legR.children[0].material.color.set(c.pants);
    buildHair(c.hair);
    buildHat(c.hat);
  }

  let phase = 0;
  let sit = 0;
  // speed: 0..1 walk amount. pose: 'walk' | 'fish' | 'sit'
  function animate(dt, speed, pose = 'walk', reel = 0) {
    phase += dt * (6 + speed * 5) * (speed > 0.05 ? 1 : 0.3);
    const swing = Math.sin(phase) * 0.7 * speed;
    sit += ((pose === 'sit' ? 1 : 0) - sit) * Math.min(1, dt * 8);

    legL.rotation.x = swing * (1 - sit) - sit * 1.5;
    legR.rotation.x = -swing * (1 - sit) - sit * 1.5;
    hips.position.y = 0.92 - sit * (0.92 - SEAT_HEIGHT / CHAR_SCALE) + Math.abs(Math.sin(phase)) * 0.06 * speed;
    body.rotation.x = 0;

    if (pose === 'fish') {
      armR.rotation.set(-1.1 - reel * 0.25, 0, -0.1);
      armL.rotation.set(-0.9 - reel * 0.2, 0, 0.35);
    } else {
      armL.rotation.set(-swing * 0.8 * (1 - sit) + Math.sin(phase * 0.5) * 0.03, 0, 0.05);
      armR.rotation.set(swing * 0.8 * (1 - sit) - sit * 0.4, 0, -0.05);
    }
    head.rotation.y = Math.sin(phase * 0.21) * 0.05;
  }

  return {
    root, head, armR, rodSlot,
    get rod() { return rodObj; },
    setRod, setOutfit, rodOnBack, rodInHand, animate,
  };
}

// Rod tip position in world space (for drawing the fishing line).
const tmp = new THREE.Vector3();
export function rodTipWorld(character, out = new THREE.Vector3()) {
  const rod = character.rod;
  if (!rod) return out.set(0, 0, 0);
  tmp.copy(rod.userData.tip);
  return rod.localToWorld(out.copy(tmp));
}
