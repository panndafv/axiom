// Keyboard + mouse state. Game code reads `input.down(code)` each frame and subscribes to
// one-shot presses with `input.on(code, fn)`.

export function createInput(canvas) {
  const held = new Set();
  const listeners = new Map();
  let mouseHeld = false;
  let lookDX = 0, lookDY = 0;
  let dragId = null; // the pointer that is dragging the view (one finger on touch screens)
  let lastX = 0, lastY = 0;
  let enabled = true;

  const isTyping = (e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName);

  window.addEventListener('keydown', (e) => {
    if (isTyping(e)) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    const first = !held.has(e.code);
    held.add(e.code);
    if (first) for (const fn of listeners.get(e.code) || []) fn(e);
    for (const fn of listeners.get('*') || []) if (first) fn(e);
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => { held.clear(); mouseHeld = false; dragId = null; });

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    mouseHeld = true;
    if (dragId === null) { dragId = e.pointerId; lastX = e.clientX; lastY = e.clientY; }
    for (const fn of listeners.get('Click') || []) fn(e);
  });
  const release = (e) => {
    if (e.pointerId === dragId) { dragId = null; mouseHeld = false; }
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('pointermove', (e) => {
    if (document.pointerLockElement === canvas) {
      lookDX += e.movementX;
      lookDY += e.movementY;
    } else if (e.pointerId === dragId && input.dragLook) {
      lookDX += e.clientX - lastX;
      lookDY += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
    }
  });

  const input = {
    dragLook: true,
    axis: { x: 0, y: 0 }, // virtual joystick on touch screens (x right, y forward)
    touchHeld: false,     // on-screen reel button
    get enabled() { return enabled; },
    set enabled(v) { enabled = v; if (!v) { held.clear(); mouseHeld = false; } },
    down: (code) => enabled && held.has(code),
    get mouseHeld() { return enabled && (mouseHeld || input.touchHeld); },
    on(code, fn) {
      if (!listeners.has(code)) listeners.set(code, []);
      listeners.get(code).push(fn);
      return () => listeners.set(code, listeners.get(code).filter((f) => f !== fn));
    },
    takeLook() {
      const d = [lookDX, lookDY];
      lookDX = lookDY = 0;
      return enabled ? d : [0, 0];
    },
    lockPointer() {
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.()?.catch?.(() => {});
    },
    unlockPointer() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
  };
  return input;
}
