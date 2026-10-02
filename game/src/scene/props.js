import * as THREE from 'three';
import { glowTexture } from './textures.js';

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

export function rodMesh(color = '#9a6a3c', tip = '#ff6a3d', length = 1.9) {
  const g = new THREE.Group();
  const shaft = mesh(new THREE.CylinderGeometry(0.018, 0.04, length, 6), mat(color, { flat: false, rough: 0.6 }), { isStatic: false });
  shaft.position.y = length / 2;
  const grip = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.38, 6), mat('#3b2a22'), { isStatic: false });
  grip.position.y = 0.19;
  const reel = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 8), mat('#c9ccd2', { metal: 0.5, rough: 0.4 }), { isStatic: false });
  reel.rotation.z = Math.PI / 2;
  reel.position.set(0.07, 0.45, 0);
  const tipBall = mesh(new THREE.SphereGeometry(0.035, 6, 4), mat(tip, { emissive: tip, emissiveIntensity: 0.4 }), { isStatic: false });
  tipBall.position.y = length;
  g.add(shaft, grip, reel, tipBall);
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
