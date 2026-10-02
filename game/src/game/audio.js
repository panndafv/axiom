// Every sound is synthesized with WebAudio, so the game needs no audio files.

let ctx = null;
let master = null;
let ambience = null;
let muted = false;
let volume = 0.7;

try {
  muted = localStorage.getItem('pp.muted') === '1';
  volume = Number(localStorage.getItem('pp.volume') ?? 0.7);
} catch { /* storage blocked */ }

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : volume;
  master.connect(ctx.destination);
  return ctx;
}

function noiseBuffer(seconds = 1) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02; // brown-ish
    d[i] = last * 3.5;
  }
  return buf;
}

function tone(freq, dur, { type = 'sine', gain = 0.2, to = null, delay = 0, attack = 0.005 } = {}) {
  if (!ensure()) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, { gain = 0.3, freq = 1200, q = 0.8, to = null, delay = 0, type = 'bandpass' } = {}) {
  if (!ensure()) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(dur + 0.05);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

function startAmbience() {
  if (ambience || !ensure()) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(4);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 420;
  const g = ctx.createGain();
  g.gain.value = 0.05;
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.12;
  lfoGain.gain.value = 0.03;
  lfo.connect(lfoGain).connect(g.gain);
  src.connect(f).connect(g).connect(master);
  src.start();
  lfo.start();
  ambience = src;
}

export const sfx = {
  unlock() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    startAmbience();
  },
  get muted() { return muted; },
  get volume() { return volume; },
  setMuted(m) {
    muted = m;
    try { localStorage.setItem('pp.muted', m ? '1' : '0'); } catch { /* ignore */ }
    if (master) master.gain.value = m ? 0 : volume;
  },
  setVolume(v) {
    volume = v;
    try { localStorage.setItem('pp.volume', String(v)); } catch { /* ignore */ }
    if (master && !muted) master.gain.value = v;
  },
  click() { tone(660, 0.06, { type: 'square', gain: 0.05 }); },
  hover() { tone(880, 0.03, { type: 'square', gain: 0.025 }); },
  open() { tone(520, 0.08, { type: 'triangle', gain: 0.08 }); tone(780, 0.1, { type: 'triangle', gain: 0.07, delay: 0.05 }); },
  error() { tone(220, 0.16, { type: 'square', gain: 0.06 }); tone(165, 0.2, { type: 'square', gain: 0.06, delay: 0.08 }); },
  cast() { noise(0.35, { gain: 0.25, freq: 600, to: 2400, q: 1.2 }); },
  plop() { tone(520, 0.14, { gain: 0.22, to: 140 }); noise(0.18, { gain: 0.18, freq: 900, delay: 0.02 }); },
  bite() {
    tone(380, 0.1, { gain: 0.25, to: 120 });
    tone(380, 0.1, { gain: 0.25, to: 120, delay: 0.14 });
    tone(1320, 0.18, { type: 'triangle', gain: 0.12, delay: 0.05 });
  },
  reelTick() { tone(1800 + Math.random() * 300, 0.025, { type: 'square', gain: 0.025 }); },
  splash() { noise(0.4, { gain: 0.3, freq: 1400, to: 400, q: 0.6 }); },
  snap() {
    noise(0.12, { gain: 0.5, freq: 3000, q: 0.5, type: 'highpass' });
    tone(1600, 0.25, { type: 'sawtooth', gain: 0.08, to: 200 });
    tone(90, 0.3, { gain: 0.3, to: 50 });
  },
  escape() { tone(440, 0.2, { type: 'triangle', gain: 0.1, to: 220 }); },
  land(rarityOrder = 0) {
    const base = [523, 587, 659, 784, 880, 1047][rarityOrder] || 523;
    const steps = 3 + rarityOrder;
    for (let i = 0; i < steps; i++) tone(base * Math.pow(1.122, i * 2), 0.18, { type: 'triangle', gain: 0.1, delay: i * 0.07 });
    noise(0.3, { gain: 0.15, freq: 1600 });
  },
  bank() {
    [988, 1319, 1568, 1976].forEach((f, i) => tone(f, 0.16, { type: 'square', gain: 0.045, delay: i * 0.06 }));
  },
  coins() {
    for (let i = 0; i < 5; i++) tone(1400 + Math.random() * 900, 0.08, { type: 'square', gain: 0.03, delay: i * 0.045 });
  },
  oilOut() { [392, 330, 262].forEach((f, i) => tone(f, 0.5, { type: 'triangle', gain: 0.1, delay: i * 0.18 })); },
};
