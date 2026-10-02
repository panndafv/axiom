import { svg } from './dom.js';

// Side-view fish drawn as SVG from the species shape preset and colours.

const BODY = {
  perch:  { rx: 34, ry: 16 },
  small:  { rx: 26, ry: 14 },
  long:   { rx: 40, ry: 10 },
  eel:    { rx: 44, ry: 6 },
  round:  { rx: 24, ry: 21 },
  tall:   { rx: 26, ry: 22 },
  angler: { rx: 30, ry: 19 },
  tuna:   { rx: 38, ry: 15 },
  marlin: { rx: 38, ry: 12 },
  shark:  { rx: 42, ry: 13 },
};

let uid = 0;
export function fishIcon(species, size = 56) {
  const b = BODY[species.shape] || BODY.perch;
  const [top, belly, accent] = species.colors;
  const id = `fg${uid++}`;
  const cx = 52, cy = 30;
  const tailX = cx - b.rx + 4;
  const forked = ['tuna', 'marlin', 'shark', 'long'].includes(species.shape);
  const tail = forked
    ? `M${tailX} ${cy} L${tailX - 18} ${cy - 15} L${tailX - 9} ${cy} L${tailX - 18} ${cy + 15} Z`
    : `M${tailX} ${cy} L${tailX - 16} ${cy - 12} L${tailX - 13} ${cy} L${tailX - 16} ${cy + 12} Z`;
  const dorsalH = species.shape === 'marlin' ? 16 : species.shape === 'tall' ? 14 : species.shape === 'shark' ? 13 : 8;
  const dorsal = `M${cx - 12} ${cy - b.ry + 2} L${cx - 2} ${cy - b.ry - dorsalH} L${cx + 8} ${cy - b.ry + 3} Z`;
  let extra = '';
  if (species.shape === 'marlin') extra += `<path d="M${cx + b.rx - 2} ${cy - 2} L${cx + b.rx + 18} ${cy - 1} L${cx + b.rx - 2} ${cy + 2} Z" fill="${top}"/>`;
  if (species.shape === 'angler') extra += `<path d="M${cx + 10} ${cy - b.ry + 2} Q${cx + 22} ${cy - b.ry - 14} ${cx + 30} ${cy - b.ry - 6}" stroke="${top}" stroke-width="1.5" fill="none"/><circle cx="${cx + 30}" cy="${cy - b.ry - 5}" r="3.5" fill="${accent}"/>`;
  let pattern = '';
  if (species.pattern === 'stripes') {
    for (let i = -2; i <= 2; i++) pattern += `<rect x="${cx + i * 9 - 2}" y="${cy - b.ry}" width="4" height="${b.ry * 1.3}" fill="${accent}" opacity="0.55"/>`;
  } else if (species.pattern === 'spots') {
    for (let i = 0; i < 6; i++) pattern += `<circle cx="${cx - b.rx * 0.5 + i * b.rx * 0.22}" cy="${cy - b.ry * 0.35 + (i % 2) * b.ry * 0.4}" r="2.3" fill="${accent}" opacity="0.7"/>`;
  }
  if (species.shape === 'round') {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const x1 = cx + Math.cos(a) * b.rx, y1 = cy + Math.sin(a) * b.ry;
      const x2 = cx + Math.cos(a) * (b.rx + 5), y2 = cy + Math.sin(a) * (b.ry + 5);
      extra += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${accent}" stroke-width="2"/>`;
    }
  }
  return svg(`
    <svg width="${size}" height="${Math.round(size * 0.6)}" viewBox="0 0 110 62" aria-hidden="true">
      <defs>
        <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${belly}"/>
        </linearGradient>
        <clipPath id="${id}c"><ellipse cx="${cx}" cy="${cy}" rx="${b.rx}" ry="${b.ry}"/></clipPath>
      </defs>
      <path d="${tail}" fill="${accent}"/>
      <path d="${dorsal}" fill="${accent}"/>
      <ellipse cx="${cx}" cy="${cy}" rx="${b.rx}" ry="${b.ry}" fill="url(#${id})"/>
      <g clip-path="url(#${id}c)">${pattern}</g>
      <path d="M${cx + 4} ${cy + b.ry * 0.6} L${cx + 10} ${cy + b.ry + 6} L${cx + 14} ${cy + b.ry * 0.5} Z" fill="${accent}" opacity="0.9"/>
      ${extra}
      <circle cx="${cx + b.rx * 0.62}" cy="${cy - b.ry * 0.15}" r="${Math.max(2.4, b.ry * 0.18)}" fill="#141414"/>
      <circle cx="${cx + b.rx * 0.62 + 0.8}" cy="${cy - b.ry * 0.15 - 0.8}" r="0.9" fill="#fff"/>
    </svg>`);
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
