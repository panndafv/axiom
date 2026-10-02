import { svg } from './dom.js';

// Side-view fish as a little pixel-art sprite, rasterised from the species' shape and colours
// onto a coarse grid with a dark outline, like an old handheld game.

const GRID_W = 26;
const GRID_H = 16;
const SHAPES = {
  perch:  { rx: 7.2, ry: 3.8, tail: 4,   dorsal: 2 },
  small:  { rx: 5.6, ry: 3.2, tail: 3,   dorsal: 1.2 },
  long:   { rx: 8.6, ry: 2.6, tail: 3.5, dorsal: 1.2, forked: true },
  eel:    { rx: 9.8, ry: 1.7, tail: 2,   dorsal: 0 },
  round:  { rx: 5.4, ry: 4.6, tail: 3,   dorsal: 0, spikes: true },
  tall:   { rx: 5.8, ry: 4.9, tail: 3.5, dorsal: 2.4 },
  angler: { rx: 6.8, ry: 4.4, tail: 3,   dorsal: 0, lure: true },
  tuna:   { rx: 8,   ry: 3.6, tail: 4.5, dorsal: 2, forked: true },
  marlin: { rx: 7.6, ry: 2.9, tail: 4.5, dorsal: 3.4, forked: true, bill: 4 },
  shark:  { rx: 9,   ry: 3.2, tail: 4.5, dorsal: 3, forked: true },
};
const OUTLINE = '#1d140f';
const DIM = '#3a2d25';
const cache = new Map();

function rasterize(species) {
  const s = SHAPES[species.shape] || SHAPES.perch;
  const [top, belly, accent] = species.colors;
  const cx = 1 + s.tail + s.rx;
  const cy = GRID_H / 2 + 0.6;
  const grid = Array.from({ length: GRID_H }, () => new Array(GRID_W).fill(null));
  const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < GRID_W && y < GRID_H) grid[y][x] = c; };
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const px = x + 0.5, py = y + 0.5;
      const dx = (px - cx) / s.rx, dy = (py - cy) / s.ry;
      if (dx * dx + dy * dy <= 1) {
        let c = py < cy + s.ry * 0.15 ? top : belly;
        if (species.pattern === 'stripes' && py < cy + s.ry * 0.4 && Math.abs(dx) < 0.75 && Math.floor(px - cx + 20) % 3 === 0) c = accent;
        if (species.pattern === 'spots' && Math.abs(dx) < 0.8 && ((x * 7 + y * 13) % 9 === 0)) c = accent;
        grid[y][x] = c;
        continue;
      }
      // tail, fanning out to the left of the body
      const t = (cx - s.rx + 1 - px) / (s.tail + 1);
      if (t >= 0 && t <= 1) {
        const half = 0.6 + t * s.ry * 0.95;
        const notch = s.forked && t > 0.5 && Math.abs(py - cy) < (t - 0.5) * s.ry * 1.5;
        if (Math.abs(py - cy) <= half && !notch) { grid[y][x] = accent; continue; }
      }
      // dorsal fin on the back
      if (s.dorsal) {
        const mid = cx - s.rx * 0.15;
        const reach = s.rx * 0.4;
        const k = 1 - Math.abs(px - mid) / reach;
        if (k > 0 && py >= cy - s.ry - s.dorsal * k && py < cy - s.ry * 0.5) { grid[y][x] = accent; continue; }
      }
      // pelvic fin
      if (Math.abs(px - (cx + 0.5)) < 1.2 && py > cy + s.ry * 0.8 && py < cy + s.ry + 1.3) grid[y][x] = accent;
    }
  }
  if (s.bill) for (let x = Math.floor(cx + s.rx - 0.5); x < cx + s.rx + s.bill; x++) set(x, Math.floor(cy - 0.5), top);
  if (s.lure) {
    const lx = Math.floor(cx + s.rx * 0.35), ly = Math.floor(cy - s.ry - 1);
    set(lx, ly, top); set(lx + 1, ly - 1, top); set(lx + 2, ly - 1, top); set(lx + 3, ly, accent);
  }
  if (s.spikes) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.3;
      set(Math.floor(cx + Math.cos(a) * (s.rx + 0.9)), Math.floor(cy + Math.sin(a) * (s.ry + 0.9)), accent);
    }
  }
  set(Math.floor(cx + s.rx * 0.55), Math.floor(cy - s.ry * 0.3), 'eye');
  // dark outline around everything
  const filled = (x, y) => x >= 0 && y >= 0 && x < GRID_W && y < GRID_H && grid[y][x] && grid[y][x] !== OUTLINE;
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (!grid[y][x] && (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1))) grid[y][x] = OUTLINE;
    }
  }
  return grid;
}

function spriteMarkup(grid, silhouette) {
  let rects = '';
  for (let y = 0; y < GRID_H; y++) {
    let x = 0;
    while (x < GRID_W) {
      const raw = grid[y][x];
      if (!raw) { x++; continue; }
      const c = silhouette ? (raw === OUTLINE ? 'transparent' : DIM) : raw === 'eye' ? '#111' : raw;
      let run = 1;
      while (x + run < GRID_W && grid[y][x + run] === raw) run++;
      if (c !== 'transparent') rects += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${c}"/>`;
      x += run;
    }
  }
  return rects;
}

// silhouette: the dim shape shown in the catch log for fish you haven't caught yet
export function fishIcon(species, size = 56, { silhouette = false } = {}) {
  const key = `${species.id}:${silhouette ? 1 : 0}`;
  if (!cache.has(key)) cache.set(key, spriteMarkup(rasterize(species), silhouette));
  const h = Math.round((size * GRID_H) / GRID_W);
  return svg(`<svg width="${size}" height="${h}" viewBox="0 0 ${GRID_W} ${GRID_H}" shape-rendering="crispEdges" aria-hidden="true">${cache.get(key)}</svg>`);
}

// Diagonal rod drawing for shop / rack cards. Glowing rods get a halo and sparks.
export function rodIcon(rod, { dim = false, size = 96 } = {}) {
  const color = dim ? '#4b3e35' : rod.color;
  const tip = dim ? '#4b3e35' : rod.tip;
  const glow = !dim && rod.glow;
  let sparks = '';
  if (glow) {
    for (let i = 0; i < 7; i++) {
      const x = 30 + Math.random() * 50, y = 10 + Math.random() * 60;
      sparks += `<circle cx="${x}" cy="${y}" r="${1.4 + Math.random() * 1.6}" fill="${rod.tip}"><animate attributeName="opacity" values="0.2;1;0.2" dur="${1 + Math.random()}s" repeatCount="indefinite"/></circle>`;
    }
  }
  return svg(`
    <svg width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">
      ${glow ? `<defs><radialGradient id="rg${rod.id}"><stop offset="0" stop-color="${rod.glow}" stop-opacity="0.55"/><stop offset="1" stop-color="${rod.glow}" stop-opacity="0"/></radialGradient></defs><circle cx="55" cy="45" r="42" fill="url(#rg${rod.id})"/>` : ''}
      <line x1="26" y1="88" x2="80" y2="10" stroke="${color}" stroke-width="5" stroke-linecap="round"/>
      <line x1="24" y1="91" x2="36" y2="74" stroke="${dim ? '#3a2f28' : '#5a3a26'}" stroke-width="8" stroke-linecap="round"/>
      <line x1="80" y1="10" x2="84" y2="58" stroke="${dim ? '#4b3e35' : '#e9e2d4'}" stroke-width="0.8"/>
      <circle cx="84" cy="60" r="3.2" fill="${tip}"/>
      ${sparks}
    </svg>`);
}

export function baitIcon(bait, size = 72) {
  return svg(`
    <svg width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">
      <line x1="50" y1="6" x2="50" y2="36" stroke="#e9e2d4" stroke-width="1.2"/>
      <circle cx="50" cy="40" r="4" fill="none" stroke="#c9ccd2" stroke-width="2"/>
      <path d="M50 44 C 30 52, 34 72, 50 78 C 66 72, 70 52, 50 44 Z" fill="${bait.color}"/>
      <path d="M50 78 q 6 10 -2 14" stroke="#c9ccd2" stroke-width="2.5" fill="none"/>
      <circle cx="45" cy="56" r="3" fill="#fff" opacity="0.6"/>
    </svg>`);
}

export function outfitIcon(outfit, size = 80) {
  const c = outfit.colors;
  return svg(`
    <svg width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">
      <rect x="32" y="12" width="36" height="32" rx="2" fill="#f0c39a"/>
      <rect x="30" y="8" width="40" height="12" fill="${c.hair}"/>
      <rect x="30" y="8" width="7" height="22" fill="${c.hair}"/>
      <rect x="63" y="8" width="7" height="22" fill="${c.hair}"/>
      ${c.hat ? `<rect x="29" y="4" width="42" height="11" fill="${c.hat}"/><rect x="40" y="13" width="36" height="4" fill="${c.hat}"/>` : ''}
      <rect x="41" y="25" width="4" height="6" fill="#2a1d16"/><rect x="55" y="25" width="4" height="6" fill="#2a1d16"/>
      <rect x="28" y="44" width="44" height="30" fill="${c.shirt}"/>
      <rect x="18" y="44" width="10" height="26" fill="${c.shirt}"/><rect x="72" y="44" width="10" height="26" fill="${c.shirt}"/>
      <rect x="31" y="74" width="16" height="22" fill="${c.pants}"/><rect x="53" y="74" width="16" height="22" fill="${c.pants}"/>
    </svg>`);
}
