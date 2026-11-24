// Música de fondo medieval generada al momento con Web Audio (sin archivos):
// bordón grave, arpa/laúd en arpegios, flauta que improvisa en modo dórico,
// tambor suave y mucha reverberación de "gran salón". Cada vuelta es distinta.

let ctx = null;
let master = null;
let reverb = null;
let timer = null;
let enabled = true;
let volume = 0.5;
try {
  enabled = localStorage.getItem('mtgvr-music') !== 'off';
  volume = parseFloat(localStorage.getItem('mtgvr-music-vol') || '0.5');
} catch { /* */ }

export const musicOn = () => enabled;
export const musicVolume = () => volume;

export function setMusic(v) {
  enabled = v;
  try { localStorage.setItem('mtgvr-music', v ? 'on' : 'off'); } catch { /* */ }
  if (v) startMusic();
  else stopMusic();
}

export function setMusicVolume(v) {
  volume = v;
  try { localStorage.setItem('mtgvr-music-vol', String(v)); } catch { /* */ }
  if (master) master.gain.setTargetAtTime(0.22 * v, ctx.currentTime, 0.3);
}

const BPM = 76;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
// Re dórico. Progresiones de cuatro compases (grados en semitonos desde Re).
const ROOT = 50; // Re3 (MIDI)
const PROGRESSIONS = [
  [[0, 3, 7], [-2, 2, 5], [-4, 0, 3], [-2, 2, 5]], // Rem – Do – Sib – Do
  [[0, 3, 7], [5, 9, 12], [-2, 2, 5], [0, 3, 7]], // Rem – Sol – Do – Rem
  [[0, 3, 7], [-5, -2, 2], [-4, 0, 3], [-5, -1, 2]], // Rem – Lam – Sib – La
  [[3, 7, 10], [-2, 2, 5], [0, 3, 7], [0, 3, 7]], // Fa – Do – Rem – Rem
];
const SCALE = [0, 2, 3, 5, 7, 9, 10]; // dórico
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

function setup() {
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return false;
  ctx = new C();
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  // Reverberación: respuesta al impulso de ruido que se apaga en ~3 s.
  reverb = ctx.createConvolver();
  const len = ctx.sampleRate * 3.2;
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6;
  }
  reverb.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.55;
  reverb.connect(wet).connect(master);
  return true;
}

/** Envía un sonido a la mezcla (seco + reverberación). */
function out(node, dry = 0.7) {
  const g = ctx.createGain();
  g.gain.value = dry;
  node.connect(g).connect(master);
  node.connect(reverb);
}

function pluck(midi, t, vol = 0.12, dur = 1.6) {
  // Arpa / laúd: triángulo + armónico, ataque rápido y caída larga.
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(3200, t);
  f.frequency.exponentialRampToValueAtTime(700, t + dur * 0.6);
  for (const [mult, type, v] of [[1, 'triangle', 1], [2, 'sine', 0.3], [3, 'sine', 0.12]]) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = hz(midi) * mult;
    const og = ctx.createGain();
    og.gain.value = v;
    o.connect(og).connect(f);
    o.start(t);
    o.stop(t + dur + 0.1);
  }
  f.connect(g);
  out(g, 0.6);
}

function drone(midis, t, dur) {
  // Bordón de cuerdas: dientes de sierra desafinados y filtrados, entrada lenta.
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.035, t + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.6);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 650;
  f.Q.value = 0.7;
  for (const m of midis) {
    for (const det of [-7, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz(m);
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.8);
    }
  }
  f.connect(g);
  out(g, 0.5);
}

function flute(midi, t, dur, vol = 0.05) {
  // Flauta: seno con vibrato que entra poco a poco y un soplo de ruido.
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.value = hz(midi);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.2;
  const lg = ctx.createGain();
  lg.gain.setValueAtTime(0, t);
  lg.gain.linearRampToValueAtTime(hz(midi) * 0.012, t + Math.min(0.5, dur));
  lfo.connect(lg).connect(o.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.08);
  g.gain.setValueAtTime(vol, t + dur * 0.75);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const o2 = ctx.createOscillator();
  o2.type = 'triangle';
  o2.frequency.value = hz(midi) * 2;
  const g2 = ctx.createGain();
  g2.gain.value = 0.08;
  o2.connect(g2).connect(g);
  o.connect(g);
  out(g, 0.55);
  for (const n of [o, o2, lfo]) { n.start(t); n.stop(t + dur + 0.1); }
}

function drum(t, vol = 0.22, pitch = 70) {
  // Tambor de piel: golpe grave que cae de tono.
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(pitch * 1.8, t);
  o.frequency.exponentialRampToValueAtTime(pitch * 0.6, t + 0.25);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  o.connect(g);
  out(g, 0.8);
  o.start(t);
  o.stop(t + 0.5);
}

let nextBar = 0;
let barIndex = 0;
let prog = PROGRESSIONS[0];
let melodyNote = 7; // grado actual de la flauta (índice en la escala extendida)

function scaleNote(i) {
  const oct = Math.floor(i / SCALE.length);
  return ROOT + 12 + oct * 12 + SCALE[((i % SCALE.length) + SCALE.length) % SCALE.length];
}

function scheduleBar(t) {
  if (barIndex % 4 === 0) prog = PROGRESSIONS[Math.floor(Math.random() * PROGRESSIONS.length)];
  const chord = prog[barIndex % 4];
  const section = Math.floor(barIndex / 8) % 3; // 0 calma, 1 con flauta, 2 con tambor
  drone([ROOT - 12 + chord[0], ROOT + chord[0], ROOT + chord[2]], t, BAR);
  // Arpegio de arpa en corcheas (con variaciones).
  const pattern = [0, 1, 2, 3, 2, 1, 2, 3];
  pattern.forEach((p, i) => {
    if (section === 0 && i % 2 === 1 && Math.random() < 0.5) return;
    const tones = [chord[0], chord[1], chord[2], chord[0] + 12];
    pluck(ROOT + 12 + tones[p], t + i * (BEAT / 2) + Math.random() * 0.012, i === 0 ? 0.11 : 0.075);
  });
  // Flauta improvisando: paseo aleatorio por la escala, con silencios.
  if (section >= 1) {
    let tt = t;
    while (tt < t + BAR - 0.01) {
      const len = [BEAT, BEAT, BEAT / 2, BEAT * 1.5, BEAT * 2][Math.floor(Math.random() * 5)];
      if (Math.random() > 0.22) {
        melodyNote += [-2, -1, -1, 1, 1, 2, 0][Math.floor(Math.random() * 7)];
        melodyNote = Math.max(2, Math.min(12, melodyNote));
        flute(scaleNote(melodyNote), tt, Math.min(len, t + BAR - tt) * 0.95);
      }
      tt += len;
    }
  }
  // Tambor de marcha.
  if (section === 2) {
    drum(t, 0.2);
    drum(t + BEAT * 1.5, 0.08, 90);
    drum(t + BEAT * 2, 0.15);
    drum(t + BEAT * 3.5, 0.08, 90);
  } else if (barIndex % 2 === 0) {
    drum(t, 0.1);
  }
  barIndex++;
}

function loop() {
  if (!ctx) return;
  while (nextBar < ctx.currentTime + 1.5) {
    scheduleBar(nextBar);
    nextBar += BAR;
  }
}

/** Empieza la música (hace falta que el usuario haya tocado la pantalla antes). */
export function startMusic() {
  if (!enabled) return;
  if (!ctx && !setup()) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  if (timer) return;
  nextBar = ctx.currentTime + 0.1;
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setTargetAtTime(0.22 * volume, ctx.currentTime, 1.2);
  timer = setInterval(loop, 250);
  loop();
}

export function stopMusic() {
  if (!ctx || !timer) return;
  clearInterval(timer);
  timer = null;
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
}

/** Baja la música un momento (p. ej. durante una explosión). */
export function duckMusic(ms = 700) {
  if (!ctx || !timer) return;
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setTargetAtTime(0.08 * volume, now, 0.05);
  master.gain.setTargetAtTime(0.22 * volume, now + ms / 1000, 0.5);
}

// Si la app pasa a segundo plano, silencio.
document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  if (document.hidden) ctx.suspend().catch(() => {});
  else if (timer) ctx.resume().catch(() => {});
});
