// Hechizos visibles: cada color de Magic lanza su propia magia hacia el objetivo.
//   Negro → rayo morado   Rojo → bola de fuego   Azul → torrente de agua
//   Blanco → haz de luz   Verde → enredadera de hojas   Incoloro → esquirlas arcanas
// Multicolor: mezcla los colores de la carta.

const PALETTE = {
  W: ['#fff6c8', '#ffd76a'],
  U: ['#bfe9ff', '#2f8cff'],
  B: ['#e2b6ff', '#8a2be2'],
  R: ['#ffe08a', '#ff4d1a'],
  G: ['#d8ffb0', '#3fbf3f'],
  C: ['#f0f0ff', '#a9b4c8'],
};

const center = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, size: Math.max(r.width, r.height) };
};

function el(cls, style = {}) {
  const d = document.createElement('div');
  d.className = cls;
  Object.assign(d.style, style);
  return d;
}

/**
 * Lanza la magia de `colors` desde `fromEl` hasta `toEl`. Llama a onImpact al llegar.
 * Devuelve la duración del viaje (ms).
 */
export function castMagic(layer, colors, fromEl, toEl, onImpact) {
  if (!toEl || !toEl.isConnected) return 0;
  const to = center(toEl);
  const from = fromEl && fromEl.isConnected ? center(fromEl) : { x: to.x, y: window.innerHeight + 40 };
  const main = colors[0] || 'C';
  const beam = main === 'B' || main === 'W';
  const dur = beam ? 420 : 750;
  if (beam) castBeam(layer, colors, from, to, dur);
  else castOrb(layer, colors, from, to, dur);
  setTimeout(() => {
    impact(layer, colors, to);
    onImpact && onImpact();
  }, dur);
  return dur;
}

/** Rayo (negro) o haz de luz (blanco): una línea que se extiende de golpe. */
function castBeam(layer, colors, from, to, dur) {
  const c = colors[0];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  const beam = el(`mg-beam mg-beam-${c}`, {
    left: from.x + 'px', top: from.y + 'px', width: len + 'px',
    transform: `rotate(${ang}rad)`,
  });
  paint(beam, colors);
  layer.append(beam);
  beam.animate([
    { clipPath: 'inset(0 100% 0 0)', opacity: 1 },
    { clipPath: 'inset(0 0 0 0)', opacity: 1, offset: 0.7 },
    { clipPath: 'inset(0 0 0 0)', opacity: 0.9 },
  ], { duration: dur, easing: 'cubic-bezier(.5,0,.8,.6)', fill: 'forwards' });
  setTimeout(() => beam.animate([{ opacity: 1 }, { opacity: 0, transform: `rotate(${ang}rad) scaleY(2.5)` }], { duration: 380, fill: 'forwards' }), dur);
  setTimeout(() => beam.remove(), dur + 420);
  // chispas a lo largo del rayo
  for (let i = 0; i < 10; i++) {
    const t = Math.random();
    setTimeout(() => spark(layer, c, from.x + dx * t, from.y + dy * t, 30), dur * t);
  }
}

/** Bola de fuego / torrente de agua / enredadera / esquirlas: un proyectil en arco con estela. */
function castOrb(layer, colors, from, to, dur) {
  const c = colors[0];
  const orb = el(`mg-orb mg-orb-${c}`);
  paint(orb, colors);
  layer.append(orb);
  // arco: el punto medio se levanta perpendicular a la trayectoria
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = c === 'U' ? 0.08 : c === 'G' ? 0.22 : 0.15;
  const cx = mx - (dy / len) * len * bend;
  const cy = my + (dx / len) * len * bend * (dy < 0 ? 1 : -1);
  const at = (t) => ({
    x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * cx + t * t * to.x,
    y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * cy + t * t * to.y,
  });
  const t0 = performance.now();
  let last = 0;
  const step = (now) => {
    const t = Math.min(1, (now - t0) / dur);
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const p = at(e);
    orb.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) rotate(${t * 720}deg)`;
    if (now - last > 14) {
      last = now;
      trail(layer, colors[Math.floor(Math.random() * colors.length)], p.x, p.y);
    }
    if (t < 1) requestAnimationFrame(step);
    else orb.remove();
  };
  requestAnimationFrame(step);
}

function trail(layer, c, x, y) {
  const shape = { R: 'flame', U: 'drop', G: 'leaf', C: 'shard', W: 'mote', B: 'mote' }[c] || 'mote';
  const p = el(`mg-trail mg-trail-${shape}`, { left: x + 'px', top: y + 'px' });
  p.style.setProperty('--light', PALETTE[c][0]);
  p.style.setProperty('--deep', PALETTE[c][1]);
  p.style.setProperty('--dx', (Math.random() - 0.5) * 30 + 'px');
  p.style.setProperty('--dy', (c === 'R' ? -20 : c === 'U' ? 18 : (Math.random() - 0.5) * 24) + 'px');
  p.style.setProperty('--rot', Math.random() * 360 + 'deg');
  layer.append(p);
  setTimeout(() => p.remove(), 700);
}

function spark(layer, c, x, y, spread) {
  const p = el('mg-trail mg-trail-mote', { left: x + 'px', top: y + 'px' });
  p.style.setProperty('--light', PALETTE[c][0]);
  p.style.setProperty('--deep', PALETTE[c][1]);
  p.style.setProperty('--dx', (Math.random() - 0.5) * spread + 'px');
  p.style.setProperty('--dy', (Math.random() - 0.5) * spread + 'px');
  layer.append(p);
  setTimeout(() => p.remove(), 700);
}

/** Impacto: anillo y estallido con la forma de cada color. */
function impact(layer, colors, at) {
  const c = colors[0];
  const size = Math.max(90, at.size * 1.5);
  const ring = el(`mg-impact mg-impact-${c}`, { left: at.x + 'px', top: at.y + 'px', width: size + 'px', height: size + 'px' });
  paint(ring, colors);
  layer.append(ring);
  setTimeout(() => ring.remove(), 900);
  const n = 22;
  for (let i = 0; i < n; i++) {
    const col = colors[i % colors.length];
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.3;
    const d = size * (0.35 + Math.random() * 0.5);
    const shape = { R: 'flame', U: 'drop', G: 'leaf', C: 'shard', W: 'mote', B: 'mote' }[col] || 'mote';
    const p = el(`mg-trail mg-trail-${shape} big`, { left: at.x + 'px', top: at.y + 'px' });
    p.style.setProperty('--light', PALETTE[col][0]);
    p.style.setProperty('--deep', PALETTE[col][1]);
    p.style.setProperty('--dx', Math.cos(a) * d + 'px');
    p.style.setProperty('--dy', Math.sin(a) * d + 'px');
    p.style.setProperty('--rot', Math.random() * 360 + 'deg');
    layer.append(p);
    setTimeout(() => p.remove(), 800);
  }
}

function paint(node, colors) {
  const c = colors[0] || 'C';
  node.style.setProperty('--light', PALETTE[c][0]);
  node.style.setProperty('--deep', PALETTE[c][1]);
  node.style.setProperty('--grad', colors.length > 1 ? mixDeep(colors) : `linear-gradient(90deg, ${PALETTE[c][1]}, ${PALETTE[c][0]})`);
}

function mixDeep(colors) {
  if (colors.length < 2) return PALETTE[colors[0] || 'C'][1];
  return `linear-gradient(90deg, ${colors.map((c) => PALETTE[c][1]).join(', ')})`;
}

export const magicColor = (c) => PALETTE[c] || PALETTE.C;
