// Tiny DOM helpers: h('div.class', { on: { click } }, children...)

export function h(tag, props = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (props === null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) {
    children.unshift(props);
    props = {};
  }
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'class') el.className += ' ' + v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function svg(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstChild;
}

export const fmt = {
  int: (n) => Math.round(n || 0).toLocaleString('en-US'),
  short: (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}m` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : Math.round(n).toLocaleString('en-US')),
  kg: (kg) => (kg >= 100 ? `${Math.round(kg)} kg` : `${kg.toFixed(2)} kg`),
  sol: (lamports, digits = 4) => `${((lamports || 0) / 1e9).toFixed(digits)} SOL`,
  pct: (p) => `${+(p * 100).toFixed(3)}%`,
  usd: (n) => `$${(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`,
};

let toastBox = null;
// link: { href, text } adds a clickable link (a Solscan transaction, say) and keeps it up longer.
export function toast(message, kind = '', link = null) {
  if (!toastBox) {
    toastBox = h('div.toasts.passive');
    document.getElementById('ui').append(toastBox);
  }
  const el = h(`div.toast${kind ? '.' + kind : ''}${link ? '.has-link' : ''}`, message,
    link ? h('a', { href: link.href, target: '_blank', rel: 'noopener' }, link.text) : null);
  toastBox.append(el);
  setTimeout(() => el.remove(), link ? 9000 : kind === 'error' ? 4200 : 2800);
}
