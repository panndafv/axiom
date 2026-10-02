import * as THREE from 'three';
import {
  mat, box, cyl, barrel, crate, lanternPost, lantern, palmTree, cooler, chest, buoy, bucket, bench, rowboat,
  pilingBundle, scoreboard, fishRack, rodRack, rodMesh, lighthouse, rockPile, island, seaStack, glowSprite, portal,
  campfire, logSeat, bush, flowers, stringLights, grassIsland, wheelBooth,
} from './props.js';
import { woodTexture, boardTexture } from './textures.js';
import { createCharacter } from './characters.js';
import { createFish } from './fish3d.js';
import { bakeStatic } from './batch.js';
import { SPECIES_BY_ID, RODS, RODS_BY_ID, WHEEL } from '../../shared/rules.js';

export const DECK_Y = 2.0;
// Floor of the walkway around the lamp room at the top of the lighthouse.
export const TOP_Y = DECK_Y + 11.28;

// Pier layout, top view: x to the east, -z to the north (toward the sunset).
const DECKS = [
  { id: 'main',     x0: -10,   x1: 10,   z0: -7,   z1: 7,    dir: 'z' },
  { id: 'north',    x0: -1.6,  x1: 1.6,  z0: -21,  z1: -7,   dir: 'z' },
  { id: 'northEnd', x0: -4.5,  x1: 4.5,  z0: -26,  z1: -21,  dir: 'x' },
  { id: 'west',     x0: -17.2, x1: -10,  z0: -5.6, z1: -2.4, dir: 'x', open: ['x0'] },
  { id: 'east',     x0: 10,    x1: 16,   z0: -1.6, z1: 1.6,  dir: 'x' },
  { id: 'eastDeck', x0: 16,    x1: 30,   z0: -7,   z1: 7,    dir: 'z' },
  // west pier, mirroring the shop deck on the other side of the main deck
  { id: 'westWalk', x0: -16,   x1: -10,  z0: 3.4,  z1: 6.6,  dir: 'x' },
  { id: 'westDeck', x0: -29,   x1: -16,  z0: 3,    z1: 13,   dir: 'z' },
  // boardwalk out to the island; its far end rests on the grass, so it is not a fishing edge
  { id: 'islandWalk', x0: 0.4, x1: 3.6,  z0: 7,    z1: 11.2, dir: 'z', open: ['z1'] },
];
const LIGHTHOUSE = { x: -22, z: -4, r: 5, towerR: 2.15 };

// A grassy island off the main deck's south side, reached by the island boardwalk. r is the radius
// of the grass top. The portals, the scoreboard, the prize wheel and a campfire live on it.
const ISLAND = { x: 2, z: 18.6, r: 7.6 };
const FIRE = { x: 2.3, z: 18.0 };
// Turns something at (x, z) to face the campfire clearing.
const facingFire = (x, z) => Math.atan2(FIRE.x - x, FIRE.z - z);

// Portals at the back of the island, facing the fire. They lead nowhere yet.
const PORTALS = [
  { id: 'lagoon', title: 'LAGOON', x: 5.4, z: 22.3, color: '#36e3d0', motif: 'starfish', roof: '#7d5232' },
  { id: 'eggs', title: 'EGGS', x: 1.7, z: 23.1, color: '#ff7ad9', motif: 'egg', roof: '#5d6b85' },
  { id: 'underworld', title: 'UNDERWORLD', x: -2.2, z: 21.4, color: '#ff6a2a', motif: 'volcano', roof: '#2b2325', lava: true },
];
// The scoreboard and the prize wheel face each other across the fire, on the west and east sides.
const SCOREBOARD = { x: -4.0, z: 18.6 };
const WHEEL_SPOT = { x: 7.9, z: 18.6 };

const PLANK_COLORS = ['#c98b52', '#b87a45', '#d49a5e', '#c2844b'].map((c) => new THREE.Color(c));

// ---------------------------------------------------------------------------------------------
// Deck geometry

// Parts of a deck side that face open water (not joined to another deck). Players can fish from
// anywhere along these.
function waterIntervals(deck, side) {
  const horizontal = side === 'z0' || side === 'z1';
  const line = deck[side];
  const [a0, a1] = horizontal ? [deck.x0, deck.x1] : [deck.z0, deck.z1];
  const joins = [];
  if (deck.open?.includes(side)) joins.push([a0, a1]);
  for (const other of DECKS) {
    if (other === deck) continue;
    const [o0, o1] = horizontal ? [other.z0, other.z1] : [other.x0, other.x1];
    if (!(o0 <= line + 0.3 && o1 >= line - 0.3)) continue;
    const [b0, b1] = horizontal ? [other.x0, other.x1] : [other.z0, other.z1];
    const g0 = Math.max(a0, b0), g1 = Math.min(a1, b1);
    if (g1 - g0 > 0.1) joins.push([g0, g1]);
  }
  joins.sort((p, q) => p[0] - q[0]);
  const water = [];
  let cur = a0;
  for (const [g0, g1] of joins) {
    if (g0 - cur > 0.3) water.push([cur, g0]);
    cur = Math.max(cur, g1);
  }
  if (a1 - cur > 0.3) water.push([cur, a1]);
  return water;
}

const SIDE_NORMALS = { z0: [0, -1], z1: [0, 1], x0: [-1, 0], x1: [1, 0] };

// Adds this deck's water edges to `edges` and returns which sides are fully joined to a neighbour.
function collectEdges(deck, edges) {
  const joined = {};
  for (const side of Object.keys(SIDE_NORMALS)) {
    const water = waterIntervals(deck, side);
    joined[side] = water.length === 0;
    const [nx, nz] = SIDE_NORMALS[side];
    const horizontal = side === 'z0' || side === 'z1';
    for (const [a0, a1] of water) {
      edges.push(horizontal
        ? { ax: a0, az: deck[side], bx: a1, bz: deck[side], nx, nz }
        : { ax: deck[side], az: a0, bx: deck[side], bz: a1, nx, nz });
    }
  }
  return joined;
}

function plankGeometry(len, width, color, uOffset) {
  const geo = new THREE.BoxGeometry(len, 0.16, width);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (len / 4) + uOffset);
  const colors = [];
  for (let i = 0; i < geo.attributes.position.count; i++) colors.push(color.r, color.g, color.b);
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

function buildDeck(deck, plankMat, root, pilings) {
  const w = deck.x1 - deck.x0, d = deck.z1 - deck.z0;
  const cx = (deck.x0 + deck.x1) / 2, cz = (deck.z0 + deck.z1) / 2;
  const along = deck.dir === 'z' ? d : w;
  const across = deck.dir === 'z' ? w : d;
  const n = Math.max(1, Math.round(across / 0.5));
  const pw = across / n;
  for (let i = 0; i < n; i++) {
    const n4 = PLANK_COLORS.length;
    const c = PLANK_COLORS[(((i * 7 + Math.floor(cx + cz)) % n4) + n4) % n4].clone();
    c.offsetHSL(0, 0, (Math.random() - 0.5) * 0.04);
    const geo = plankGeometry(along, pw - 0.04, c, Math.random());
    const m = new THREE.Mesh(geo, plankMat);
    m.receiveShadow = true;
    m.castShadow = false;
    m.userData.static = true;
    const off = -across / 2 + (i + 0.5) * pw;
    if (deck.dir === 'z') {
      m.rotation.y = Math.PI / 2;
      m.position.set(cx + off, DECK_Y - 0.08, cz);
    } else {
      m.position.set(cx, DECK_Y - 0.08, cz + off);
    }
    root.add(m);
  }
  // dark slab under the planks so the gaps read as shadow
  const under = box(w - 0.02, 0.1, d - 0.02, '#4a2e1a');
  under.position.set(cx, DECK_Y - 0.21, cz);
  under.castShadow = false;
  root.add(under);
  // fascia boards around the edge
  const fascia = '#8a5530';
  for (const [fx, fz, fw, fd] of [
    [cx, deck.z0, w, 0.12], [cx, deck.z1, w, 0.12], [deck.x0, cz, 0.12, d], [deck.x1, cz, 0.12, d],
  ]) {
    const b = box(fw + 0.02, 0.42, fd + 0.02, fascia);
    b.position.set(fx, DECK_Y - 0.37, fz);
    root.add(b);
  }
  // pilings along the edges
  const stepX = Math.max(1, Math.round(w / 4)), stepZ = Math.max(1, Math.round(d / 4));
  const spots = new Set();
  for (let i = 0; i <= stepX; i++) for (const z of [deck.z0 + 0.25, deck.z1 - 0.25]) spots.add(`${deck.x0 + 0.25 + (i / stepX) * (w - 0.5)},${z}`);
  for (let i = 0; i <= stepZ; i++) for (const x of [deck.x0 + 0.25, deck.x1 - 0.25]) spots.add(`${x},${deck.z0 + 0.25 + (i / stepZ) * (d - 0.5)}`);
  for (const s of spots) {
    const [x, z] = s.split(',').map(Number);
    const p = box(0.34, DECK_Y + 2.4, 0.34, '#6e4528');
    p.position.set(x, (DECK_Y - 2.4) / 2 - 0.25, z);
    p.castShadow = false;
    root.add(p);
    pilings.push([x, z]);
  }
}

// ---------------------------------------------------------------------------------------------

function ripples(points) {
  const geo = new THREE.RingGeometry(0.36, 0.5, 20);
  geo.rotateX(-Math.PI / 2);
  const count = points.length * 2;
  const phase = new Float32Array(count);
  const mat2 = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { time: { value: 0 } },
    vertexShader: /* glsl */`
      attribute float phase;
      uniform float time;
      varying float vA;
      void main() {
        float k = fract(time * 0.22 + phase);
        vec3 p = position * (1.0 + k * 1.8);
        vA = (1.0 - k) * 0.75;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      void main() { gl_FragColor = vec4(1.0, 0.99, 0.96, vA); }`,
  });
  const im = new THREE.InstancedMesh(geo, mat2, count);
  const m = new THREE.Matrix4();
  points.forEach(([x, z], i) => {
    for (let k = 0; k < 2; k++) {
      m.makeTranslation(x, 0.03, z);
      im.setMatrixAt(i * 2 + k, m);
      phase[i * 2 + k] = Math.random() + k * 0.5;
    }
  });
  geo.setAttribute('phase', new THREE.InstancedBufferAttribute(phase, 1));
  im.frustumCulled = false;
  return im;
}

export function createWorld(scene) {
  const root = new THREE.Group();
  const dynamic = new THREE.Group();
  scene.add(root, dynamic);

  const wood = woodTexture();
  const plankMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: wood, roughness: 0.82 });

  const pilings = [];
  const walkRects = [];
  const edges = [];
  for (const deck of DECKS) {
    buildDeck(deck, plankMat, root, pilings);
    const joined = collectEdges(deck, edges);
    // Walkable area: stops just short of the water, and runs on over joined sides so it overlaps
    // the neighbouring deck and the player can walk across.
    walkRects.push({
      x0: deck.x0 + (joined.x0 ? -0.6 : 0.3),
      x1: deck.x1 - (joined.x1 ? -0.6 : 0.3),
      z0: deck.z0 + (joined.z0 ? -0.6 : 0.3),
      z1: deck.z1 - (joined.z1 ? -0.6 : 0.3),
    });
  }

  // Lighthouse on its round stone platform
  const LH = LIGHTHOUSE;
  const plinth = cyl(LH.r + 0.1, LH.r + 0.5, DECK_Y + 1.2, 18, '#8b8076');
  plinth.position.set(LH.x, (DECK_Y - 1.2) / 2, LH.z);
  root.add(plinth);
  const plinthTop = cyl(LH.r, LH.r, 0.12, 18, '#a39686');
  plinthTop.position.set(LH.x, DECK_Y - 0.05, LH.z);
  root.add(plinthTop);
  const rocks = rockPile(9, LH.r + 1.5);
  rocks.position.set(LH.x, 0, LH.z);
  root.add(rocks);
  const lh = lighthouse();
  lh.position.set(LH.x, DECK_Y, LH.z);
  root.add(lh);

  // The Beacon rod: leaning on the lamp room at the top, on the side that faces the open sea, so it
  // is only a faint glint from the pier below.
  const beaconDef = RODS_BY_ID.beacon;
  const beaconDir = new THREE.Vector3(-0.72, 0, -0.69).normalize();
  const beaconPos = new THREE.Vector3(LH.x + beaconDir.x * 1.02, TOP_Y, LH.z + beaconDir.z * 1.02);
  const beaconRod = rodMesh(beaconDef.color, beaconDef.tip, 1.6);
  beaconRod.position.copy(beaconPos);
  beaconRod.quaternion.setFromAxisAngle(new THREE.Vector3(-beaconDir.z, 0, beaconDir.x).normalize(), 0.22);
  const beaconGlow = glowSprite('warm', 1.6);
  beaconGlow.position.copy(beaconPos).add(new THREE.Vector3(0, 1.1, 0));
  dynamic.add(beaconRod, beaconGlow);
  let beaconFound = false;
  // ---------------------------------------------------------------------------------------------
  // Props

  const colliders = [];
  const place = (obj, x, z, { rot = 0, r = 0, y = DECK_Y, scale = 1 } = {}) => {
    obj.position.set(x, y, z);
    obj.rotation.y = rot;
    obj.scale.setScalar(scale);
    root.add(obj);
    if (r) colliders.push({ x, z, r });
    return obj;
  };
  colliders.push({ x: LH.x, z: LH.z, r: LH.towerR });

  // lanterns: [x, z, rotation, has a real light]
  const lights = [];
  const lanternSpots = [
    [-9.55, -6.55, Math.PI * 0.75, true], [9.55, -6.55, Math.PI * 0.25, true],
    [-9.55, 6.55, -Math.PI * 0.75, false], [9.55, 6.55, -Math.PI * 0.25, false],
    [-4.1, -25.6, Math.PI * 0.75, true], [4.1, -25.6, Math.PI * 0.25, false],
    [16.45, -6.55, Math.PI * 0.75, false], [29.55, -6.55, Math.PI * 0.25, true],
    [29.55, 6.55, -Math.PI * 0.25, true], [-13.6, -5.25, Math.PI / 2, false],
    [1.25, -14, 0, false],
    [-28.55, 3.45, Math.PI * 0.75, true], [-28.55, 12.55, -Math.PI * 0.75, false],
    [-16.45, 12.55, -Math.PI * 0.25, false], [-13, 6.25, -Math.PI / 2, false],
  ];
  for (const [x, z, rot, lit] of lanternSpots) {
    const lp = place(lanternPost(2.7), x, z, { rot, r: 0.3 });
    if (lit) {
      const light = new THREE.PointLight('#ffb35c', 9, 11, 1.6);
      const world = lp.localToWorld(lp.userData.lamp.clone());
      light.position.copy(world);
      dynamic.add(light);
      lights.push(light);
    }
  }
  const lhLight = new THREE.PointLight('#ffd27a', 30, 30, 1.5);
  lhLight.position.set(LH.x, DECK_Y + lh.userData.lampY, LH.z);
  dynamic.add(lhLight);
  lights.push(lhLight);

  // main deck clutter (kept clear of the walkway to the west pier)
  place(barrel(), -5.6, 6.1, { r: 0.55 });
  place(barrel('#a85a2a'), -4.5, 6.3, { rot: 0.4, r: 0.55 });
  place(crate(), -6.9, 6.0, { rot: 0.2, r: 0.65 });
  place(crate(0.7), -6.9, 6.0, { rot: 0.7, y: DECK_Y + 0.9 });
  place(bucket(), -3.5, 6.3, { r: 0.35 });
  place(buoy(), 9.0, 6.1, { r: 0.45 });
  place(crate(0.8, '#e0ae76'), 8.8, -4.6, { rot: 0.5, r: 0.6 });
  place(barrel(), -8.9, -5.6, { r: 0.55 });
  const floorLamp = place(lantern(), -2.1, 4.8, {});
  floorLamp.scale.setScalar(1.2);

  // fish rack and rod rack along the main deck's north edge
  const board = boardTexture();
  const rackFish = ['bag_bass', 'candle_snapper', 'dock_sardine'].map((id) => createFish(SPECIES_BY_ID[id]));
  place(fishRack(rackFish), 4.9, -6.2, { r: 0.9 });
  const rods = place(rodRack(), 7.6, -6.35, { r: 0.8 });

  // north jetty
  const bundle = place(pilingBundle(), 1.7, -26.35, {});
  bundle.position.y = DECK_Y;
  place(bucket(), -2.6, -24.9, { r: 0.35 });
  place(barrel(), 3.3, -23.4, { r: 0.55 });
  place(lantern(), -1.3, -25.6, {}).scale.setScalar(1.2);

  // west pier: a quiet fishing deck with a boat tied up alongside
  const westBundle = place(pilingBundle(), -29.45, 9.7, {});
  westBundle.position.y = DECK_Y;
  place(barrel(), -17.1, 4.0, { r: 0.55 });
  place(barrel('#c86f35'), -18.2, 3.75, { rot: 1.2, r: 0.55 });
  place(crate(), -17.0, 12.0, { rot: 0.3, r: 0.65 });
  place(crate(0.6, '#e0ae76'), -17.0, 12.0, { rot: 0.9, y: DECK_Y + 0.9 });
  place(crate(0.8), -18.1, 12.2, { rot: -0.2, r: 0.6 });
  place(bucket(), -27.5, 6.3, { r: 0.35 });
  place(buoy(), -27.9, 12.2, { r: 0.45 });
  place(lantern(), -27.7, 9.8, {}).scale.setScalar(1.2);
  const boat = rowboat();
  boat.position.set(-22.5, 0.32, 14.6);
  boat.rotation.y = 0.06;
  dynamic.add(boat);

  // east deck: shop, rest, palm corner, reward chest
  const sandMound = cyl(1.3, 1.6, 0.25, 9, '#e6c98f');
  place(sandMound, 18.4, -4.9, {});
  sandMound.position.y = DECK_Y + 0.1;
  place(palmTree(4.2), 18.4, -4.9, { y: DECK_Y + 0.2, r: 0.5 });
  place(cooler(), 17.6, -2.9, { rot: 0.3, r: 0.6 });
  place(chest(), 20.6, -5.9, { rot: -0.15, r: 0.75 });
  place(buoy(), 16.9, 5.9, { r: 0.45 });
  place(bench(), 22.0, 6.15, { rot: Math.PI, r: 0.75, scale: 0.8 });
  place(barrel(), 27.1, 1.0, { r: 0.55 });
  place(barrel('#c86f35'), 28.6, 1.4, { rot: 1, r: 0.55 });
  place(crate(), 28.4, 3.9, { rot: 0.1, r: 0.65 });
  place(crate(0.6, '#e0ae76'), 26.4, 4.6, { rot: 0.6, r: 0.5 });
  place(bucket(), 25.6, -5.9, { r: 0.35 });

  // ---- the island: grass, sand, boulders, campfire, portal huts, scoreboard, prize wheel, palms
  // and lights
  const I = ISLAND;
  const isle = grassIsland(I.r, DECK_Y, {
    clearing: { x: FIRE.x - I.x, z: FIRE.z - I.z, r: 2.8 },
    path: { x: 0, z: -5.4, w: 2.4, len: 4.6 },
  });
  isle.position.set(I.x, 0, I.z);
  root.add(isle);

  const fire = place(campfire(), FIRE.x, FIRE.z, { r: 0.95 });
  const fireLight = new THREE.PointLight('#ff9a3c', 14, 10, 1.6);
  fireLight.position.set(FIRE.x, DECK_Y + 0.9, FIRE.z);
  dynamic.add(fireLight);
  place(logSeat(1.5), FIRE.x - 1.8, FIRE.z, { rot: Math.PI / 2, r: 0.5 });
  place(logSeat(1.4), FIRE.x + 1.8, FIRE.z + 0.3, { rot: Math.PI / 2 + 0.25, r: 0.5 });

  const portals = PORTALS.map((pt) => place(portal(pt.color, pt.title, { motif: pt.motif, roof: pt.roof, lava: pt.lava }), pt.x, pt.z,
    { rot: facingFire(pt.x, pt.z), r: 1.35 }));
  const sb = place(scoreboard(board.texture), SCOREBOARD.x, SCOREBOARD.z, { rot: facingFire(SCOREBOARD.x, SCOREBOARD.z), r: 1.05, scale: 1.2 });
  const sbFish = createFish(SPECIES_BY_ID.golden_koi);
  sbFish.scale.setScalar(0.55);
  sbFish.position.set(0, 2.95, 0.1);
  sb.add(sbFish);
  const booth = place(wheelBooth(WHEEL.prizes), WHEEL_SPOT.x, WHEEL_SPOT.z, { rot: facingFire(WHEEL_SPOT.x, WHEEL_SPOT.z), r: 1.35 });
  // the third-person camera stops short of these rather than ending up inside them
  const camBlockers = [
    ...PORTALS.map((pt) => ({ x: pt.x, z: pt.z, r: 1.5, top: DECK_Y + 4.2 })),
    { x: WHEEL_SPOT.x, z: WHEEL_SPOT.z, r: 1.5, top: DECK_Y + 4.2 },
    { x: SCOREBOARD.x, z: SCOREBOARD.z, r: 1.0, top: DECK_Y + 3.6 },
  ];

  place(palmTree(4.6), I.x + 4.9, I.z + 4.4, { y: DECK_Y - 0.05, r: 0.45 });
  place(palmTree(4.0), I.x - 2.7, I.z + 6.2, { y: DECK_Y - 0.05, r: 0.45, rot: 1.2 });
  place(barrel(), 3.55, 23.5, { r: 0.5 });
  place(barrel('#c86f35'), 3.3, 24.4, { rot: 0.8, r: 0.5 });
  place(crate(), -2.3, 14.7, { rot: 0.35, r: 0.6 });
  place(crate(0.6, '#e0ae76'), -2.3, 14.7, { rot: 0.9, y: DECK_Y + 0.9 });
  place(barrel(), -1.2, 14.1, { r: 0.5 });
  place(bucket(), 4.1, 12.9, { r: 0.35 });
  place(lantern(), 0.2, 20.9, {}).scale.setScalar(1.2);
  place(lantern(), 6.9, 20.8, {}).scale.setScalar(1.2);

  // lantern posts at the landing and two taller ones carrying festoon lights over the clearing
  const postAt = (x, z, height) => {
    const toCentre = Math.atan2(-(I.z - z), I.x - x); // turn the lamp arm towards the middle
    place(lanternPost(height), x, z, { rot: toCentre, r: 0.3 });
    return new THREE.Vector3(x, DECK_Y + height - 0.05, z);
  };
  const landW = postAt(0.0, 11.9, 2.7), landE = postAt(4.0, 11.9, 2.7);
  const westTop = postAt(-4.7, 16.4, 3.6), eastTop = postAt(8.6, 16.3, 3.6);
  root.add(stringLights(westTop, eastTop, { sag: 0.7, bulbs: 18 }));
  root.add(stringLights(landE, eastTop, { sag: 0.35, bulbs: 10 }));
  root.add(stringLights(landW, westTop, { sag: 0.35, bulbs: 9 }));

  // bushes round the shore (angles from the centre, 0 = east, -90 = towards the boardwalk)
  for (const [deg, size] of [[-60, 0.5], [-32, 0.42], [32, 0.4], [72, 0.45], [122, 0.5], [-140, 0.5], [-118, 0.4]]) {
    const a = (deg * Math.PI) / 180;
    place(bush(size), I.x + Math.cos(a) * 6.85, I.z + Math.sin(a) * 6.85, { y: DECK_Y - 0.05, rot: deg, r: 0.35 });
  }
  for (const [x, z, cols] of [[0.9, 13.6, null], [3.2, 13.3, ['#ffe066', '#ffffff']], [-0.5, 16.6, null], [5.3, 16.2, ['#c98bff', '#ffe066']],
    [-1.8, 15.6, ['#ff7ab8', '#ffffff']], [-1.4, 23.6, ['#ffe066', '#ff9f6b']]]) {
    place(cols ? flowers(cols) : flowers(), x, z, { y: DECK_Y - 0.04 });
  }

  const npc = createCharacter({ shirt: '#e8b931', pants: '#5a3a22', hair: '#3b2a20', hat: '#b8433a', rod: RODS[1] });
  npc.root.position.set(27.6, DECK_Y, 2.6);
  npc.root.rotation.y = -Math.PI / 2;
  npc.rodInHand();
  dynamic.add(npc.root);
  colliders.push({ x: 27.6, z: 2.6, r: 0.45 });

  // distant scenery
  place(island(13), 80, -140, { y: 0 });
  place(island(7, false), -110, -70, { y: 0 });
  place(island(5), 120, -40, { y: 0 });
  place(seaStack(), 64, -105, { y: 0 });
  place(seaStack(), -70, -110, { y: 0, rot: 0.8 });
  place(seaStack(), 60, 40, { y: 0, rot: 2 });
  for (const [x, z] of [[-30, -18], [36, -16], [14, 22]]) place(rockPile(4, 2), x, z, { y: 0 });

  const rippleMesh = ripples([
    ...pilings,
    [1.7, -26.35], [2.1, -26.2], [1.9, -26.7],
    ...Array.from({ length: 10 }, (_, i) => [LH.x + Math.cos(i * 0.63) * (LH.r + 0.5), LH.z + Math.sin(i * 0.63) * (LH.r + 0.5)]),
  ]);
  dynamic.add(rippleMesh);

  bakeStatic(root, scene);

  // Rods on the rack reflect what the player owns.
  const rackRods = new THREE.Group();
  rods.add(rackRods);
  function setRackRods(owned = ['driftwood']) {
    rackRods.clear();
    // hidden rods (the Beacon, the Wheel Rod) only show up on the rack once you have them
    const shown = RODS.filter((def) => !def.hidden || owned.includes(def.id));
    const step = Math.min(0.28, 1.3 / Math.max(1, shown.length - 1));
    shown.forEach((def, i) => {
      const have = owned.includes(def.id);
      const r = rodMesh(have ? def.color : '#4a3c34', have ? def.tip : '#4a3c34', 1.6);
      r.position.set((i - (shown.length - 1) / 2) * step, 0.3, 0.02); // centred on the rack
      r.rotation.set(-0.12, 0, 0.04);
      rackRods.add(r);
    });
  }
  setRackRods();

  // ---------------------------------------------------------------------------------------------
  // Things you can walk up to and press E on.

  const interactables = [
    { id: 'shop', kind: 'shop', pos: new THREE.Vector3(27.6, DECK_Y, 2.6), title: 'SHOP', hint: '(E) trade', color: '#ffb547', icon: '⚓', radius: 2.8 },
    {
      id: 'rest', kind: 'rest', pos: new THREE.Vector3(22, DECK_Y, 6.0), title: 'REST', hint: '(E) sit', color: '#b98cff', icon: '✦', radius: 2.3,
      sitAt: new THREE.Vector3(22, DECK_Y, 6.1), standAt: new THREE.Vector3(22, DECK_Y, 4.6),
    },
    { id: 'pool', kind: 'pool', pos: new THREE.Vector3(20.6, DECK_Y, -5.9), title: 'REWARD POOL', hint: '(E) cash in', color: '#ffd95c', icon: '◆', radius: 2.4 },
    { id: 'scores', kind: 'scores', pos: inFront(SCOREBOARD, 1.3), title: 'SCORES', hint: '(E) view', color: '#ffd27a', icon: '✦', radius: 2.0, labelY: 3.9 },
    { id: 'wheel', kind: 'wheel', pos: inFront(WHEEL_SPOT, 1.5), title: 'SPIN THE WHEEL', hint: '(E) spin', color: '#ffd34d', icon: '✦', radius: 2.0, labelY: 4.6 },
    ...PORTALS.map((pt) => ({
      id: pt.id, kind: 'portal', pos: inFront(pt, 1.4), title: pt.title, hint: 'coming soon',
      color: pt.color, icon: '◎', radius: 1.8, labelY: 4.6,
    })),
    // no label until you are standing at the log, so it does not float over the lamp posts
    {
      id: 'fireside', kind: 'rest', pos: new THREE.Vector3(FIRE.x - 1.8, DECK_Y, FIRE.z), title: 'CAMPFIRE', hint: '(E) sit by the fire',
      color: '#ff9a3c', icon: '✦', radius: 1.4, labelY: 2.2, secret: true,
      sitAt: new THREE.Vector3(FIRE.x - 1.8, DECK_Y, FIRE.z), standAt: new THREE.Vector3(FIRE.x - 2.9, DECK_Y, FIRE.z - 0.6),
      sitFacing: Math.PI / 2,
      view: { from: new THREE.Vector3(FIRE.x - 4.0, DECK_Y + 2.5, FIRE.z - 3.4), to: new THREE.Vector3(FIRE.x + 0.6, DECK_Y + 1.0, FIRE.z + 2.6) },
    },
    { id: 'rack', kind: 'rack', pos: new THREE.Vector3(4.9, DECK_Y, -6.2), title: 'FISH RACK', hint: '(E) sell', color: '#ffb547', icon: '✦', radius: 2.2 },
    { id: 'rods', kind: 'rods', pos: new THREE.Vector3(7.6, DECK_Y, -6.35), title: 'RODS', hint: '(E) swap', color: '#4fe0cf', icon: '✦', radius: 2.2 },
    // the lighthouse door: no label until you are standing right at it
    { id: 'climb', kind: 'climb', pos: new THREE.Vector3(LH.x, DECK_Y, LH.z + 2.45), title: 'LIGHTHOUSE', hint: '(E) climb the stairs', color: '#ffd27a', icon: '✦', radius: 1.3, secret: true },
    { id: 'down', kind: 'down', level: 'top', pos: new THREE.Vector3(LH.x, TOP_Y, LH.z + 1.22), title: 'STAIRS', hint: '(E) climb down', color: '#ffd27a', icon: '✦', radius: 0.9, labelY: 1.7 },
    { id: 'beacon', kind: 'find', level: 'top', rod: 'beacon', pos: beaconPos.clone(), title: 'BEACON ROD', hint: '(E) take it', color: '#ffe27a', icon: '★', radius: 1.1, labelY: 1.9 },
  ];

  // A spot 'dist' in front of something that faces the campfire.
  function inFront(o, dist) {
    const a = facingFire(o.x, o.z);
    return new THREE.Vector3(o.x + Math.sin(a) * dist, DECK_Y, o.z + Math.cos(a) * dist);
  }

  // Where the stairs leave you at each end: facing along the walkway at the top and out towards
  // the pier at the bottom, so the camera starts outside the tower.
  const stairs = {
    top: { pos: new THREE.Vector3(LH.x, TOP_Y, LH.z + 1.22), facing: -Math.PI / 2 },
    deck: { pos: new THREE.Vector3(LH.x, DECK_Y, LH.z + 2.6), facing: Math.PI / 2 },
  };

  // Walkway around the lamp room, inside the gallery railing: every step is slid back onto it,
  // so walking into the lamp room or the railing carries you around the ring.
  function clampTop(x, z) {
    const dx = x - LH.x, dz = z - LH.z;
    const r = Math.hypot(dx, dz) || 1;
    const k = THREE.MathUtils.clamp(r, 1.08, 1.42) / r;
    return [LH.x + dx * k, LH.z + dz * k];
  }

  // level: 'deck' or 'top'. Things on the other level, the Beacon once found, and secrets you are
  // not standing at are left out.
  function isAvailable(it, level) {
    if ((it.level || 'deck') !== level) return false;
    return !(it.kind === 'find' && beaconFound);
  }
  function labelVisible(it, level, near) {
    return isAvailable(it, level) && (!it.secret || near === it);
  }

  const walk = {
    rects: walkRects,
    circles: [{ x: LH.x, z: LH.z, r: LH.r - 0.35 }, { x: ISLAND.x, z: ISLAND.z, r: ISLAND.r - 0.35 }],
  };

  function isWalkable(x, z) {
    for (const r of walk.rects) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return true;
    return walk.circles.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 <= c.r * c.r);
  }

  // Where the player would stand to fish if they are at the edge of the pier, or null. The spot
  // sits just inside the edge and faces straight out over the water.
  const EDGE_REACH = 0.95;
  function edgeSpot(x, z) {
    let best = null;
    let bestD = EDGE_REACH;
    for (const e of edges) {
      const ex = e.bx - e.ax, ez = e.bz - e.az;
      const t = THREE.MathUtils.clamp(((x - e.ax) * ex + (z - e.az) * ez) / (ex * ex + ez * ez), 0, 1);
      const px = e.ax + ex * t, pz = e.az + ez * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < bestD) { bestD = d; best = { px, pz, nx: e.nx, nz: e.nz }; }
    }
    // round lighthouse platform, except where the walkway joins it (east)
    const dx = x - LH.x, dz = z - LH.z;
    const dc = Math.hypot(dx, dz);
    const towardWalkway = dx > 0 && Math.abs(Math.atan2(dz, dx)) < (24 * Math.PI) / 180;
    if (dc > 0 && dc <= LH.r && LH.r - dc < bestD && !towardWalkway) {
      bestD = LH.r - dc;
      best = { px: LH.x + (dx / dc) * LH.r, pz: LH.z + (dz / dc) * LH.r, nx: dx / dc, nz: dz / dc };
    }
    // the island's shore, except where the boardwalk lands (north)
    const ix = x - ISLAND.x, iz = z - ISLAND.z;
    const di = Math.hypot(ix, iz);
    const towardBoardwalk = iz < 0 && Math.abs(ix) < 2.4;
    if (di > 0 && di <= ISLAND.r && ISLAND.r - di < bestD && !towardBoardwalk) {
      bestD = ISLAND.r - di;
      best = { px: ISLAND.x + (ix / di) * ISLAND.r, pz: ISLAND.z + (iz / di) * ISLAND.r, nx: ix / di, nz: iz / di };
    }
    if (!best) return null;
    return {
      id: 'edge', kind: 'fish', title: 'FISH HERE', hint: '(E) cast a line', color: '#4fe0cf', icon: '✦',
      pos: new THREE.Vector3(best.px - best.nx * 0.4, DECK_Y, best.pz - best.nz * 0.4),
      face: new THREE.Vector3(best.nx, 0, best.nz),
    };
  }

  // True when a bobber can land here: open water, clear of the decks, the lighthouse rocks and
  // the moored boat.
  function isOverWater(x, z) {
    for (const d of DECKS) if (x > d.x0 - 0.8 && x < d.x1 + 0.8 && z > d.z0 - 0.8 && z < d.z1 + 0.8) return false;
    if (Math.hypot(x - LH.x, z - LH.z) < LH.r + 2.5) return false;
    if (Math.hypot(x - ISLAND.x, z - ISLAND.z) < ISLAND.r + 2.5) return false;
    if (Math.hypot(x - boat.position.x, z - boat.position.z) < 2.4) return false;
    return true;
  }

  return {
    interactables,
    colliders,
    camBlockers,
    isWalkable,
    clampTop,
    lighthouse: { x: LH.x, z: LH.z, towerR: 1.8, roofR: 1.15 },
    isAvailable,
    labelVisible,
    stairs,
    setBeaconFound(found) {
      beaconFound = found;
      beaconRod.visible = beaconGlow.visible = !found;
    },
    edgeSpot,
    isOverWater,
    spawn: { pos: new THREE.Vector3(0, DECK_Y, 3.5), yaw: Math.PI },
    npc,
    lights,
    board,
    setRackRods,
    // Spins the 3D prize wheel so it stops on prize `index` (WHEEL.prizes order).
    spinWheel(index, seconds) {
      booth.userData.spinTo(index, seconds);
    },
    update(t, dt) {
      lh.userData.beams.rotation.y = t * 0.45;
      for (const pt of portals) pt.userData.update(t);
      fire.userData.update(t);
      booth.userData.update(t, dt);
      fireLight.intensity = 13 + Math.sin(t * 11) * 1.6 + Math.sin(t * 23 + 1) * 0.9;
      beaconGlow.scale.setScalar(1.3 + Math.sin(t * 3) * 0.35);
      boat.position.y = 0.32 + Math.sin(t * 1.3) * 0.04;
      boat.rotation.z = Math.sin(t * 0.9) * 0.03;
      boat.rotation.x = Math.sin(t * 1.1 + 1) * 0.02;
      rippleMesh.material.uniforms.time.value = t;
      npc.animate(dt, 0, 'fish', Math.sin(t * 0.8) * 0.2);
      for (let i = 0; i < lights.length - 1; i++) {
        lights[i].intensity = 9 + Math.sin(t * 7 + i * 3) * 0.6 + Math.sin(t * 13 + i) * 0.4;
      }
    },
  };
}
