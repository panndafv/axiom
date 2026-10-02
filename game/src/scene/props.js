import * as THREE from 'three';
import { glowTexture } from './textures.js';
import { paintedGeometry, paintedMaterial } from './merge.js';

// Low-poly props built from primitives. Every builder returns a THREE.Group positioned at the
// origin, standing on y = 0. Meshes marked userData.static get merged later (see batch.js).

const materials = new Map();

export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!materials.has(key)) {
    materials.set(key, new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.85,
      metalness: opts.metal ?? 0,
      flatShading: opts.flat ?? true,
      emissive: opts.emissive ?? '#000000',
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      transparent: !!opts.transparent,
      opacity: opts.opacity ?? 1,
      map: opts.map ?? null,
      vertexColors: !!opts.vertexColors,
    }));
  }
  return materials.get(key);
}

function mesh(geo, material, { cast = true, receive = true, isStatic = true } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  m.userData.static = isStatic;
  return m;
}

export function box(w, h, d, color, opts) {
  return mesh(new THREE.BoxGeometry(w, h, d), typeof color === 'string' ? mat(color, opts) : color);
}

export function cyl(rTop, rBottom, h, seg, color, opts) {
  return mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), typeof color === 'string' ? mat(color, opts) : color);
}

const glowTex = { warm: null, cool: null };
export function glowSprite(color = 'warm', size = 1.6) {
  if (!glowTex[color]) {
    glowTex[color] = color === 'warm'
      ? glowTexture('rgba(255,196,110,0.9)', 'rgba(255,160,60,0)')
      : glowTexture('rgba(150,255,240,0.9)', 'rgba(80,240,220,0)');
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex[color], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  s.scale.setScalar(size);
  return s;
}

// ---------------------------------------------------------------------------------------------

export function barrel(color = '#b8622c') {
  const g = new THREE.Group();
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const y = (i / 8) * 1.1;
    const bulge = Math.sin((i / 8) * Math.PI);
    pts.push(new THREE.Vector2(0.38 + bulge * 0.08, y));
  }
  pts.unshift(new THREE.Vector2(0, 0));
  pts.push(new THREE.Vector2(0, 1.1));
  const body = mesh(new THREE.LatheGeometry(pts, 12), mat(color));
  g.add(body);
  for (const y of [0.18, 0.92]) {
    const band = cyl(0.43, 0.43, 0.07, 12, '#3a2a24');
    band.position.y = y;
    g.add(band);
  }
  const lid = cyl(0.36, 0.36, 0.03, 12, '#8a4a22');
  lid.position.y = 1.1;
  g.add(lid);
  return g;
}

export function crate(size = 0.9, color = '#d9a46a') {
  const g = new THREE.Group();
  const core = box(size * 0.94, size * 0.94, size * 0.94, color);
  core.position.y = size / 2;
  g.add(core);
  const t = size * 0.1;
  const dark = '#a8733f';
  // frame edges
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const post = box(t, size, t, dark);
    post.position.set(sx * (size / 2 - t / 2), size / 2, sz * (size / 2 - t / 2));
    g.add(post);
  }
  for (const y of [t / 2, size - t / 2]) {
    for (const sz of [-1, 1]) {
      const bar = box(size, t, t, dark);
      bar.position.set(0, y, sz * (size / 2 - t / 2));
      g.add(bar);
    }
    for (const sx of [-1, 1]) {
      const bar = box(t, t, size, dark);
      bar.position.set(sx * (size / 2 - t / 2), y, 0);
      g.add(bar);
    }
  }
  return g;
}

// A lantern hanging from the top of a post. Returns the group; userData.lampY is the light height.
export function lanternPost(height = 2.6) {
  const g = new THREE.Group();
  const post = box(0.22, height, 0.22, '#8a5730');
  post.position.y = height / 2;
  g.add(post);
  const arm = box(0.5, 0.08, 0.08, '#6b4225');
  arm.position.set(0.22, height - 0.12, 0);
  g.add(arm);
  const lamp = lantern();
  lamp.position.set(0.42, height - 0.62, 0);
  g.add(lamp);
  g.userData.lamp = new THREE.Vector3(0.42, height - 0.42, 0);
  return g;
}

export function lantern() {
  const g = new THREE.Group();
  const glass = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.32, 8), mat('#ffd58a', { emissive: '#ffb347', emissiveIntensity: 3.2, flat: false }), { cast: false });
  glass.position.y = 0.22;
  const capT = cyl(0.04, 0.17, 0.12, 8, '#3a2a22');
  capT.position.y = 0.43;
  const capB = cyl(0.16, 0.14, 0.06, 8, '#3a2a22');
  capB.position.y = 0.04;
  const ring = cyl(0.03, 0.03, 0.1, 6, '#3a2a22');
  ring.position.y = 0.52;
  g.add(glass, capT, capB, ring);
  const glow = glowSprite('warm', 1.15);
  glow.position.y = 0.22;
  g.add(glow);
  return g;
}

export function palmTree(height = 4.2) {
  const g = new THREE.Group();
  const segs = 7;
  let x = 0, y = 0;
  const lean = 0.09;
  for (let i = 0; i < segs; i++) {
    const h = height / segs;
    const r0 = 0.2 - i * 0.012;
    const seg = cyl(r0 - 0.02, r0, h * 1.05, 7, i % 2 ? '#8a5a35' : '#7a4c2c');
    seg.position.set(x, y + h / 2, 0);
    seg.rotation.z = -lean * (i / segs) * 2;
    g.add(seg);
    x += Math.sin(lean * (i / segs) * 2) * h;
    y += h;
  }
  const top = new THREE.Vector3(x, y, 0);
  const leafColors = ['#c9b13a', '#b39d2e', '#d8c24a'];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const leaf = palmLeaf(leafColors[i % 3]);
    leaf.position.copy(top);
    leaf.rotation.y = a;
    g.add(leaf);
  }
  for (let i = 0; i < 3; i++) {
    const nut = mesh(new THREE.IcosahedronGeometry(0.13, 0), mat('#5a3a22'));
    nut.position.set(top.x + Math.cos(i * 2.1) * 0.18, top.y - 0.15, Math.sin(i * 2.1) * 0.18);
    g.add(nut);
  }
  return g;
}

function palmLeaf(color) {
  // a drooping strip of triangles
  const len = 2.1, w = 0.42, n = 5;
  const verts = [];
  const point = (t, side) => {
    const x = t * len;
    const y = -Math.pow(t, 1.8) * 1.1 + t * 0.35;
    const half = w * Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.5;
    return [x, y, side * half];
  };
  for (let i = 0; i < n; i++) {
    const a = i / n, b = (i + 1) / n;
    const pa = point(a, 0), pb = point(b, 0);
    for (const side of [-1, 1]) {
      verts.push(...pa, ...point(b, side), ...pb);
      verts.push(...pa, ...point(a, side), ...point(b, side));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  // a touch of emissive so backlit leaves stay yellow-green instead of going brown
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, flatShading: true, roughness: 0.9, emissive: color, emissiveIntensity: 0.18 }));
  m.castShadow = true;
  m.userData.static = true;
  const g = new THREE.Group();
  g.add(m);
  return g;
}

export function cooler() {
  const g = new THREE.Group();
  const body = box(0.95, 0.5, 0.6, '#dcedf5');
  body.position.y = 0.25;
  const lid = box(1.0, 0.14, 0.64, '#7fb4d4');
  lid.position.y = 0.57;
  const handle = box(0.5, 0.06, 0.08, '#e8f4fa');
  handle.position.y = 0.68;
  g.add(body, lid, handle);
  return g;
}

export function chest() {
  const g = new THREE.Group();
  const body = box(1.1, 0.55, 0.7, '#7a4826');
  body.position.y = 0.28;
  const lidGeo = new THREE.CylinderGeometry(0.35, 0.35, 1.1, 10, 1, false, 0, Math.PI);
  lidGeo.rotateZ(Math.PI / 2);
  lidGeo.rotateX(Math.PI / 2);
  const lid = mesh(lidGeo, mat('#8a5530'));
  lid.position.y = 0.55;
  g.add(body, lid);
  for (const x of [-0.42, 0, 0.42]) {
    const band = box(0.08, 0.57, 0.72, '#e9b949', { metal: 0.6, rough: 0.4 });
    band.position.set(x, 0.28, 0);
    const lidBand = mesh(new THREE.TorusGeometry(0.355, 0.03, 4, 10, Math.PI), mat('#e9b949', { metal: 0.6, rough: 0.4 }));
    lidBand.rotation.y = Math.PI / 2;
    lidBand.position.set(x, 0.55, 0);
    g.add(band, lidBand);
  }
  const lock = box(0.16, 0.18, 0.06, '#ffd95c', { emissive: '#ffb020', emissiveIntensity: 0.6 });
  lock.position.set(0, 0.5, 0.37);
  g.add(lock);
  return g;
}

export function buoy() {
  const g = new THREE.Group();
  const top = mesh(new THREE.SphereGeometry(0.42, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat('#d6353c'));
  const bottom = mesh(new THREE.SphereGeometry(0.42, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat('#f4f1ea'));
  const band = cyl(0.43, 0.43, 0.1, 10, '#f4f1ea');
  top.position.y = bottom.position.y = band.position.y = 0.4;
  g.add(top, bottom, band);
  return g;
}

export function bucket(withFish = true) {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.3, 0.24, 0.5, 10, 1, true);
  const body = mesh(geo, new THREE.MeshStandardMaterial({ color: '#d0743a', side: THREE.DoubleSide, flatShading: true, roughness: 0.8 }));
  body.position.y = 0.25;
  const bottom = cyl(0.24, 0.24, 0.03, 10, '#a85a2a');
  bottom.position.y = 0.02;
  const water = cyl(0.27, 0.27, 0.02, 10, '#cfe5ee');
  water.position.y = 0.4;
  const handle = mesh(new THREE.TorusGeometry(0.3, 0.015, 4, 12, Math.PI), mat('#b9b0a0'));
  handle.position.y = 0.5;
  handle.rotation.z = 0.3;
  for (const y of [0.12, 0.42]) {
    const band = cyl(0.3 - (0.42 - y) * 0.1, 0.3 - (0.42 - y) * 0.1, 0.04, 10, '#9a5a2a');
    band.position.y = y;
    g.add(band);
  }
  g.add(body, bottom, water, handle);
  if (withFish) {
    const tail = mesh(new THREE.ConeGeometry(0.08, 0.2, 4), mat('#ff9a5a'));
    tail.position.set(0.05, 0.5, 0.02);
    tail.rotation.z = 0.5;
    g.add(tail);
  }
  return g;
}

// Small rowboat, ~3.2 m long, bow and stern pinched to a point. Origin at the waterline.
export function rowboat(color = '#2f7f86') {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.72, 0.72, 3.2, 14, 6, true, Math.PI, Math.PI);
  geo.rotateZ(Math.PI / 2); // axis along x, open side up
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const k = Math.abs(x) / 1.6;
    pos.setZ(i, pos.getZ(i) * (1 - Math.pow(k, 2.5) * 0.92));
    pos.setY(i, pos.getY(i) * 0.75 + k * k * 0.18);
  }
  geo.computeVertexNormals();
  const hull = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, flatShading: true, roughness: 0.8 }));
  hull.castShadow = true;
  g.add(hull);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 4, 24), mat('#e9e2d4'));
  rim.rotation.x = Math.PI / 2;
  rim.scale.set(1.6, 0.66, 1);
  rim.position.y = 0.02;
  g.add(rim);
  for (const x of [-0.55, 0.55]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 1.15 - Math.abs(x) * 0.25), mat('#a8743f'));
    seat.position.set(x, -0.12, 0);
    seat.castShadow = true;
    g.add(seat);
  }
  for (const s of [-1, 1]) {
    const oar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.2, 5), mat('#c9965a'));
    oar.rotation.z = Math.PI / 2 - 0.08;
    oar.rotation.y = s * 0.12;
    oar.position.set(0.1, 0.0, s * 0.22);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.02, 0.14), mat('#c9965a'));
    blade.position.set(1.15, 0.06, s * 0.33);
    g.add(oar, blade);
  }
  return g;
}

export function bench() {
  const g = new THREE.Group();
  const seat = box(2.2, 0.12, 0.6, '#b0743f');
  seat.position.y = 0.55;
  const back = box(2.2, 0.5, 0.1, '#a3683a');
  back.position.set(0, 0.95, -0.27);
  back.rotation.x = -0.12;
  g.add(seat, back);
  for (const x of [-0.95, 0.95]) {
    const leg = box(0.12, 0.55, 0.5, '#7a4a28');
    leg.position.set(x, 0.27, 0);
    g.add(leg);
  }
  return g;
}

// Bundle of three tall pilings tied with rope, like the mooring posts at the jetty ends.
export function pilingBundle() {
  const g = new THREE.Group();
  const posts = [[0, 0, 4.4], [0.42, 0.12, 3.9], [0.2, -0.36, 4.1]];
  for (const [x, z, h] of posts) {
    const p = cyl(0.24, 0.27, h, 7, '#6e4a33');
    p.position.set(x, h / 2 - 2.2, z);
    g.add(p);
    const cap = cyl(0.2, 0.24, 0.12, 7, '#7d5a40');
    cap.position.set(x, h - 2.2 + 0.03, z);
    g.add(cap);
  }
  const rope = mesh(new THREE.TorusGeometry(0.55, 0.09, 5, 10), mat('#b99766'));
  rope.rotation.x = Math.PI / 2;
  rope.position.set(0.2, 1.5, -0.08);
  g.add(rope);
  return g;
}

export function scoreboard(texture) {
  const g = new THREE.Group();
  for (const x of [-0.7, 0.7]) {
    const post = box(0.14, 2.6, 0.14, '#6b4225');
    post.position.set(x, 1.3, 0);
    g.add(post);
  }
  const frame = box(1.6, 1.95, 0.12, '#5a3a22');
  frame.position.y = 1.7;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 1.78), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  face.position.set(0, 1.7, 0.065);
  const roof = box(1.85, 0.1, 0.4, '#6b4225');
  roof.position.set(0, 2.7, 0.06);
  g.add(frame, face, roof);
  return g;
}

// A-frame drying rack with a few fish hanging from the bar.
export function fishRack(fishMeshes = []) {
  const g = new THREE.Group();
  for (const x of [-0.9, 0.9]) {
    for (const s of [-1, 1]) {
      const leg = box(0.08, 1.7, 0.08, '#9a6a3a');
      leg.position.set(x, 0.8, s * 0.32);
      leg.rotation.x = s * 0.38;
      g.add(leg);
    }
  }
  const bar = box(2.0, 0.08, 0.08, '#8a5a30');
  bar.position.y = 1.55;
  g.add(bar);
  fishMeshes.forEach((f, i) => {
    f.position.set(-0.6 + i * 0.6, 1.15, 0);
    f.rotation.z = Math.PI / 2;
    f.scale.setScalar(0.5);
    g.add(f);
    const line = box(0.015, 0.25, 0.015, '#e3d6b8');
    line.position.set(-0.6 + i * 0.6, 1.43, 0);
    g.add(line);
  });
  return g;
}

export function rodRack() {
  const g = new THREE.Group();
  const base = box(1.5, 0.35, 0.45, '#9a6538');
  base.position.y = 0.17;
  const rail = box(1.5, 0.08, 0.12, '#7a4a28');
  rail.position.set(0, 1.4, -0.12);
  g.add(base, rail);
  for (const x of [-0.7, 0.7]) {
    const post = box(0.1, 1.45, 0.1, '#7a4a28');
    post.position.set(x, 0.72, -0.12);
    g.add(post);
  }
  // the rods themselves are added by the world so they can show what the player owns
  return g;
}

// One painted mesh for shaft, grip and reel, plus a small glowing tip.
export function rodMesh(color = '#9a6a3c', tip = '#ff6a3d', length = 1.9) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(paintedGeometry([
    { geo: new THREE.CylinderGeometry(0.018, 0.04, length, 6), color, pos: [0, length / 2, 0] },
    { geo: new THREE.CylinderGeometry(0.05, 0.05, 0.38, 6), color: '#3b2a22', pos: [0, 0.19, 0] },
    { geo: new THREE.CylinderGeometry(0.08, 0.08, 0.06, 8), color: '#c9ccd2', pos: [0.07, 0.45, 0], rot: [0, 0, Math.PI / 2] },
  ]), paintedMaterial);
  body.castShadow = true;
  const tipBall = mesh(new THREE.SphereGeometry(0.035, 6, 4), mat(tip, { emissive: tip, emissiveIntensity: 0.4 }), { isStatic: false });
  tipBall.position.y = length;
  g.add(body, tipBall);
  g.userData.tip = new THREE.Vector3(0, length, 0);
  return g;
}

export function lighthouse() {
  const g = new THREE.Group();
  const white = '#f1eee6', orange = '#e2733a';
  const H = 11;
  const bands = 7;
  for (let i = 0; i < bands; i++) {
    const y0 = (i / bands) * H, y1 = ((i + 1) / bands) * H;
    const r0 = 1.75 - (y0 / H) * 0.65, r1 = 1.75 - (y1 / H) * 0.65;
    const seg = cyl(r1, r0, y1 - y0, 14, i % 2 ? orange : white);
    seg.position.y = (y0 + y1) / 2;
    g.add(seg);
  }
  const door = box(0.7, 1.3, 0.2, '#5a3326');
  door.position.set(0, 0.65, 1.72);
  g.add(door);
  for (const y of [3.4, 6.6]) {
    const win = box(0.35, 0.55, 0.2, '#ffd58a', { emissive: '#ffb347', emissiveIntensity: 1.2 });
    win.position.set(0, y, 1.75 - (y / H) * 0.65);
    g.add(win);
  }
  const gallery = cyl(1.65, 1.5, 0.28, 14, '#5a3a2a');
  gallery.position.y = H + 0.14;
  g.add(gallery);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const bar = box(0.06, 0.55, 0.06, '#3a2a22');
    bar.position.set(Math.cos(a) * 1.55, H + 0.55, Math.sin(a) * 1.55);
    g.add(bar);
  }
  const railRing = mesh(new THREE.TorusGeometry(1.55, 0.04, 4, 20), mat('#3a2a22'));
  railRing.rotation.x = Math.PI / 2;
  railRing.position.y = H + 0.82;
  g.add(railRing);
  const glass = mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.3, 10), mat('#fff0b0', { emissive: '#ffcf6a', emissiveIntensity: 3.5 }), { cast: false });
  glass.position.y = H + 0.95;
  g.add(glass);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const mullion = box(0.08, 1.3, 0.08, '#3a2a22');
    mullion.position.set(Math.cos(a) * 0.86, H + 0.95, Math.sin(a) * 0.86);
    g.add(mullion);
  }
  const roof = mesh(new THREE.ConeGeometry(1.15, 1.1, 10), mat('#5a3326'));
  roof.position.y = H + 2.15;
  const finial = mesh(new THREE.SphereGeometry(0.16, 6, 4), mat('#e9b949', { metal: 0.5 }));
  finial.position.y = H + 2.8;
  g.add(roof, finial);
  const halo = glowSprite('warm', 7);
  halo.position.y = H + 0.95;
  g.add(halo);

  // Two opposite light beams that sweep around.
  const beams = new THREE.Group();
  beams.position.y = H + 0.95;
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { color: { value: new THREE.Color('#ffe2a8') } },
    vertexShader: /* glsl */`
      varying float vT; varying vec3 vN; varying vec3 vV;
      void main() {
        vT = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 color; varying float vT; varying vec3 vN; varying vec3 vV;
      void main() {
        float edge = pow(abs(dot(vN, vV)), 1.6);
        float a = pow(vT, 1.6) * edge * 0.6;
        gl_FragColor = vec4(color * a, a);
      }`,
  });
  for (const dir of [1, -1]) {
    const geo = new THREE.ConeGeometry(4.5, 48, 20, 1, true);
    geo.translate(0, -24, 0); // apex at the lamp
    const beam = new THREE.Mesh(geo, beamMat);
    beam.rotation.z = dir * (Math.PI / 2 - 0.3); // tilted up so it sweeps across the dark sky
    beam.frustumCulled = false;
    beams.add(beam);
  }
  g.add(beams);
  g.userData.beams = beams;
  g.userData.lampY = H + 0.95;
  return g;
}

function displacedRock(radius, color, detail = 0) {
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geo.attributes.position;
  // Faces don't share vertices, so the bump must come from the position itself; a random number
  // per vertex would pull each triangle's corners apart into shards.
  const seed = Math.random() * 100;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed) * 43758.5453;
    const k = 0.8 + (n - Math.floor(n)) * 0.35;
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  geo.computeVertexNormals();
  return mesh(geo, mat(color));
}

export function rockPile(n = 6, spread = 3, color = '#77695e') {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const r = 0.8 + Math.random() * 1.2;
    const rock = displacedRock(r, i % 2 ? color : '#6a5d53');
    const a = Math.random() * Math.PI * 2;
    rock.position.set(Math.cos(a) * spread * Math.random(), r * 0.3 - 0.4, Math.sin(a) * spread * Math.random());
    g.add(rock);
  }
  return g;
}

export function island(radius = 9, withPalm = true) {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(radius * 0.55, radius, 3, 12, 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 1.4) pos.setY(i, 1.5 + Math.random() * 1.3);
  }
  geo.computeVertexNormals();
  const sand = mesh(geo, mat('#e6c48c'));
  sand.position.y = 0.2;
  g.add(sand);
  if (withPalm) {
    const p = palmTree(5);
    p.position.y = 2.3;
    g.add(p);
  }
  return g;
}

export function seaStack() {
  const g = new THREE.Group();
  let y = -1;
  const colors = ['#8a6248', '#7a5640', '#9a6e52'];
  for (let i = 0; i < 4; i++) {
    const w = 3.2 - i * 0.5, h = 2 + Math.random() * 1.5;
    const b = box(w, h, w * 0.85, colors[i % 3]);
    b.position.set((Math.random() - 0.5) * 0.6, y + h / 2, (Math.random() - 0.5) * 0.6);
    b.rotation.y = Math.random() * 0.6;
    g.add(b);
    y += h;
  }
  return g;
}

// ---------------------------------------------------------------------------------------------
// Portal to an area that is not open yet: a little wooden hut with a pitched roof, a swirling
// doorway in the portal's own colour, a COMING SOON sign over the door, lanterns on the posts and
// a motif on the ridge ('egg' or 'starfish'). group.userData.update(t) animates it.

function signTexture(name, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 80;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const draw = () => {
    g.fillStyle = '#7a4c2a';
    g.fillRect(0, 0, 256, 80);
    g.fillStyle = '#8f5a32';
    for (let y = 6; y < 80; y += 18) g.fillRect(0, y, 256, 8);
    g.strokeStyle = '#4a2c18';
    g.lineWidth = 6;
    g.strokeRect(3, 3, 250, 74);
    g.textAlign = 'center';
    g.font = '34px "Lilita One", "Arial Black", sans-serif';
    g.lineWidth = 5;
    g.strokeStyle = '#2a1810';
    g.strokeText(name, 128, 40);
    g.fillStyle = color;
    g.fillText(name, 128, 40);
    g.font = '15px "Pixelify Sans", monospace';
    g.fillStyle = '#fff1dc';
    g.fillText('COMING SOON', 128, 64);
    tex.needsUpdate = true;
  };
  draw();
  document.fonts?.ready.then(draw); // the web fonts may load after the pier is built
  return tex;
}

export function portal(color, name, motif = 'egg', roofColor = '#7d5232') {
  const g = new THREE.Group();
  const wood = '#8a5a32', woodDark = '#5e3b22', base = 0.16, top = 2.55, w = 0.74;

  // plank floor
  const floor = box(2.8, base, 1.7, '#a8743f');
  floor.position.y = base / 2;
  g.add(floor);
  for (const x of [-0.93, -0.31, 0.31, 0.93]) {
    const seam = box(0.03, 0.02, 1.7, '#7a5230');
    seam.position.set(x, base + 0.005, 0);
    g.add(seam);
  }
  // posts, a back wall behind the doorway and a beam across the top
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const post = box(0.2, top, 0.2, wood);
      post.position.set(sx * 1.2, base + top / 2, sz * 0.62);
      g.add(post);
    }
    const side = box(0.08, top * 0.45, 1.24, woodDark);
    side.position.set(sx * 1.2, base + top * 0.22, 0);
    g.add(side);
  }
  const back = box(2.3, top, 0.1, woodDark);
  back.position.set(0, base + top / 2, -0.6);
  g.add(back);
  for (const z of [-0.62, 0.62]) {
    const beam = box(2.6, 0.18, 0.2, wood);
    beam.position.set(0, base + top, z);
    g.add(beam);
  }
  // pitched roof: two sloping slabs and a ridge cap, overhanging all round
  const slope = 0.52;
  const shingle = `#${new THREE.Color(roofColor).multiplyScalar(0.75).getHexString()}`;
  for (const sx of [-1, 1]) {
    const slab = box(1.62, 0.12, 2.0, roofColor);
    slab.position.set(sx * 0.7, base + top + 0.52, 0);
    slab.rotation.z = -sx * slope;
    g.add(slab);
    for (const t of [0.3, 0.62]) { // darker shingle lines across the slab, down from the ridge
      const row = box(0.08, 0.035, 2.02, shingle);
      row.position.set(sx * t * 1.4, base + top + 0.92 - t * 0.8 + 0.07, 0);
      row.rotation.z = -sx * slope;
      g.add(row);
    }
  }
  const ridge = box(0.18, 0.16, 2.06, woodDark);
  ridge.position.y = base + top + 0.95;
  g.add(ridge);

  // the swirling doorway (position-based shader, so no uv fiddling)
  const doorTop = top - 0.55;
  const shape = new THREE.Shape();
  shape.moveTo(-w, base);
  shape.lineTo(w, base);
  shape.lineTo(w, doorTop);
  shape.absarc(0, doorTop, w, 0, Math.PI, false);
  shape.lineTo(-w, base);
  const swirl = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    uniforms: { time: { value: 0 }, color: { value: new THREE.Color(color) } },
    vertexShader: /* glsl */`
      varying vec2 vP;
      void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float time; uniform vec3 color; varying vec2 vP;
      void main() {
        vec2 p = vP - vec2(0.0, 1.3);
        float r = length(p * vec2(1.0, 0.72));
        float a = atan(p.y, p.x);
        float s1 = sin(a * 3.0 + r * 10.0 - time * 2.6) * 0.5 + 0.5;
        float s2 = sin(a * 5.0 - r * 7.0 + time * 1.8) * 0.5 + 0.5;
        float core = smoothstep(1.2, 0.0, r);
        vec3 c = mix(color * 0.35, color * 1.4, s1 * 0.6 + s2 * 0.3) + vec3(core * 0.2);
        gl_FragColor = vec4(c, 0.95);
      }`,
  });
  const door = mesh(new THREE.ShapeGeometry(shape, 16), swirl, { cast: false, receive: false, isStatic: false });
  door.position.z = -0.52;
  g.add(door);
  // a wooden frame round the doorway
  for (const sx of [-1, 1]) {
    const jamb = box(0.12, doorTop - base, 0.14, wood);
    jamb.position.set(sx * (w + 0.06), base + (doorTop - base) / 2, -0.5);
    g.add(jamb);
  }

  // sign over the door
  const sign = mesh(new THREE.PlaneGeometry(1.7, 0.53),
    new THREE.MeshBasicMaterial({ map: signTexture(name, color), toneMapped: false }),
    { cast: false, isStatic: false });
  sign.position.set(0, base + top + 0.12, 0.74);
  g.add(sign);

  // lanterns hanging under the eaves
  for (const sx of [-1, 1]) {
    const hook = box(0.03, 0.22, 0.03, '#3a2a22');
    hook.position.set(sx * 1.38, base + top - 0.1, 0.62);
    g.add(hook);
    const l = lantern();
    l.scale.setScalar(0.7);
    l.position.set(sx * 1.38, base + top - 0.62, 0.62);
    g.add(l);
  }

  // on the ridge: a speckled egg, or a starfish
  const ridgeY = base + top + 1.03;
  if (motif === 'egg') {
    const egg = mesh(new THREE.SphereGeometry(0.2, 9, 7), mat('#f6ead2'));
    egg.scale.set(1, 1.3, 1);
    egg.position.set(0, ridgeY + 0.26, 0.6);
    g.add(egg);
    for (const [x, y, z] of [[0.12, 0.08, 0.13], [-0.1, -0.04, 0.15], [0.04, 0.2, 0.15], [-0.15, 0.14, 0.05]]) {
      const dot = mesh(new THREE.SphereGeometry(0.035, 5, 4), mat(color));
      dot.position.set(x, ridgeY + 0.26 + y, 0.6 + z);
      g.add(dot);
    }
  } else {
    const star = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const arm = mesh(new THREE.ConeGeometry(0.08, 0.3, 4), mat('#ff8a5c'));
      const a = (i / 5) * Math.PI * 2;
      arm.position.set(Math.sin(a) * 0.14, Math.cos(a) * 0.14, 0);
      arm.rotation.z = -a;
      star.add(arm);
    }
    star.position.set(0, ridgeY + 0.2, 0.75);
    g.add(star);
  }

  // glow and rising sparkles (not part of the baked pier: they move)
  const c = new THREE.Color(color);
  const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(`rgba(${rgb},0.8)`, `rgba(${rgb},0)`), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6,
  }));
  glow.scale.setScalar(3.2);
  glow.position.set(0, 1.3, 0);
  g.add(glow);
  const sparkMat = new THREE.MeshBasicMaterial({ color: c.clone().lerp(new THREE.Color('#ffffff'), 0.5), toneMapped: false });
  const sparks = Array.from({ length: 8 }, (_, i) => {
    const m = mesh(new THREE.OctahedronGeometry(0.05), sparkMat, { cast: false, receive: false, isStatic: false });
    m.userData.phase = i / 8;
    g.add(m);
    return m;
  });

  g.userData.update = (t) => {
    swirl.uniforms.time.value = t;
    glow.material.opacity = 0.5 + Math.sin(t * 2.2) * 0.12;
    for (const m of sparks) {
      const k = (t * 0.28 + m.userData.phase) % 1;
      m.position.set(Math.sin(t * 0.9 + m.userData.phase * 9) * 0.55, base + 0.2 + k * 2.2, -0.3);
      m.scale.setScalar(Math.sin(k * Math.PI) * 1.2);
      m.rotation.y = t * 2;
    }
  };
  return g;
}

// ---------------------------------------------------------------------------------------------
// Island pieces

// Campfire: a ring of stones, a teepee of logs and flickering flames. userData.update(t).
export function campfire() {
  const g = new THREE.Group();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const st = mesh(new THREE.DodecahedronGeometry(0.17), mat(i % 2 ? '#8d8a86' : '#a59f97'));
    st.position.set(Math.cos(a) * 0.62, 0.08, Math.sin(a) * 0.62);
    st.scale.y = 0.7;
    st.rotation.y = a * 3;
    g.add(st);
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const log = cyl(0.06, 0.08, 0.86, 6, i % 2 ? '#6b4225' : '#7c4f2c');
    log.position.set(Math.cos(a) * 0.17, 0.32, Math.sin(a) * 0.17);
    log.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
    g.add(log);
  }
  const embers = mesh(new THREE.CircleGeometry(0.38, 10), mat('#ff6a1a', { emissive: '#ff4a0a', emissiveIntensity: 2.2 }), { cast: false });
  embers.rotation.x = -Math.PI / 2;
  embers.position.y = 0.05;
  g.add(embers);
  const flames = [
    ['#ff7a1a', 0.26, 0.85, 0], ['#ffb02e', 0.19, 0.68, 0.1], ['#ffe27a', 0.11, 0.48, 0.2],
  ].map(([c, r, hgt, off]) => {
    const f = mesh(new THREE.ConeGeometry(r, hgt, 6), new THREE.MeshBasicMaterial({ color: c, toneMapped: false, transparent: true, opacity: 0.92 }),
      { cast: false, receive: false, isStatic: false });
    f.position.y = 0.12 + hgt / 2;
    f.userData = { base: hgt, off };
    g.add(f);
    return f;
  });
  const glow = glowSprite('warm', 2.6);
  glow.position.y = 0.6;
  g.add(glow);
  g.userData.update = (t) => {
    for (const f of flames) {
      const k = 1 + Math.sin(t * 9 + f.userData.off * 20) * 0.12 + Math.sin(t * 17 + f.userData.off * 7) * 0.06;
      f.scale.set(1, k, 1);
      f.position.y = 0.12 + (f.userData.base * k) / 2;
      f.rotation.y = t * (1 + f.userData.off);
    }
    glow.scale.setScalar(2.4 + Math.sin(t * 11) * 0.2);
  };
  return g;
}

// A log to sit on by the fire, lying along x.
export function logSeat(length = 1.5) {
  const g = new THREE.Group();
  const log = cyl(0.2, 0.22, length, 8, '#7a4c2a');
  log.rotation.z = Math.PI / 2;
  log.position.y = 0.2;
  const ends = [-1, 1].map((s) => {
    const e = cyl(0.16, 0.16, 0.02, 8, '#d8b07a');
    e.rotation.z = Math.PI / 2;
    e.position.set(s * (length / 2 + 0.005), 0.2, 0);
    return e;
  });
  g.add(log, ...ends);
  return g;
}

// A round leafy bush.
export function bush(size = 0.5, color = '#4f9a3f') {
  const g = new THREE.Group();
  for (const [x, y, z, s] of [[0, 0.5, 0, 1], [0.45, 0.35, 0.1, 0.75], [-0.4, 0.32, -0.05, 0.7], [0.1, 0.3, 0.4, 0.65]]) {
    const ball = mesh(new THREE.IcosahedronGeometry(size * s, 0), mat(s === 1 ? color : '#5aac48'));
    ball.position.set(x * size * 1.6, y * size * 1.6, z * size * 1.6);
    g.add(ball);
  }
  return g;
}

// A few flowers on short stems.
export function flowers(colors = ['#ff7ab8', '#ffe066', '#ffffff']) {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const a = i * 2.4, r = 0.12 + (i % 3) * 0.1;
    const stem = box(0.02, 0.22, 0.02, '#3f7a2f');
    stem.position.set(Math.cos(a) * r, 0.11, Math.sin(a) * r);
    const bloom = mesh(new THREE.IcosahedronGeometry(0.06, 0), mat(colors[i % colors.length]));
    bloom.position.set(Math.cos(a) * r, 0.24, Math.sin(a) * r);
    g.add(stem, bloom);
  }
  return g;
}

// Festoon lights between two points (world positions): a sagging cable with warm bulbs.
export function stringLights(a, b, { sag = 0.6, bulbs = 12 } = {}) {
  const g = new THREE.Group();
  const mid = a.clone().lerp(b, 0.5);
  mid.y -= sag * 2; // a quadratic curve only gets half way to its control point
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  const cable = mesh(new THREE.TubeGeometry(curve, 20, 0.014, 4), mat('#2a2018'), { cast: false });
  g.add(cable);
  const bulbMat = mat('#fff1c4', { emissive: '#ffcf6a', emissiveIntensity: 3.2, flat: false });
  for (let i = 1; i < bulbs; i++) {
    const p = curve.getPoint(i / bulbs);
    const bulb = mesh(new THREE.SphereGeometry(0.06, 6, 4), bulbMat, { cast: false });
    bulb.position.set(p.x, p.y - 0.07, p.z);
    g.add(bulb);
  }
  return g;
}

// The grassy island: rocky skirt from under the water, a band of soil, a grass top just below deck
// height (so a boardwalk can rest on it), a sandy clearing and boulders round the shore. Built
// around its own centre; `deckY` is the height people walk at.
export function grassIsland(radius, deckY, { clearing = { x: 0, z: 0, r: 2.6 }, path = null } = {}) {
  const g = new THREE.Group();
  const wobble = (a, k) => 1 + Math.sin(a * 3 + k) * 0.035 + Math.sin(a * 7 + k * 2) * 0.025;
  const jagged = (geo, k, amount = 1) => {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const a = Math.atan2(z, x);
      const f = 1 + (wobble(a, k) - 1) * amount;
      pos.setX(i, x * f);
      pos.setZ(i, z * f);
    }
    geo.computeVertexNormals();
    return geo;
  };
  const rockH = deckY + 1.2;
  const rock = mesh(jagged(new THREE.CylinderGeometry(radius + 0.35, radius + 1.1, rockH, 24, 2), 1.3, 2), mat('#7c8796'));
  rock.position.y = deckY - 0.3 - rockH / 2;
  // the soil band's top stays below the grass top, so the two never fight over the same pixels
  const soil = mesh(jagged(new THREE.CylinderGeometry(radius + 0.18, radius + 0.32, 0.34, 24), 1.3), mat('#8a6646'));
  soil.position.y = deckY - 0.26;
  const grass = mesh(jagged(new THREE.CylinderGeometry(radius + 0.06, radius + 0.16, 0.16, 24), 1.3), mat('#74bf57'));
  grass.position.y = deckY - 0.12;
  g.add(rock, soil, grass);

  // sand drawn on top of the grass; polygon offset keeps it from flickering against it
  const sand = new THREE.MeshStandardMaterial({ color: '#e2c48e', roughness: 0.95, flatShading: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const clear = mesh(jagged(new THREE.CircleGeometry(clearing.r, 18).rotateX(-Math.PI / 2), 4.1, 3), sand, { cast: false });
  clear.position.set(clearing.x, deckY - 0.039, clearing.z);
  g.add(clear);
  if (path) {
    const strip = mesh(new THREE.PlaneGeometry(path.w, path.len).rotateX(-Math.PI / 2), sand, { cast: false });
    strip.position.set(path.x, deckY - 0.039, path.z);
    g.add(strip);
  }

  // boulders round the shore, some poking up beside the grass
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + Math.sin(i * 12.9) * 0.08;
    const size = 0.55 + ((i * 37) % 10) / 18;
    const r = radius + 0.35 + ((i * 53) % 7) / 12;
    const b = mesh(new THREE.DodecahedronGeometry(size, 0), mat(i % 3 === 0 ? '#8e98a6' : i % 3 === 1 ? '#6f7987' : '#9aa2ad'));
    b.position.set(Math.cos(a) * r, 0.15 + ((i * 29) % 9) / 10 * (deckY - 0.9), Math.sin(a) * r);
    b.rotation.set(i * 1.7, i * 2.3, i * 0.9);
    b.scale.y = 0.75;
    g.add(b);
  }
  return g;
}
