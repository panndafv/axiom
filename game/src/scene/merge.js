import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Folds several coloured shapes into one geometry with per-vertex colour, so a multi-coloured
// object draws in a single call with the shared `paintedMaterial`.

export const paintedMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });

const color = new THREE.Color();
const euler = new THREE.Euler();
const matrix = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const scale = new THREE.Vector3(1, 1, 1);

// pieces: [{ geo, color, pos: [x, y, z], rot: [x, y, z] }]
export function paintedGeometry(pieces) {
  const geos = pieces.map(({ geo, color: c, pos = [0, 0, 0], rot = [0, 0, 0] }) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    g.deleteAttribute('uv');
    matrix.compose(new THREE.Vector3(...pos), quat.setFromEuler(euler.set(...rot)), scale);
    g.applyMatrix4(matrix);
    color.set(c);
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([color.r, color.g, color.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  });
  return mergeGeometries(geos);
}

// Shorthand for a box piece. The box hangs down from its top edge when `hang` is set, which is how
// limbs pivot at the shoulder or hip.
export function boxPiece(w, h, d, c, pos = [0, 0, 0], rot = [0, 0, 0], hang = false) {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (hang) geo.translate(0, -h / 2, 0);
  return { geo, color: c, pos, rot };
}
