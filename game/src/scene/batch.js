import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Merges every mesh flagged userData.static under `root` into one mesh per material, so the
// whole pier draws in a few dozen calls instead of thousands.
export function bakeStatic(root, target) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  const victims = [];
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.userData.static || Array.isArray(obj.material)) return;
    let geo = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
    geo.applyMatrix4(obj.matrixWorld);
    for (const name of Object.keys(geo.attributes)) {
      if (!['position', 'normal', 'uv', 'color'].includes(name)) geo.deleteAttribute(name);
    }
    if (!geo.attributes.uv) {
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    }
    const wantsColor = !!obj.material.vertexColors;
    if (!wantsColor && geo.attributes.color) geo.deleteAttribute('color');
    const key = obj.material.uuid + (obj.castShadow ? 'c' : '') + (obj.receiveShadow ? 'r' : '');
    if (!groups.has(key)) groups.set(key, { material: obj.material, cast: obj.castShadow, receive: obj.receiveShadow, geos: [] });
    groups.get(key).geos.push(geo);
    victims.push(obj);
  });
  for (const obj of victims) obj.parent.remove(obj);
  for (const { material, cast, receive, geos } of groups.values()) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    merged.computeBoundingSphere();
    const m = new THREE.Mesh(merged, material);
    m.castShadow = cast;
    m.receiveShadow = receive;
    target.add(m);
  }
  return groups.size;
}
