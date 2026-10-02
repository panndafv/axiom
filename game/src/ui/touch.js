import { h } from './dom.js';

// On-screen controls for phones (including wallet in-app browsers): a joystick to walk, drag
// anywhere else to look, and buttons for the keys a keyboard player would press.

export function isTouchDevice() {
  return window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
}

export function createTouchControls(app, input) {
  const ui = document.getElementById('ui');
  const knob = h('div.joy-knob');
  const joy = h('div.joy', knob);
  const btn = (label, onPress, cls = '') => {
    const b = h(`button.touch-btn${cls}`, label);
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); onPress(); });
    return b;
  };
  const act = btn('E', () => app.touchAction('KeyE'), '.big');
  const bank = btn('BANK', () => app.touchAction('KeyB'));
  const leave = btn('STOP', () => app.touchAction('KeyE'));
  const view = btn('VIEW', () => app.touchAction('KeyV'));
  const right = h('div.touch-right', view, act);
  const fishBtns = h('div.touch-right', leave, bank);
  const root = h('div.touch.passive', joy, right, fishBtns);
  ui.append(root);

  let joyId = null;
  let cx = 0, cy = 0;
  const R = 46;
  joy.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    joyId = e.pointerId;
    joy.setPointerCapture(e.pointerId);
    const r = joy.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    move(e);
  });
  const move = (e) => {
    if (e.pointerId !== joyId) return;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    input.axis.x = dx / R;
    input.axis.y = -dy / R;
  };
  const end = (e) => {
    if (e.pointerId !== joyId) return;
    joyId = null;
    knob.style.transform = '';
    input.axis.x = input.axis.y = 0;
  };
  joy.addEventListener('pointermove', move);
  joy.addEventListener('pointerup', end);
  joy.addEventListener('pointercancel', end);

  return {
    update(mode, near, modalOpen) {
      root.style.display = modalOpen || mode === 'title' ? 'none' : '';
      joy.style.display = mode === 'walk' ? '' : 'none';
      right.style.display = mode === 'walk' || mode === 'sit' ? '' : 'none';
      fishBtns.style.display = mode === 'fish' ? '' : 'none';
      act.style.opacity = near || mode === 'sit' ? '1' : '0.35';
      act.textContent = mode === 'sit' ? 'STAND' : near ? near.title.split(' ')[0] : 'E';
    },
  };
}
