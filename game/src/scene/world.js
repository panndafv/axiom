import * as THREE from 'three';
import {
  mat, box, cyl, barrel, crate, lanternPost, lantern, palmTree, cooler, chest, buoy, bucket, bench,
  pilingBundle, scoreboard, fishRack, rodRack, rodMesh, lighthouse, rockPile, island, seaStack,
} from './props.js';
import { woodTexture, boardTexture } from './textures.js';
import { createCharacter } from './characters.js';
import { createFish } from './fish3d.js';
import { bakeStatic } from './batch.js';
import { SPECIES_BY_ID, RODS } from '../../shared/rules.js';

export const DECK_Y = 2.0;

// Pier layout, top view: x to the east, -z to the north (toward the sunset).
const DECKS = [
  { id: 'main',     x0: -10,   x1: 10,   z0: -7,   z1: 7,    dir: 'z' },
  { id: 'north',    x0: -1.6,  x1: 1.6,  z0: -21,  z1: -7,   dir: 'z' },
  { id: 'northEnd', x0: -4.5,  x1: 4.5,  z0: -26,  z1: -21,  dir: 'x', gaps: { z0: [[-1.1, 1.1]] } },
  { id: 'west',     x0: -17.2, x1: -10,  z0: -5.6, z1: -2.4, dir: 'x', open: ['x0'] },
  { id: 'east',     x0: 10,    x1: 16,   z0: -1.6, z1: 1.6,  dir: 'x' },
  { id: 'eastDeck', x0: 16,    x1: 30,   z0: -7,   z1: 7,    dir: 'z', gaps: { z0: [[25.9, 28.1]] } },
];
const LIGHTHOUSE = { x: -22, z: -4, r: 5, towerR: 2.15 };

const PLANK_COLORS = ['#c98b52', '#b87a45', '#d49a5e', '#c2844b'].map((c) => new THREE.Color(c));

// ---------------------------------------------------------------------------------------------
// Deck geometry

function sideIntervals(deck, side) {
  // Which parts of this side are touching another deck (so get no railing)?
  const horizontal = side === 'z0' || side === 'z1';
  const line = deck[side];
  const [a0, a1] = horizontal ? [deck.x0, deck.x1] : [deck.z0, deck.z1];
  const gaps = [...(deck.gaps?.[side] || [])];
  if (deck.open?.includes(side)) gaps.push([a0, a1]);
  for (const other of DECKS) {
    if (other === deck) continue;
    const [o0, o1] = horizontal ? [other.z0, other.z1] : [other.x0, other.x1];
    if (!(o0 <= line + 0.3 && o1 >= line - 0.3)) continue;
    const [b0, b1] = horizontal ? [other.x0, other.x1] : [other.z0, other.z1];
    const g0 = Math.max(a0, b0), g1 = Math.min(a1, b1);
    if (g1 - g0 > 0.1) gaps.push([g0, g1]);
  }
  gaps.sort((p, q) => p[0] - q[0]);
  // the railed parts are what is left between the gaps
  const railed = [];
  let cur = a0;
  for (const [g0, g1] of gaps) {
    if (g0 - cur > 0.3) railed.push([cur, g0]);
    cur = Math.max(cur, g1);
  }
  if (a1 - cur > 0.3) railed.push([cur, a1]);
  const fullyOpen = railed.length === 0;
  return { railed, fullyOpen };
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

function rope(a, b, sag = 0.32) {
  const mid = a.clone().lerp(b, 0.5);
  mid.y -= sag;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.035, 4), mat('#e3c38a'));
  m.castShadow = true;
  m.userData.static = true;
  return m;
}

function railingRun(root, from, to) {
  const len = from.distanceTo(to);
  const n = Math.max(1, Math.ceil(len / 2.2));
  const posts = [];
  for (let i = 0; i <= n; i++) {
    const p = from.clone().lerp(to, i / n);
    const post = box(0.17, 1.12, 0.17, '#8e5a32');
    post.position.set(p.x, DECK_Y + 0.56, p.z);
    root.add(post);
    posts.push(p);
  }
  const dir = to.clone().sub(from);
  const rail = box(len + 0.2, 0.12, 0.2, '#b77a45');
  rail.position.copy(from).lerp(to, 0.5).setY(DECK_Y + 1.12);
  rail.rotation.y = -Math.atan2(dir.z, dir.x);
  root.add(rail);
  for (let i = 0; i < posts.length - 1; i++) {
    root.add(rope(posts[i].clone().setY(DECK_Y + 0.74), posts[i + 1].clone().setY(DECK_Y + 0.74)));
  }
}

function buildRailings(deck, root) {
  const inset = 0.12;
  const sides = {
    z0: (a) => new THREE.Vector3(a, 0, deck.z0 + inset),
    z1: (a) => new THREE.Vector3(a, 0, deck.z1 - inset),
    x0: (a) => new THREE.Vector3(deck.x0 + inset, 0, a),
    x1: (a) => new THREE.Vector3(deck.x1 - inset, 0, a),
  };
  const result = {};
  for (const side of Object.keys(sides)) {
    const { railed, fullyOpen } = sideIntervals(deck, side);
    result[side] = fullyOpen;
    for (const [a0, a1] of railed) railingRun(root, sides[side](a0), sides[side](a1));
  }
  return result;
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
  for (const deck of DECKS) {
    buildDeck(deck, plankMat, root, pilings);
    const open = buildRailings(deck, root);
    // Walkable area: pulled in from railed sides, pushed out over open sides so it overlaps the
    // neighbouring deck and the player can walk across.
    walkRects.push({
      x0: deck.x0 + (open.x0 ? -0.6 : 0.45),
      x1: deck.x1 - (open.x1 ? -0.6 : 0.45),
      z0: deck.z0 + (open.z0 ? -0.6 : 0.45),
      z1: deck.z1 - (open.z1 ? -0.6 : 0.45),
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
  // ring railing, open toward the walkway (east)
  const ringPosts = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const deg = Math.abs(((a * 180) / Math.PI + 180) % 360 - 180);
    if (deg < 22) continue;
    ringPosts.push(new THREE.Vector3(LH.x + Math.cos(a) * (LH.r - 0.2), 0, LH.z + Math.sin(a) * (LH.r - 0.2)));
  }
  for (let i = 0; i < ringPosts.length; i++) {
    const p = ringPosts[i];
    const post = box(0.17, 1.12, 0.17, '#8e5a32');
    post.position.set(p.x, DECK_Y + 0.56, p.z);
    root.add(post);
    const q = ringPosts[i + 1];
    if (q && p.distanceTo(q) < 1.5) {
      root.add(rope(p.clone().setY(DECK_Y + 0.74), q.clone().setY(DECK_Y + 0.74), 0.18));
      const rail = box(p.distanceTo(q) + 0.15, 0.12, 0.2, '#b77a45');
      const dir = q.clone().sub(p);
      rail.position.copy(p).lerp(q, 0.5).setY(DECK_Y + 1.12);
      rail.rotation.y = -Math.atan2(dir.z, dir.x);
      root.add(rail);
    }
  }

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

  // main deck clutter
  place(barrel(), -8.3, 5.5, { r: 0.55 });
  place(barrel('#a85a2a'), -7.3, 6.0, { rot: 0.4, r: 0.55 });
  place(crate(), -8.6, 4.2, { rot: 0.2, r: 0.65 });
  place(crate(0.7), -8.6, 4.2, { rot: 0.7, y: DECK_Y + 0.9 });
  place(bucket(), -6.6, 6.0, { r: 0.35 });
  place(buoy(), 9.0, 6.1, { r: 0.45 });
  place(crate(0.8, '#e0ae76'), 8.8, -4.6, { rot: 0.5, r: 0.6 });
  place(barrel(), -8.9, -5.6, { r: 0.55 });
  const floorLamp = place(lantern(), -2.1, 4.8, {});
  floorLamp.scale.setScalar(1.2);

  // board, rack and rods along the main deck's north rail
  const board = boardTexture();
  place(scoreboard(board.texture), 4.0, -6.35, { r: 0.9 });
  const rackFish = ['bag_bass', 'candle_snapper', 'dock_sardine'].map((id) => createFish(SPECIES_BY_ID[id]));
  place(fishRack(rackFish), 6.6, -6.2, { r: 0.9 });
  const rods = place(rodRack(), 8.9, -6.35, { r: 0.8 });

  // north jetty
  const bundle = place(pilingBundle(), 1.7, -26.35, {});
  bundle.position.y = DECK_Y;
  place(bucket(), -2.6, -24.9, { r: 0.35 });
  place(barrel(), 3.3, -23.4, { r: 0.55 });
  place(lantern(), -1.3, -25.6, {}).scale.setScalar(1.2);

  // east deck: shop, rest, palm corner, reward chest
  const sandMound = cyl(1.3, 1.6, 0.25, 9, '#e6c98f');
  place(sandMound, 18.4, -4.9, {});
  sandMound.position.y = DECK_Y + 0.1;
  place(palmTree(4.2), 18.4, -4.9, { y: DECK_Y + 0.2, r: 0.5 });
  place(cooler(), 17.6, -2.9, { rot: 0.3, r: 0.6 });
  place(chest(), 20.6, -5.9, { rot: -0.15, r: 0.75 });
  place(buoy(), 16.9, 5.9, { r: 0.45 });
  place(bench(), 22.0, 6.15, { rot: Math.PI, r: 0.9 });
  place(barrel(), 27.1, 1.0, { r: 0.55 });
  place(barrel('#c86f35'), 28.6, 1.4, { rot: 1, r: 0.55 });
  place(crate(), 28.4, 3.9, { rot: 0.1, r: 0.65 });
  place(crate(0.6, '#e0ae76'), 26.4, 4.6, { rot: 0.6, r: 0.5 });
  place(bucket(), 25.6, -5.9, { r: 0.35 });

  const npc = createCharacter({ shirt: '#e8b931', pants: '#5a3a22', hair: '#3b2a20', hat: '#b8433a', rod: RODS[1] });
  npc.root.position.set(27.6, DECK_Y, 2.6);
  npc.root.rotation.y = -Math.PI / 2;
  npc.rodInHand();
  dynamic.add(npc.root);
  colliders.push({ x: 27.6, z: 2.6, r: 0.55 });

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
    RODS.forEach((def, i) => {
      const have = owned.includes(def.id);
      const r = rodMesh(have ? def.color : '#4a3c34', have ? def.tip : '#4a3c34', 1.6);
      r.position.set(-0.56 + i * 0.28, 0.3, 0.02);
      r.rotation.set(-0.12, 0, 0.04);
      rackRods.add(r);
    });
  }
  setRackRods();

  // ---------------------------------------------------------------------------------------------
  // Things you can walk up to and press E on.

  const fishSpot = (id, x, z, fx, fz) => ({
    id, kind: 'fish', pos: new THREE.Vector3(x, DECK_Y, z), face: new THREE.Vector3(fx, 0, fz).normalize(),
    title: 'FISHING SPOT', hint: '(E) cast a line', color: '#4fe0cf', icon: '✦', radius: 2.6,
  });
  const lhSpotDir = new THREE.Vector3(-0.6, 0, -0.8);
  const interactables = [
    fishSpot('north', 0, -25.25, 0, -1),
    fishSpot('lighthouse', LH.x + lhSpotDir.x * 3.9, LH.z + lhSpotDir.z * 3.9, lhSpotDir.x, lhSpotDir.z),
    fishSpot('east', 27, -6.25, 0, -1),
    { id: 'shop', kind: 'shop', pos: new THREE.Vector3(27.6, DECK_Y, 2.6), title: 'SHOP', hint: '(E) trade', color: '#ffb547', icon: '⚓', radius: 2.8 },
    { id: 'rest', kind: 'rest', pos: new THREE.Vector3(22, DECK_Y, 6.0), title: 'REST', hint: '(E) sit', color: '#b98cff', icon: '✦', radius: 2.3 },
    { id: 'pool', kind: 'pool', pos: new THREE.Vector3(20.6, DECK_Y, -5.9), title: 'REWARD POOL', hint: '(E) cash in', color: '#ffd95c', icon: '◆', radius: 2.4 },
    { id: 'scores', kind: 'scores', pos: new THREE.Vector3(4.0, DECK_Y + 0.6, -6.35), title: 'SCORES', hint: '(E) view', color: '#ffd27a', icon: '✦', radius: 2.4 },
    { id: 'rack', kind: 'rack', pos: new THREE.Vector3(6.6, DECK_Y, -6.2), title: 'FISH RACK', hint: '(E) sell', color: '#ffb547', icon: '✦', radius: 2.2 },
    { id: 'rods', kind: 'rods', pos: new THREE.Vector3(8.9, DECK_Y, -6.35), title: 'RODS', hint: '(E) swap', color: '#4fe0cf', icon: '✦', radius: 2.2 },
  ];

  const walk = { rects: walkRects, circle: { x: LH.x, z: LH.z, r: LH.r - 0.55 } };

  function isWalkable(x, z) {
    for (const r of walk.rects) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return true;
    const c = walk.circle;
    return (x - c.x) ** 2 + (z - c.z) ** 2 <= c.r * c.r;
  }

  return {
    interactables,
    colliders,
    isWalkable,
    spawn: { pos: new THREE.Vector3(0, DECK_Y, 3.5), yaw: Math.PI },
    npc,
    lights,
    board,
    setRackRods,
    update(t, dt) {
      lh.userData.beams.rotation.y = t * 0.45;
      rippleMesh.material.uniforms.time.value = t;
      npc.animate(dt, 0, 'fish', Math.sin(t * 0.8) * 0.2);
      for (let i = 0; i < lights.length - 1; i++) {
        lights[i].intensity = 9 + Math.sin(t * 7 + i * 3) * 0.6 + Math.sin(t * 13 + i) * 0.4;
      }
    },
  };
}
