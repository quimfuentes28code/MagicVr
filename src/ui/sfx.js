// Efectos de sonido sintetizados con Web Audio (sin archivos de audio).

let ctx = null;
let enabled = true;
try { enabled = localStorage.getItem('mtgvr-sound') !== 'off'; } catch { /* */ }

export const soundOn = () => enabled;
export function setSound(v) {
  enabled = v;
  try { localStorage.setItem('mtgvr-sound', v ? 'on' : 'off'); } catch { /* */ }
}

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq, { t = 0, dur = 0.2, type = 'sine', vol = 0.15, slide = 0 } = {}) {
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  const start = a.currentTime + t;
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(a.destination);
  o.start(start);
  o.stop(start + dur + 0.05);
}

function noise({ t = 0, dur = 0.3, vol = 0.12, from = 400, to = 2400 } = {}) {
  const a = ac();
  if (!a) return;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  const start = a.currentTime + t;
  f.frequency.setValueAtTime(from, start);
  f.frequency.exponentialRampToValueAtTime(to, start + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(vol, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(start);
}

/** Explosión: estallido de ruido grave + golpe sub-grave. */
function boom() {
  const a = ac();
  if (!a) return;
  const dur = 1.1;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  const t0 = a.currentTime;
  f.frequency.setValueAtTime(2400, t0);
  f.frequency.exponentialRampToValueAtTime(120, t0 + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.5, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t0);
  tone(65, { dur: 0.6, type: 'sine', vol: 0.35, slide: 0.4 });
  tone(130, { dur: 0.25, type: 'triangle', vol: 0.15, slide: 0.3 });
}

const SOUNDS = {
  play: () => { tone(523, { dur: 0.25 }); tone(784, { t: 0.08, dur: 0.3 }); tone(1046, { t: 0.16, dur: 0.4, vol: 0.1 }); },
  land: () => { tone(196, { dur: 0.25, type: 'triangle', vol: 0.18 }); tone(294, { t: 0.05, dur: 0.3, type: 'triangle', vol: 0.1 }); },
  cast: () => noise({ dur: 0.45, from: 300, to: 3000 }),
  resolve: () => { tone(880, { dur: 0.3, type: 'triangle', vol: 0.1 }); tone(1318, { t: 0.06, dur: 0.35, vol: 0.06 }); },
  hit: () => { tone(110, { dur: 0.25, type: 'square', vol: 0.12, slide: 0.5 }); noise({ dur: 0.15, vol: 0.1, from: 200, to: 100 }); },
  death: () => { tone(330, { dur: 0.5, type: 'sawtooth', vol: 0.06, slide: 0.3 }); noise({ dur: 0.5, vol: 0.06, from: 1200, to: 200 }); },
  gain: () => { tone(660, { dur: 0.2, vol: 0.1 }); tone(990, { t: 0.1, dur: 0.3, vol: 0.08 }); },
  loss: () => tone(160, { dur: 0.35, type: 'square', vol: 0.1, slide: 0.6 }),
  attack: () => { noise({ dur: 0.5, vol: 0.12, from: 200, to: 1800 }); tone(70, { dur: 0.45, type: 'sawtooth', vol: 0.08, slide: 1.8 }); },
  explosion: () => { boom(); },
  turn: () => { tone(740, { dur: 0.6, type: 'triangle', vol: 0.09 }); tone(1110, { t: 0.02, dur: 0.7, vol: 0.05 }); },
  click: () => tone(1200, { dur: 0.05, type: 'square', vol: 0.04 }),
  warn: () => { tone(300, { dur: 0.15, type: 'square', vol: 0.08 }); tone(240, { t: 0.15, dur: 0.2, type: 'square', vol: 0.08 }); },
  win: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, { t: i * 0.14, dur: 0.5, type: 'triangle', vol: 0.12 })); },
  lose: () => { [392, 330, 262].forEach((f, i) => tone(f, { t: i * 0.2, dur: 0.5, type: 'sawtooth', vol: 0.06 })); },
  emote: () => { tone(988, { dur: 0.12, vol: 0.08 }); tone(1319, { t: 0.08, dur: 0.15, vol: 0.06 }); },
  dice: () => { for (let i = 0; i < 6; i++) noise({ t: i * 0.07, dur: 0.05, vol: 0.08, from: 2000, to: 800 }); },
};

export function sfx(name) {
  if (!enabled) return;
  try { SOUNDS[name] && SOUNDS[name](); } catch { /* sin audio */ }
}
