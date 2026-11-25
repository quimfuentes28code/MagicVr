// Detección automática de la superficie de la mesa (su perspectiva) a partir de
// una imagen de la cámara. Las líneas de la mesa (bordes, vetas de la madera,
// tapete, bordes de cartas…) que en la realidad son paralelas, en la imagen se
// juntan en un punto de fuga. Con ese punto se calcula el trapecio en el que se
// ve la mesa, y el tablero se coloca encima con esa misma perspectiva.
//
// detectSurface(gray, W, H) → { quad, vp, lines, confidence, method } | { topDown: true }
//   quad: 4 esquinas (0..1 de la imagen): arriba-izq, arriba-der, abajo-der, abajo-izq.

const TAU = Math.PI;

/** Sobel: magnitud y orientación del gradiente. */
function gradients(g, W, H) {
  const mag = new Float32Array(W * H);
  const ang = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = -g[i - W - 1] - 2 * g[i - 1] - g[i + W - 1] + g[i - W + 1] + 2 * g[i + 1] + g[i + W + 1];
      const gy = -g[i - W - 1] - 2 * g[i - W] - g[i - W + 1] + g[i + W - 1] + 2 * g[i + W] + g[i + W + 1];
      mag[i] = Math.hypot(gx, gy);
      ang[i] = Math.atan2(gy, gx);
    }
  }
  return { mag, ang };
}

/**
 * Transformada de Hough con la orientación del gradiente (cada píxel de borde vota
 * sólo por las rectas casi perpendiculares a su gradiente). Devuelve las rectas más votadas.
 */
function houghLines(g, W, H, maxLines = 40) {
  const { mag, ang } = gradients(g, W, H);
  // umbral: el 10 % de los píxeles con más contraste
  const sample = [];
  for (let i = 0; i < mag.length; i += 7) sample.push(mag[i]);
  sample.sort((a, b) => a - b);
  const thr = Math.max(40, sample[Math.floor(sample.length * 0.9)] || 0);
  const NT = 180;
  const diag = Math.hypot(W, H);
  const NR = Math.ceil(diag * 2) + 1;
  const acc = new Float32Array(NT * NR);
  const cosT = new Float32Array(NT);
  const sinT = new Float32Array(NT);
  for (let t = 0; t < NT; t++) { cosT[t] = Math.cos((t * TAU) / NT); sinT[t] = Math.sin((t * TAU) / NT); }
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      const i = y * W + x;
      if (mag[i] < thr) continue;
      // la normal de la recta es la dirección del gradiente
      let th = ang[i];
      if (th < 0) th += TAU;
      if (th >= TAU) th -= TAU;
      const t0 = Math.round((th / TAU) * NT);
      for (let dt = -3; dt <= 3; dt++) {
        const t = (t0 + dt + NT) % NT;
        const r = Math.round(x * cosT[t] + y * sinT[t] + diag);
        acc[t * NR + r] += 1;
      }
    }
  }
  // picos (supresión de no máximos en una ventana)
  const peaks = [];
  for (let t = 0; t < NT; t++) {
    for (let r = 1; r < NR - 1; r++) {
      const v = acc[t * NR + r];
      if (v < Math.max(W, H) * 0.12) continue;
      let isMax = true;
      for (let dt = -4; dt <= 4 && isMax; dt++) {
        for (let dr = -6; dr <= 6; dr++) {
          if (!dt && !dr) continue;
          const tt = (t + dt + NT) % NT;
          const rr = r + dr;
          if (rr < 0 || rr >= NR) continue;
          if (acc[tt * NR + rr] > v) { isMax = false; break; }
        }
      }
      if (isMax) peaks.push({ theta: (t * TAU) / NT, rho: r - diag, votes: v });
    }
  }
  peaks.sort((a, b) => b.votes - a.votes);
  return peaks.slice(0, maxLines);
}

/** Intersección de dos rectas (forma normal x·cosθ + y·sinθ = ρ). */
function intersect(a, b) {
  const det = Math.cos(a.theta) * Math.sin(b.theta) - Math.sin(a.theta) * Math.cos(b.theta);
  if (Math.abs(det) < 1e-6) return null;
  const x = (a.rho * Math.sin(b.theta) - b.rho * Math.sin(a.theta)) / det;
  const y = (b.rho * Math.cos(a.theta) - a.rho * Math.cos(b.theta)) / det;
  return [x, y];
}

/** Ángulo (0..180) de la dirección de la recta respecto a la horizontal. */
const dirDeg = (l) => {
  let d = ((l.theta + Math.PI / 2) * 180) / Math.PI;
  d %= 180;
  if (d < 0) d += 180;
  return d;
};

/** ¿Pasa la recta cerca del punto (en ángulo, visto desde el centro de la imagen)? */
function supports(l, p, W, H) {
  // distancia del punto a la recta, relativa a la distancia del punto a la imagen
  const d = Math.abs(p[0] * Math.cos(l.theta) + p[1] * Math.sin(l.theta) - l.rho);
  const far = Math.hypot(p[0] - W / 2, p[1] - H / 2);
  return d / Math.max(far, H) < 0.035;
}

/**
 * Punto de fuga de las rectas que «se alejan» (no horizontales): el que reúne más
 * votos entre las intersecciones de pares de rectas. Debe estar por encima del centro.
 */
function vanishingPoint(lines, W, H) {
  const rec = lines.filter((l) => { const d = dirDeg(l); return d > 18 && d < 162; });
  if (rec.length < 2) return null;
  let best = null;
  for (let i = 0; i < rec.length; i++) {
    for (let j = i + 1; j < rec.length; j++) {
      // las dos rectas tienen que inclinarse hacia lados distintos o tener distinta inclinación
      if (Math.abs(dirDeg(rec[i]) - dirDeg(rec[j])) < 4) continue;
      const p = intersect(rec[i], rec[j]);
      if (!p) continue;
      if (p[1] > H * 0.45) continue; // la mesa se aleja hacia arriba
      if (p[1] < -H * 12 || Math.abs(p[0] - W / 2) > W * 4) continue;
      let score = 0;
      let n = 0;
      let spread = [Infinity, -Infinity];
      for (const l of rec) {
        if (supports(l, p, W, H)) {
          score += l.votes; n++;
          const d = dirDeg(l);
          spread = [Math.min(spread[0], d), Math.max(spread[1], d)];
        }
      }
      if (n >= 2 && (!best || score > best.score)) best = { p, score, n, spread: spread[1] - spread[0] };
    }
  }
  return best;
}

/**
 * Detecta la mesa. gray: Float32Array (W×H, 0..255).
 * opts.pitch: inclinación de la cámara en grados (0 = mirando hacia abajo), si se sabe por los sensores.
 */
export function detectSurface(gray, W, H, opts = {}) {
  const lines = houghLines(gray, W, H);
  const totalVotes = lines.reduce((a, l) => a + l.votes, 0) || 1;
  const vp = vanishingPoint(lines, W, H);
  let p = null;
  let confidence = 0;
  let method = 'lines';
  if (vp && vp.n >= 3 && vp.spread > 12) {
    p = vp.p;
    confidence = Math.min(1, (vp.score / totalVotes) * 1.6) * Math.min(1, vp.n / 5);
  }
  if ((!p || confidence < 0.25) && opts.pitch != null && opts.pitch > 8 && opts.pitch < 80) {
    // por los sensores: punto de fuga de la mesa a partir de la inclinación de la cámara
    const hfov = ((opts.hfov || 62) * Math.PI) / 180;
    const f = W / 2 / Math.tan(hfov / 2);
    p = [W / 2, H / 2 - f / Math.tan((opts.pitch * Math.PI) / 180)];
    confidence = 0.6;
    method = 'sensor';
  }
  if (!p || confidence < 0.2) {
    // sin líneas que converjan: la cámara mira la mesa desde arriba (o no hay bordes claros)
    return { topDown: true, lines, confidence: 1 - confidence };
  }
  // Trapecio: la base en el borde inferior de la imagen y los lados hacia el punto de fuga.
  const vx = p[0] / W;
  const vy = p[1] / H;
  const yTop = Math.max(0.04, Math.min(0.3, vy + (1 - vy) * 0.1));
  const along = (bx) => vx + (bx - vx) * ((yTop - vy) / (1 - vy));
  const quad = [[along(0), yTop], [along(1), yTop], [1, 1], [0, 1]];
  return { quad, vp: [vx, vy], lines, confidence, method };
}

export { houghLines, vanishingPoint };
