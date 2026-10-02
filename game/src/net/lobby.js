import { CONFIG } from '../config.js';

// The lobby socket: tells the server where we are ~8 times a second and hears about everyone else
// in our lobby. Reconnects on its own; the game keeps working single-player while it is down.

const GUEST_KEY = 'pp.guestId';

function guestId() {
  const fresh = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('');
  try {
    let id = localStorage.getItem(GUEST_KEY);
    if (!id) { id = fresh(); localStorage.setItem(GUEST_KEY, id); }
    return id;
  } catch {
    return fresh();
  }
}

function socketUrl() {
  if (CONFIG.apiUrl) return `${CONFIG.apiUrl.replace(/^http/, 'ws')}/ws`;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

// handlers: { welcome, join, leave, u, look, shout, disconnected }, each called with the message
export function createLobbyClient(handlers) {
  let ws = null;
  let active = false;
  let retry = 0;
  let timer = null;
  let hello = null;

  function open() {
    if (!active) return;
    try {
      ws = new WebSocket(socketUrl());
    } catch {
      schedule();
      return;
    }
    const sock = ws;
    sock.onopen = () => {
      retry = 0;
      sock.send(JSON.stringify({ t: 'hello', guest: guestId(), ...hello() }));
    };
    sock.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      handlers[msg.t]?.(msg);
    };
    sock.onclose = () => {
      if (ws === sock) ws = null;
      handlers.disconnected?.();
      schedule();
    };
    sock.onerror = () => {};
  }

  function schedule() {
    if (!active) return;
    clearTimeout(timer);
    timer = setTimeout(open, Math.min(15_000, 1000 * 2 ** retry++));
  }

  return {
    // getHello() returns { token?, outfit, rod, s } at the moment the socket opens
    connect(getHello) {
      hello = getHello;
      if (active) return;
      active = true;
      retry = 0;
      open();
    },
    disconnect() {
      active = false;
      clearTimeout(timer);
      const sock = ws;
      ws = null;
      if (sock) { sock.onclose = null; sock.close(); }
      handlers.disconnected?.();
    },
    // true if it went out
    send(msg) {
      if (ws?.readyState !== 1) return false;
      ws.send(JSON.stringify(msg));
      return true;
    },
    get connected() { return ws?.readyState === 1; },
  };
}
