import * as THREE from 'three';

// All textures are drawn on canvases at startup, so the game ships with no image assets.

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

// Seeded so the planks look the same on every load.
function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Light wood grain along the u axis; the plank colour itself comes from vertex colours.
export function woodTexture() {
  const [c, g] = canvas(512, 128);
  const rnd = mulberry(7);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 70; i++) {
    const y = rnd() * 128;
    const shade = 200 + Math.floor(rnd() * 45);
    g.strokeStyle = `rgba(${shade - 40},${shade - 70},${shade - 100},${0.12 + rnd() * 0.18})`;
    g.lineWidth = 0.6 + rnd() * 2.2;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * (1 + rnd() * 2.5));
    g.stroke();
  }
  // a few knots
  for (let i = 0; i < 5; i++) {
    const x = rnd() * 512, y = rnd() * 128;
    const grad = g.createRadialGradient(x, y, 0, x, y, 7);
    grad.addColorStop(0, 'rgba(110,60,25,0.55)');
    grad.addColorStop(1, 'rgba(110,60,25,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(x, y, 10, 5, 0, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// Soft round sprite used for lantern glows, the moon halo and sparkles.
export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 128) {
  const [c, g] = canvas(size, size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.55)'));
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Board text for the scoreboard. Returns { texture, draw(lines) }.
export function boardTexture(w = 256, h = 320) {
  const [c, g] = canvas(w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  function draw(title, lines) {
    g.fillStyle = '#18202b';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#2d3a4a';
    g.lineWidth = 6;
    g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = '#ffcf5a';
    g.font = 'bold 26px "Tydal Digits", "Pixelify Sans", monospace';
    g.textAlign = 'center';
    g.fillText(title, w / 2, 40);
    g.font = '20px "Tydal Digits", "Pixelify Sans", monospace';
    lines.slice(0, 8).forEach((line, i) => {
      g.textAlign = 'left';
      g.fillStyle = i === 0 ? '#ffe9a8' : '#bfe9e3';
      g.fillText(`${i + 1}. ${line[0]}`, 16, 80 + i * 30);
      g.textAlign = 'right';
      g.fillStyle = '#ffb547';
      g.fillText(String(line[1]), w - 16, 80 + i * 30);
    });
    if (!lines.length) {
      g.fillStyle = '#7f93a8';
      g.textAlign = 'center';
      g.fillText('no catches yet', w / 2, 120);
    }
    tex.needsUpdate = true;
  }
  draw('TOP ANGLERS', []);
  return { texture: tex, draw };
}
