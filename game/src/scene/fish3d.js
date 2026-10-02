import * as THREE from 'three';

// Builds a low-poly fish for a species from its shape preset and colours. Faces +x, ~1 m long.

const SHAPES = {
  perch:  { len: 1.0, h: 0.42, w: 0.2,  tail: 0.32, dorsal: 0.18 },
  small:  { len: 0.8, h: 0.36, w: 0.18, tail: 0.26, dorsal: 0.1 },
  long:   { len: 1.2, h: 0.26, w: 0.16, tail: 0.26, dorsal: 0.1 },
  eel:    { len: 1.6, h: 0.16, w: 0.13, tail: 0.12, dorsal: 0.06 },
  round:  { len: 0.8, h: 0.62, w: 0.55, tail: 0.22, dorsal: 0.08 },
  tall:   { len: 0.85, h: 0.6, w: 0.16, tail: 0.28, dorsal: 0.36 },
  angler: { len: 0.95, h: 0.56, w: 0.42, tail: 0.24, dorsal: 0.08 },
  tuna:   { len: 1.25, h: 0.42, w: 0.3,  tail: 0.42, dorsal: 0.2 },
  marlin: { len: 1.4, h: 0.36, w: 0.24, tail: 0.46, dorsal: 0.42 },
  shark:  { len: 1.5, h: 0.4,  w: 0.32, tail: 0.5,  dorsal: 0.34 },
};

function colorBody(geo, top, belly, accent, pattern, len) {
  const pos = geo.attributes.position;
  const cTop = new THREE.Color(top), cBelly = new THREE.Color(belly), cAcc = new THREE.Color(accent);
  const colors = [];
  const c = new THREE.Color();
  let maxY = 0;
  for (let i = 0; i < pos.count; i++) maxY = Math.max(maxY, Math.abs(pos.getY(i)));
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = THREE.MathUtils.smoothstep(y / (maxY || 1), -0.5, 0.5);
    c.copy(cBelly).lerp(cTop, t);
    if (pattern === 'stripes' && Math.sin((x / len) * 22) > 0.55 && t > 0.3) c.lerp(cAcc, 0.55);
    if (pattern === 'spots' && Math.sin(x * 31 + z * 17) * Math.sin(y * 29 + x * 7) > 0.55) c.lerp(cAcc, 0.7);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}

function fin(points, color) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ShapeGeometry(shape);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, flatShading: true, roughness: 0.7 }));
  m.castShadow = true;
  return m;
}

export function createFish(species, { glow = false } = {}) {
  const s = SHAPES[species.shape] || SHAPES.perch;
  const [top, belly, accent] = species.colors;
  const g = new THREE.Group();

  const bodyGeo = new THREE.SphereGeometry(0.5, 10, 7);
  bodyGeo.scale(s.len, s.h, s.w);
  if (species.shape === 'shark' || species.shape === 'tuna' || species.shape === 'marlin') {
    // pointier nose, thicker shoulders
    const pos = bodyGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      if (x > 0) pos.setY(i, pos.getY(i) * (1 - (x / (s.len / 2)) * 0.35));
    }
  }
  if (species.shape === 'angler') {
    const pos = bodyGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      if (x < 0) { pos.setY(i, pos.getY(i) * (1 + x * 0.9)); pos.setZ(i, pos.getZ(i) * (1 + x * 0.9)); }
    }
  }
  bodyGeo.computeVertexNormals();
  colorBody(bodyGeo, top, belly, accent, species.pattern, s.len);
  const bodyMat = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.55, metalness: 0.1,
    transparent: species.id === 'ghost_whale', opacity: species.id === 'ghost_whale' ? 0.85 : 1,
    emissive: glow ? new THREE.Color(accent) : new THREE.Color('#000'),
    emissiveIntensity: glow ? 0.25 : 0,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true;
  g.add(body);

  const half = s.len / 2;
  // tail
  const forked = ['tuna', 'marlin', 'shark', 'long'].includes(species.shape);
  const tail = fin(forked
    ? [[0, 0], [-s.tail, s.tail * 0.9], [-s.tail * 0.55, 0], [-s.tail, -s.tail * 0.9]]
    : [[0, 0], [-s.tail, s.tail * 0.7], [-s.tail * 0.8, 0], [-s.tail, -s.tail * 0.7]], accent);
  tail.position.x = -half + 0.04;
  g.add(tail);
  g.userData.tail = tail;

  // dorsal fin
  const dorsal = fin(species.shape === 'tall'
    ? [[-0.3, 0], [-0.25, s.dorsal], [-0.1, s.dorsal * 0.7], [0, s.dorsal], [0.1, s.dorsal * 0.6], [0.2, 0]]
    : [[-s.len * 0.25, 0], [-s.len * 0.05, s.dorsal], [s.len * 0.12, 0]], accent);
  dorsal.position.y = s.h * 0.42;
  g.add(dorsal);

  // belly fin
  const pelvic = fin([[-0.1, 0], [-0.02, -s.h * 0.35], [0.08, 0]], accent);
  pelvic.position.set(0.05, -s.h * 0.38, 0);
  g.add(pelvic);

  // eyes
  for (const z of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.035, s.h * 0.09), 6, 4), new THREE.MeshStandardMaterial({ color: '#111' }));
    eye.position.set(half * 0.62, s.h * 0.1, z * s.w * 0.38);
    g.add(eye);
  }

  if (species.shape === 'marlin') {
    const bill = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.6, 5), new THREE.MeshStandardMaterial({ color: top, flatShading: true }));
    bill.rotation.z = -Math.PI / 2;
    bill.position.x = half + 0.28;
    g.add(bill);
  }
  if (species.shape === 'angler') {
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 4), new THREE.MeshStandardMaterial({ color: top }));
    stalk.position.set(half * 0.5, s.h * 0.62, 0);
    stalk.rotation.z = -0.6;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 2.5 }));
    bulb.position.set(half * 0.5 + 0.13, s.h * 0.62 + 0.17, 0);
    g.add(stalk, bulb);
  }
  if (species.shape === 'round') {
    const spikeMat = new THREE.MeshStandardMaterial({ color: accent, flatShading: true });
    for (let i = 0; i < 18; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.1, 4), spikeMat);
      const dir = new THREE.Vector3().randomDirection();
      dir.x *= 0.8;
      spike.position.copy(dir).multiply(new THREE.Vector3(s.len / 2, s.h / 2, s.w / 2));
      spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      g.add(spike);
    }
  }
  return g;
}
