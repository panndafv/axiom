import * as THREE from 'three';
import { glowTexture } from './textures.js';

// Sunset sky, stars, moon, sea and lights. Returns { update(dt, t, camera) }.

export const SKY = {
  top: new THREE.Color('#110d33'),
  mid: new THREE.Color('#3a2263'),
  low: new THREE.Color('#b8456c'),
  horizon: new THREE.Color('#f59a52'),
  band: new THREE.Color('#ffd28c'),
  fog: new THREE.Color('#e9a77a'),
  waterNear: new THREE.Color('#86a9ba'),
  waterFar: new THREE.Color('#dcae8c'),
};

// Direction of the sunset glow (low in the north-west, behind the lighthouse).
export const SUN_DIR = new THREE.Vector3(-0.42, 0.13, -0.9).normalize();
const MOON_DIR = new THREE.Vector3(-0.62, 0.2, -0.76).normalize();

function makeSky() {
  const geo = new THREE.SphereGeometry(900, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: SKY.top }, mid: { value: SKY.mid }, low: { value: SKY.low },
      horizon: { value: SKY.horizon }, band: { value: SKY.band },
      sunDir: { value: SUN_DIR },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        p.z = p.w * 0.99999; // always behind everything
        gl_Position = p;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 top, mid, low, horizon, band, sunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float sun = max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(sunDir.x, 0.0, sunDir.z))), 0.0);
        vec3 col = mix(band, horizon, smoothstep(-0.01, 0.05, h));
        col = mix(col, low, smoothstep(0.03, 0.16, h));
        col = mix(col, mid, smoothstep(0.12, 0.3, h));
        col = mix(col, top, smoothstep(0.26, 0.7, h));
        // warmer, brighter horizon toward the sunset side
        col += band * pow(sun, 6.0) * (1.0 - smoothstep(0.0, 0.25, h)) * 0.35;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

function makeStars() {
  const count = 520;
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * Math.PI * 2;
    const v = 0.22 + Math.random() * 0.78; // only the upper sky
    const r = 850;
    const y = v;
    const k = Math.sqrt(1 - y * y);
    pos.set([Math.cos(u) * k * r, y * r, Math.sin(u) * k * r], i * 3);
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 } },
    vertexShader: /* glsl */`
      attribute float seed;
      uniform float time;
      varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_Position.z = gl_Position.w * 0.9999;
        float tw = 0.55 + 0.45 * sin(time * (0.8 + seed * 2.0) + seed * 40.0);
        vA = tw * smoothstep(0.2, 0.45, normalize(position).y);
        gl_PointSize = (1.2 + seed * 2.2);
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(vec3(1.0, 0.97, 0.9), vA * smoothstep(0.5, 0.1, d));
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

function makeMoon() {
  const group = new THREE.Group();
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture('rgba(255,236,220,0.55)', 'rgba(255,220,200,0)'),
    transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
  }));
  halo.scale.setScalar(110);
  halo.material.opacity = 0.45;
  const disc = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture('rgba(255,252,246,1)', 'rgba(255,250,240,0)', 64),
    transparent: true, depthWrite: false, fog: false,
  }));
  disc.scale.setScalar(30);
  group.add(halo, disc);
  group.position.copy(MOON_DIR).multiplyScalar(780);
  return group;
}

function makeWater() {
  const geo = new THREE.PlaneGeometry(1800, 1800, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    fog: false,
    uniforms: {
      time: { value: 0 },
      near: { value: SKY.waterNear },
      far: { value: SKY.waterFar },
      fogColor: { value: SKY.fog },
      sky: { value: SKY.low },
      sunDir: { value: SUN_DIR },
      camPos: { value: new THREE.Vector3() },
    },
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform float time;
      uniform vec3 near, far, fogColor, sky, sunDir, camPos;
      varying vec3 vWorld;
      float wave(vec2 p, vec2 d, float f, float s) { return sin(dot(p, d) * f + time * s); }
      void main() {
        vec2 p = vWorld.xz;
        float dist = length(camPos.xz - p);
        // a few sine waves make a soft normal and some streaks
        float w1 = wave(p, vec2(0.8, 0.6), 0.35, 0.9);
        float w2 = wave(p, vec2(-0.5, 0.86), 0.62, 1.3);
        float w3 = wave(p, vec2(0.2, -0.98), 1.4, 2.1);
        vec3 n = normalize(vec3((w1 * 0.05 + w2 * 0.035 + w3 * 0.015), 1.0, (w2 * 0.04 - w1 * 0.025)));
        vec3 v = normalize(camPos - vWorld);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
        vec3 col = mix(near, far, smoothstep(12.0, 220.0, dist));
        col = mix(col, sky, fres * 0.25);
        // pale streaks like wind lanes
        float streak = smoothstep(0.9, 1.0, sin(p.x * 0.05 + p.y * 0.11 + w1 * 0.6 + time * 0.1));
        col += vec3(0.08) * streak * (1.0 - smoothstep(30.0, 200.0, dist));
        // glitter toward the sunset
        vec3 r = reflect(-v, n);
        float spec = pow(max(dot(r, normalize(sunDir)), 0.0), 220.0);
        col += vec3(1.0, 0.82, 0.62) * spec * 0.45;
        float f = smoothstep(60.0, 420.0, dist);
        col = mix(col, fogColor, f);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  return mesh;
}

// Floating motes over the pier.
function makeMotes() {
  const count = 90;
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos.set([-30 + Math.random() * 65, 2 + Math.random() * 7, -30 + Math.random() * 45], i * 3);
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 }, scale: { value: 300 } },
    vertexShader: /* glsl */`
      attribute float seed;
      uniform float time, scale;
      varying float vA;
      void main() {
        vec3 p = position;
        p.x += sin(time * 0.3 + seed * 20.0) * 1.2;
        p.y += mod(time * (0.15 + seed * 0.2) + seed * 7.0, 7.0) - 3.5;
        p.z += cos(time * 0.25 + seed * 13.0) * 1.2;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (0.05 + seed * 0.08) * scale / -mv.z;
        vA = 0.35 + 0.65 * abs(sin(time + seed * 30.0));
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(1.0, 0.93, 0.78, vA * smoothstep(0.5, 0.0, d));
      }`,
  });
  return new THREE.Points(geo, mat);
}

export function createEnvironment(scene, renderer) {
  scene.background = SKY.fog.clone();
  scene.fog = new THREE.Fog(SKY.fog, 70, 330);

  const sky = makeSky();
  const stars = makeStars();
  const moon = makeMoon();
  const water = makeWater();
  const motes = makeMotes();
  scene.add(sky, stars, moon, water, motes);

  const hemi = new THREE.HemisphereLight('#c7a2d6', '#d08a55', 1.0);
  scene.add(hemi);

  // The visible sunset is low on the horizon, but the shadow-casting key light sits higher so
  // the deck gets readable shadows instead of 40 m long ones.
  const sun = new THREE.DirectionalLight('#ffc48e', 2.3);
  sun.position.set(-28, 38, -30);
  sun.target.position.set(4, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -48; sc.right = 48; sc.top = 40; sc.bottom = -40; sc.near = 5; sc.far = 140;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // warm bounce from the camera side so faces turned away from the sunset keep their colour
  const fill = new THREE.DirectionalLight('#ffc9a3', 0.75);
  fill.position.set(30, 20, 40);
  scene.add(fill);

  return {
    sun,
    setShadows(on) {
      renderer.shadowMap.enabled = on;
      sun.castShadow = on;
    },
    update(t, camera) {
      stars.material.uniforms.time.value = t;
      motes.material.uniforms.time.value = t;
      water.material.uniforms.time.value = t;
      water.material.uniforms.camPos.value.copy(camera.position);
      sky.position.copy(camera.position);
      stars.position.copy(camera.position);
      moon.position.copy(MOON_DIR).multiplyScalar(780).add(camera.position);
    },
  };
}
