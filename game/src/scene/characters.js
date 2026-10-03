import * as THREE from 'three';
import { rodMesh } from './props.js';
import { paintedGeometry, paintedMaterial, boxPiece } from './merge.js';

// Blocky angler. Faces +z. Modelled ~2.3 m tall and drawn at CHAR_SCALE (about 1.6 m) so a deck
// with dozens of players still has room. Each limb is one painted mesh pivoting at its joint, so a
// whole angler draws in seven calls and a lobby of fifty stays smooth.

export const CHAR_SCALE = 0.62;
const SEAT_HEIGHT = 0.49; // bench seat top, in world metres

const SKIN = '#f0c39a';
const SHOES = '#2a2630';

function partMesh(shadows) {
  const m = new THREE.Mesh(new THREE.BufferGeometry(), paintedMaterial);
  m.castShadow = shadows;
  m.receiveShadow = shadows;
  return m;
}

function setGeometry(mesh, pieces) {
  mesh.geometry.dispose();
  mesh.geometry = paintedGeometry(pieces);
}

function hairPieces(hair, hat) {
  const out = [
    [0.64, 0.2, 0.6, 0, 0.62, -0.01],      // top
    [0.64, 0.42, 0.14, 0, 0.42, -0.25],    // back
    [0.12, 0.3, 0.5, -0.3, 0.46, -0.02],   // sides
    [0.12, 0.3, 0.5, 0.3, 0.46, -0.02],
    [0.22, 0.16, 0.14, -0.17, 0.52, 0.26, 0.3, 0.2], // fringe chunks
    [0.22, 0.16, 0.14, 0.05, 0.53, 0.27, 0.3, -0.1],
    [0.18, 0.14, 0.14, 0.22, 0.51, 0.25, 0.3, -0.3],
    [0.22, 0.12, 0.26, -0.1, 0.72, 0.02, 0, 0.25], // tufts
    [0.2, 0.1, 0.22, 0.13, 0.71, -0.12, 0, -0.3],
  ].map(([w, h, d, x, y, z, rx = 0, rz = 0]) => boxPiece(w, h, d, hair, [x, y, z], [rx, 0, rz]));
  if (hat) {
    out.push(boxPiece(0.66, 0.24, 0.62, hat, [0, 0.7, -0.01]));
    out.push(boxPiece(0.6, 0.05, 0.3, hat, [0, 0.6, 0.38]));
  }
  return out;
}

export function createCharacter({ shirt = '#1f6c75', pants = '#1e2a4b', hair = '#d8662a', hat = null, rod = null, shadows = true } = {}) {
  const root = new THREE.Group();
  root.scale.setScalar(CHAR_SCALE);
  const body = new THREE.Group(); // bobs while walking
  root.add(body);

  const hips = new THREE.Group();
  hips.position.y = 0.92;
  body.add(hips);

  const legL = new THREE.Group(); legL.position.set(-0.17, 0, 0);
  const legR = new THREE.Group(); legR.position.set(0.17, 0, 0);
  const armL = new THREE.Group(); armL.position.set(-0.49, 0.74, 0);
  const armR = new THREE.Group(); armR.position.set(0.49, 0.74, 0);
  const head = new THREE.Group(); head.position.y = 0.8;
  const legMeshL = partMesh(shadows), legMeshR = partMesh(shadows);
  const armMeshL = partMesh(shadows), armMeshR = partMesh(shadows);
  const torso = partMesh(shadows), headMesh = partMesh(shadows);
  legL.add(legMeshL); legR.add(legMeshR);
  armL.add(armMeshL); armR.add(armMeshR);
  head.add(headMesh);
  hips.add(legL, legR, armL, armR, torso, head);

  function setOutfit(c) {
    const leg = () => [boxPiece(0.3, 0.8, 0.32, c.pants, [0, 0, 0], [0, 0, 0], true), boxPiece(0.32, 0.14, 0.42, SHOES, [0, -0.78, 0.04], [0, 0, 0], true)];
    const arm = () => [boxPiece(0.24, 0.5, 0.28, c.shirt, [0, 0, 0], [0, 0, 0], true), boxPiece(0.2, 0.24, 0.22, SKIN, [0, -0.5, 0], [0, 0, 0], true)];
    setGeometry(legMeshL, leg());
    setGeometry(legMeshR, leg());
    setGeometry(armMeshL, arm());
    setGeometry(armMeshR, arm());
    setGeometry(torso, [boxPiece(0.74, 0.78, 0.44, c.shirt, [0, 0.39, 0]), boxPiece(0.5, 0.06, 0.46, c.shirt, [0, 0.8, 0])]);
    setGeometry(headMesh, [
      boxPiece(0.58, 0.56, 0.54, SKIN, [0, 0.3, 0]),
      boxPiece(0.07, 0.1, 0.03, '#2a1d16', [-0.13, 0.32, 0.275]),
      boxPiece(0.07, 0.1, 0.03, '#2a1d16', [0.13, 0.32, 0.275]),
      boxPiece(0.08, 0.08, 0.06, '#e3a77c', [0, 0.24, 0.29]),
      ...hairPieces(c.hair, c.hat),
    ]);
  }
  setOutfit({ shirt, pants, hair, hat });

  // Rod holder: on the back while walking, in the right hand while fishing.
  const rodSlot = new THREE.Group();
  hips.add(rodSlot);
  let rodObj = null;

  function setRod(def) {
    if (rodObj) rodSlot.remove(rodObj);
    rodObj = def ? rodMesh(def.color, def.tip, undefined, { grip: def.gripColor, reel: def.reelColor }) : rodMesh();
    rodObj.traverse((o) => { o.castShadow = shadows; });
    rodSlot.add(rodObj);
    return rodObj;
  }
  setRod(rod);

  let rodInHandNow = false;
  function rodOnBack() {
    rodInHandNow = false;
    hips.add(rodSlot);
    rodSlot.position.set(0.1, 0.1, -0.3);
    rodSlot.rotation.set(0.15, 0, -0.55);
  }

  function rodInHand() {
    rodInHandNow = true;
    armR.add(rodSlot);
    rodSlot.position.set(0, -0.55, 0.05);
    rodSlot.rotation.set(2.2, 0, 0); // ~40° above the water once the arm is raised
  }
  rodOnBack();

  // Halo: a glowing ring over the head (see HALOS). def null takes it off.
  let halo = null;
  function setHalo(def) {
    if (halo) {
      head.remove(halo);
      halo.geometry.dispose();
      halo.material.dispose();
      halo = null;
    }
    if (!def) return;
    halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.34, 0.075, 6, 12),
      new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.45, roughness: 0.4, flatShading: true }),
    );
    halo.userData.rainbow = !!def.rainbow;
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 1.02;
    head.add(halo);
  }

  let phase = 0;
  let sit = 0;
  let clock = 0;
  // speed: 0..1 walk amount. pose: 'walk' | 'fish' | 'sit'
  function animate(dt, speed, pose = 'walk', reel = 0) {
    phase += dt * (6 + speed * 5) * (speed > 0.05 ? 1 : 0.3);
    const swing = Math.sin(phase) * 0.7 * speed;
    sit += ((pose === 'sit' ? 1 : 0) - sit) * Math.min(1, dt * 8);

    legL.rotation.x = swing * (1 - sit) - sit * 1.5;
    legR.rotation.x = -swing * (1 - sit) - sit * 1.5;
    hips.position.y = 0.92 - sit * (0.92 - SEAT_HEIGHT / CHAR_SCALE) + Math.abs(Math.sin(phase)) * 0.06 * speed;

    if (pose === 'fish') {
      armR.rotation.set(-1.1 - reel * 0.25, 0, -0.1);
      armL.rotation.set(-0.9 - reel * 0.2, 0, 0.35);
    } else {
      armL.rotation.set(-swing * 0.8 * (1 - sit) + Math.sin(phase * 0.5) * 0.03, 0, 0.05);
      armR.rotation.set(swing * 0.8 * (1 - sit) - sit * 0.4, 0, -0.05);
    }
    head.rotation.y = Math.sin(phase * 0.21) * 0.05;
    if (halo) {
      clock += dt;
      halo.position.y = 1.02 + Math.sin(clock * 2.2) * 0.04;
      halo.rotation.z = clock * 0.8;
      if (halo.userData.rainbow) {
        halo.material.color.setHSL((clock * 0.15) % 1, 1, 0.5);
        halo.material.emissive.copy(halo.material.color);
      }
    }
  }

  function dispose() {
    for (const m of [legMeshL, legMeshR, armMeshL, armMeshR, torso, headMesh]) m.geometry.dispose();
    setHalo(null);
    rodObj?.traverse((o) => o.geometry?.dispose());
  }

  return {
    root, head, armR, rodSlot,
    get rod() { return rodObj; },
    get holdingRod() { return rodInHandNow; },
    setRod, setOutfit, setHalo, rodOnBack, rodInHand, animate, dispose,
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
