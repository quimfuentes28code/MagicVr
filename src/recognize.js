// Reconocimiento de cartas por imagen (sin OCR):
//  1) localiza el rectángulo de la carta dentro del círculo por sus bordes,
//  2) la endereza,
//  3) calcula su huella (330 bits: tras un paso alto, si cada zona es más clara que la de su derecha),
//  4) la compara con la huella de las ~50.000 ilustraciones de Magic (public/cardhash.bin).
// Identifica la ilustración exacta, así que también da la edición (en español si existe).
// Los mismos cálculos están en scripts/build-cardhash.py (deben coincidir).

export const ASPECT = 63 / 88;
// Región interior de la carta (sin el borde) y rejilla de la huella.
const INNER = [0.055, 0.04, 0.945, 0.96];
const GW = 16;
const GH = 22;
const NW = 128; // tamaño normalizado del interior (bloques de 8x8)
const NH = 176;
export const BITS = (GW - 1) * GH; // 330
export const WORDS = Math.ceil(BITS / 32); // 11

// ------------------------------------------------------------- localizar

function sobel(g, W, H) {
  const gx = new Float32Array(W * H);
  const gy = new Float32Array(W * H);
  const at = (x, y) => g[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      gx[i] = (at(x + 1, y) - at(x - 1, y)) * 2 + (at(x + 1, y - 1) - at(x - 1, y - 1)) + (at(x + 1, y + 1) - at(x - 1, y + 1));
      gy[i] = (at(x, y + 1) - at(x, y - 1)) * 2 + (at(x - 1, y + 1) - at(x - 1, y - 1)) + (at(x + 1, y + 1) - at(x + 1, y - 1));
    }
  }
  return { gx, gy };
}

function bil(img, W, H, x, y) {
  if (x < 0) x = 0; else if (x > W - 1.001) x = W - 1.001;
  if (y < 0) y = 0; else if (y > H - 1.001) y = H - 1.001;
  const x0 = x | 0;
  const y0 = y | 0;
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * W + x0;
  return img[i] * (1 - fx) * (1 - fy) + img[i + 1] * fx * (1 - fy) + img[i + W] * (1 - fx) * fy + img[i + W + 1] * fx * fy;
}

const tsamples = (n) => Array.from({ length: n }, (_, i) => 0.12 + (0.76 * i) / (n - 1));
const T20 = tsamples(20);
const T10 = tsamples(10);
const BAND3 = [0.005, 0.0115, 0.018];
const BAND1 = [0.0115];
// lados: punto medio relativo, dirección, longitud (w/h), hacia dentro
const SIDES = [
  [0, -0.5, 1, 0, 'w', 0, 1],
  [0, 0.5, 1, 0, 'w', 0, -1],
  [-0.5, 0, 0, 1, 'h', 1, 0],
  [0.5, 0, 0, 1, 'h', -1, 0],
];

function rectScore(F, cx, cy, h, ang, T = T20, BAND = BAND3) {
  const { gx, gy, gm, W, H } = F;
  const NT = T.length;
  const w = h * ASPECT;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  let logSum = 0;
  let bandSum = 0;
  for (const [mx, my, ax, ay, L, inx, iny] of SIDES) {
    const len = L === 'w' ? w : h;
    const nx = -ay;
    const ny = ax;
    const NX = nx * c - ny * s;
    const NY = nx * s + ny * c;
    let edge = 0;
    let band = 0;
    for (let k = 0; k < NT; k++) {
      const tt = (T[k] - 0.5) * len;
      const px = mx * w + ax * tt;
      const py = my * h + ay * tt;
      const X = cx + px * c - py * s;
      const Y = cy + px * s + py * c;
      edge += Math.abs(bil(gx, W, H, X, Y) * NX + bil(gy, W, H, X, Y) * NY);
      // franja lisa por dentro del borde (el marco de la carta)
      for (const f of BAND) {
        const d = f * h;
        const qx = px + inx * d;
        const qy = py + iny * d;
        band += bil(gm, W, H, cx + qx * c - qy * s, cy + qx * s + qy * c);
      }
    }
    edge /= NT;
    logSum += Math.log(edge + 1e-3);
    bandSum += band / (NT * BAND.length);
  }
  const e = Math.exp(logSum / 4);
  const b = bandSum / 4;
  return e / (1 + b / (e + 1e-3));
}

/**
 * Localiza la carta en una imagen en gris (Float32Array W×H, ~200 px de alto).
 * hint: { cx, cy, h, ang } de la lectura anterior (búsqueda local, más rápida).
 * Devuelve { cx, cy, h, ang, score } en píxeles de esa imagen.
 */
export function locateCard(g, W, H, hint = null) {
  const { gx, gy } = sobel(g, W, H);
  const gm = new Float32Array(W * H);
  for (let i = 0; i < gm.length; i++) gm[i] = Math.hypot(gx[i], gy[i]);
  const F = { gx, gy, gm, W, H };
  // versión a media resolución para la búsqueda gruesa (mucho más rápida)
  const W2 = W >> 1;
  const H2 = H >> 1;
  const g2 = new Float32Array(W2 * H2);
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
    const i = 2 * y * W + 2 * x;
    g2[y * W2 + x] = (g[i] + g[i + 1] + g[i + W] + g[i + W + 1]) / 4;
  }
  const s2 = sobel(g2, W2, H2);
  const gm2 = new Float32Array(W2 * H2);
  for (let i = 0; i < gm2.length; i++) gm2[i] = Math.hypot(s2.gx[i], s2.gy[i]);
  const F2 = { gx: s2.gx, gy: s2.gy, gm: gm2, W: W2, H: H2 };
  let cands = [];
  if (hint) {
    for (let da = -2; da <= 2; da++) for (let dh = -2; dh <= 2; dh++) for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) {
      cands.push([hint.cx + dx * 2.5, hint.cy + dy * 2.5, hint.h * (1 + dh * 0.025), hint.ang + (da * 1.5 * Math.PI) / 180]);
    }
  } else {
    for (let a = -12; a <= 12; a += 3) {
      const ang = (a * Math.PI) / 180;
      for (let hf = 0.3; hf < 0.92; hf += 0.04) {
        for (let cyf = 0.3; cyf < 0.711; cyf += 0.025) {
          for (let cxf = 0.3; cxf < 0.711; cxf += 0.025) cands.push([cxf * W, cyf * H, hf * H, ang]);
        }
      }
    }
  }
  let scored = hint
    ? cands.map((p) => [rectScore(F, ...p), p])
    : cands.map((p) => [rectScore(F2, p[0] / 2, p[1] / 2, p[2] / 2, p[3], T10, BAND1), p]);
  const max = Math.max(...scored.map((x) => x[0]));
  const starts = [];
  if (hint) {
    starts.push(scored.sort((a, b) => b[0] - a[0]).slice(0, 4).map((x) => x[1]));
  } else {
    // 1) el rectángulo más grande con buena puntuación (el borde exterior, no el marco de la ilustración)
    const ok = scored.filter((x) => x[0] >= 0.72 * max);
    ok.sort((a, b) => Math.round(b[1][2] / (0.04 * H)) - Math.round(a[1][2] / (0.04 * H)) || b[0] - a[0]);
    starts.push(ok.slice(0, 8).map((x) => x[1]));
    // 2) otras propuestas distintas, de mejor a peor puntuación (por si el grande era otra cosa)
    scored.sort((a, b) => b[0] - a[0]);
    const picked = [];
    for (const [, p] of scored) {
      if (picked.length >= 7) break;
      // misma posición y tamaño = mismo «sitio»; como mucho 2 variantes (giros) por sitio
      const samePlace = (q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= 0.06 * H && Math.abs(p[2] - q[2]) <= 0.08 * q[2];
      const all = [starts[0][0], ...picked];
      const twins = all.filter(samePlace);
      if (twins.length >= 2 || twins.some((q) => Math.abs(p[3] - q[3]) <= 0.05)) continue;
      picked.push(p);
    }
    for (const p of picked) starts.push([p]);
  }
  const results = starts.map((top, si) => {
    let sc = null;
    // la propuesta principal se ajusta a fondo; las alternativas, más por encima (más rápido)
    const stages = si === 0 ? [[4, 0.02, 1.5], [1.5, 0.008, 0.5], [0.6, 0.003, 0.2]] : [[3, 0.015, 1.2], [1, 0.005, 0.4]];
    for (const [dp, dhf, da] of stages) {
      const dh = dhf * H;
      const rad = (da * Math.PI) / 180;
      const cs = [];
      for (const [cx, cy, h, ang] of top) {
        for (let ax = -1; ax <= 1; ax++) for (let ay = -1; ay <= 1; ay++) for (let ah = -1; ah <= 1; ah++) for (let aa = -1; aa <= 1; aa++) {
          cs.push([cx + ax * dp, cy + ay * dp, h + ah * dh, ang + aa * rad]);
        }
      }
      sc = cs.map((p) => [rectScore(F, ...p), p]).sort((a, b) => b[0] - a[0]);
      top = sc.slice(0, 4).map((x) => x[1]);
    }
    const [cx, cy, h, ang] = top[0];
    return { cx, cy, h, ang, score: sc[0][0] };
  });
  const best = results[0];
  best.alts = results.slice(1).filter((r) => Math.abs(r.h - best.h) > 0.03 * H || Math.hypot(r.cx - best.cx, r.cy - best.cy) > 0.03 * H || Math.abs(r.ang - best.ang) > 0.035);
  return best;
}

// ------------------------------------------------------------- huella

/** Huella a partir del interior normalizado de la carta (gris NW×NH). */
export function hashFromInner(gray) {
  const bw = NW / GW;
  const bh = NH / GH;
  const cell = new Float32Array(GW * GH);
  for (let gyi = 0; gyi < GH; gyi++) {
    for (let gxi = 0; gxi < GW; gxi++) {
      let s = 0;
      for (let y = gyi * bh; y < (gyi + 1) * bh; y++) for (let x = gxi * bw; x < (gxi + 1) * bw; x++) s += gray[y * NW + x];
      cell[gyi * GW + gxi] = s;
    }
  }
  // Paso alto: a cada zona le restamos la media de su entorno 3x3. Así los cambios
  // suaves de luz (reflejos de la funda, sombras, luz amarilla) no cambian la huella.
  const hp = new Float32Array(GW * GH);
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(GH - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) s += cell[yy * GW + Math.min(GW - 1, Math.max(0, x + dx))];
      }
      hp[y * GW + x] = cell[y * GW + x] - s / 9;
    }
  }
  // Dos huellas: [0..10] clásica (tolera mejor un encuadre imperfecto) y
  // [11..21] de paso alto (tolera la luz). Se usan juntas.
  const out = new Uint32Array(2 * WORDS);
  [cell, hp].forEach((src, k) => {
    let b = 0;
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW - 1; x++, b++) {
        if (src[y * GW + x + 1] > src[y * GW + x]) out[k * WORDS + (b >> 5)] |= 1 << (b & 31);
      }
    }
  });
  return out;
}

/**
 * Endereza la carta localizada (en coordenadas de `source`) y devuelve su
 * interior en gris NW×NH. dx, dy, ds: pequeños desplazamientos (fracción) para tolerar errores.
 */
export function innerGray(source, cx, cy, h, ang, dx = 0, dy = 0, ds = 1, ax = 1) {
  if (source && source.g) return innerGraySampled(source, cx, cy, h, ang, dx, dy, ds, ax);
  const w = h * ASPECT * ax;
  const c = document.createElement('canvas');
  c.width = NW;
  c.height = NH;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  // del lienzo (interior normalizado) a la imagen: centro → rotación → escala
  const iw = (INNER[2] - INNER[0]) * w * ds;
  const ih = (INNER[3] - INNER[1]) * h * ds;
  const ox = ((INNER[0] + INNER[2]) / 2 - 0.5) * w + dx * w;
  const oy = ((INNER[1] + INNER[3]) / 2 - 0.5) * h + dy * h;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(NW / 2, NH / 2);
  ctx.scale(NW / iw, NH / ih);
  ctx.translate(-ox, -oy);
  ctx.rotate(-ang);
  ctx.translate(-cx, -cy);
  ctx.drawImage(source, 0, 0);
  const d = ctx.getImageData(0, 0, NW, NH).data;
  const g = new Float32Array(NW * NH);
  for (let i = 0; i < g.length; i++) g[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  return g;
}

/**
 * Igual que innerGray pero muestreando a mano una imagen en gris { g, W, H }
 * (sin canvas: sirve dentro de un Web Worker y es más rápido). 2x2 muestras por píxel.
 */
function half(g, W, H) {
  const W2 = W >> 1;
  const H2 = H >> 1;
  const out = new Float32Array(W2 * H2);
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
    const i = 2 * y * W + 2 * x;
    out[y * W2 + x] = (g[i] + g[i + 1] + g[i + W] + g[i + W + 1]) / 4;
  }
  return { g: out, W: W2, H: H2 };
}

const SS = 1;
export function innerGraySampled(src0, cx, cy, h, ang, dx = 0, dy = 0, ds = 1, ax = 1) {
  // pirámide: muestreamos del nivel en el que la carta mide entre 1 y 2 veces la huella
  // (si no, el muestreo simple «pierde» detalle de forma irregular)
  let src = src0;
  let f = 1;
  const need = ((INNER[3] - INNER[1]) * h * ds) / NH;
  src0.levels ||= [src0];
  let li = 0;
  while (need / f >= 2 && src.W >= 64) {
    li++;
    if (!src0.levels[li]) src0.levels[li] = half(src0.levels[li - 1].g, src0.levels[li - 1].W, src0.levels[li - 1].H);
    src = src0.levels[li];
    f *= 2;
  }
  if (f > 1) { cx /= f; cy /= f; h /= f; }
  const { g, W, H } = src;
  const w = h * ASPECT * ax;
  const iw = (INNER[2] - INNER[0]) * w * ds;
  const ih = (INNER[3] - INNER[1]) * h * ds;
  const ox = ((INNER[0] + INNER[2]) / 2 - 0.5) * w + dx * w;
  const oy = ((INNER[1] + INNER[3]) / 2 - 0.5) * h + dy * h;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const out = new Float32Array(NW * NH);
  const su = iw / NW;
  const sv = ih / NH;
  for (let v = 0; v < NH; v++) {
    for (let u = 0; u < NW; u++) {
      let acc = 0;
      for (let k = 0; k < SS * SS; k++) {
        // posición en la carta (centrada) → rotación → imagen (SS×SS muestras por píxel)
        const px = ((u + (1 + 2 * (k % SS)) / (2 * SS)) * su) - iw / 2 + ox;
        const py = ((v + (1 + 2 * Math.floor(k / SS)) / (2 * SS)) * sv) - ih / 2 + oy;
        // (coordenadas de imagen: el centro del píxel i está en i + 0,5)
        acc += bil(g, W, H, cx + px * c - py * s - 0.5, cy + px * s + py * c - 0.5);
      }
      out[v * NW + u] = acc / (SS * SS);
    }
  }
  return out;
}

/** RGBA (ImageData) → gris. */
export function grayFromRGBA(data, W, H) {
  const g = new Float32Array(W * H);
  for (let i = 0; i < g.length; i++) g[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  return g;
}

/** Reduce una imagen en gris a `H2` de alto promediando por áreas. */
export function downscaleGray(g, W, H, H2) {
  const k = H / H2;
  const W2 = Math.max(8, Math.round(W / k));
  const out = new Float32Array(W2 * H2);
  for (let y = 0; y < H2; y++) {
    const y0 = Math.floor(y * k);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * k));
    for (let x = 0; x < W2; x++) {
      const x0 = Math.floor(x * k);
      const x1 = Math.max(x0 + 1, Math.min(W, Math.floor((x + 1) * k)));
      let sum = 0;
      for (let yy = y0; yy < y1 && yy < H; yy++) for (let xx = x0; xx < x1; xx++) sum += g[yy * W + xx];
      out[y * W2 + x] = sum / ((Math.min(y1, H) - y0) * (x1 - x0));
    }
  }
  return { g: out, W: W2, H: H2 };
}

// --------------------------------------------------------------- búsqueda

const POP = new Uint8Array(65536);
for (let i = 1; i < 65536; i++) POP[i] = POP[i >> 1] + (i & 1);
const pop32 = (v) => POP[v & 0xffff] + POP[v >>> 16];

export const STRIDE = 2 * WORDS;

/**
 * Las k entradas más parecidas a la huella q (distancia de Hamming).
 * mode 'base': sólo la huella clásica (0..330); 'sum': las dos sumadas (0..660).
 * db: { hashes: Uint32Array (N×STRIDE), n }.
 */
export function nearest(db, q, k = 8, mode = 'sum') {
  const { hashes, n } = db;
  const words = mode === 'base' ? WORDS : STRIDE;
  const best = [];
  let worst = Infinity;
  for (let i = 0, o = 0; i < n; i++, o += STRIDE) {
    let d = 0;
    for (let w = 0; w < words; w++) {
      d += pop32(hashes[o + w] ^ q[w]);
      if (d >= worst) break;
    }
    if (d < worst || best.length < k) {
      best.push([d, i]);
      best.sort((a, b) => a[0] - b[0]);
      if (best.length > k) best.pop();
      worst = best.length === k ? best[k - 1][0] : Infinity;
    }
  }
  return best;
}

// ------------------------------------------------------- base de huellas

let hashDb = null;
let hashLoading = null;

const hex = (bytes, o) => {
  let s = '';
  for (let i = 0; i < 16; i++) s += bytes[o + i].toString(16).padStart(2, '0');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
};

/** Carga public/cardhash.bin (una vez). */
export function loadCardHash() {
  if (hashDb) return Promise.resolve(hashDb);
  hashLoading ||= (async () => {
    const res = await fetch(new URL('./cardhash.bin', document.baseURI).href);
    if (!res.ok) throw new Error('sin cardhash.bin');
    const buf = await res.arrayBuffer();
    hashDb = parseCardHash(buf);
    return hashDb;
  })();
  hashLoading.catch(() => { hashLoading = null; });
  return hashLoading;
}

export function parseCardHash(buf) {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'MVH2') throw new Error('cardhash.bin no válido');
  const n = dv.getUint32(4, true);
  const words = dv.getUint32(8, true);
  const nor = dv.getUint32(12, true);
  if (words !== WORDS) throw new Error('cardhash.bin de otra versión');
  let o = 16;
  const hashes = new Uint32Array(buf.slice(o, o + n * 2 * words * 4));
  o += n * 2 * words * 4;
  const oracleIdx = new Uint16Array(buf.slice(o, o + n * 2));
  o += n * 2;
  const imageIds = new Uint8Array(buf, o, n * 16);
  o += n * 16;
  const flags = new Uint8Array(buf, o, n);
  o += n;
  const oracles = new Uint8Array(buf, o, nor * 16);
  return {
    n, hashes, oracleIdx, flags,
    oracle: (i) => hex(oracles, oracleIdx[i] * 16),
    image: (i) => hex(imageIds, i * 16),
    back: (i) => !!(flags[i] & 1),
    spanish: (i) => !!(flags[i] & 2),
  };
}

export const cardHashReady = () => !!hashDb;

// Hipótesis de encuadre. El localizador suele quedarse con el marco interior de
// la carta (dentro del borde negro): ~10 % más pequeño y algo más arriba, porque
// el borde de abajo es más grueso. [escala, desplazamiento x (fracción del ancho), y (del alto)]
const HYP = [
  [1.0, 0, 0],
  [1.11, 0, 0.025],
  [1.08, 0, 0.018],
  [1.145, 0, 0.032],
  [1.04, 0, 0.008],
  [0.95, 0, 0], // con funda: el borde exterior es algo mayor que la carta
  [0.925, 0, 0],
  [0.97, 0, 0],
];

const hashAt = (source, p) => hashFromInner(innerGray(source, p[0], p[1], p[2], p[3], 0, 0, 1, p[4] ?? 1));

function hamming(db, i, q, words = WORDS) {
  let d = 0;
  const o = i * STRIDE;
  for (let w = 0; w < words; w++) d += pop32(db.hashes[o + w] ^ q[w]);
  return d;
}

/**
 * Identifica la carta de una imagen ya localizada.
 * source: vídeo o canvas; loc (o loc.alts) en píxeles de source: { cx, cy, h, ang }.
 * 1) busca en toda la base con 3 tamaños; 2) ajusta el encuadre (giro, tamaño,
 * posición) para que la huella encaje mejor con las candidatas; 3) búsqueda final.
 * Devuelve { i, d, d2, margin, oracle, loc } o null.
 */
export function identify(source, loc, db = hashDb, { refine = true, altFrom = 0, altCount = 99 } = {}) {
  if (!db) return null;
  const starts = [loc, ...(loc.alts || []).slice(altFrom, altFrom + altCount)];
  let bestRun = null;
  for (const st of starts) {
    // si ya hay una coincidencia clara, no hace falta probar más propuestas
    if (bestRun && bestRun.d <= 60) break;
    const short = new Map();
    let bestP = null;
    let bestD = Infinity;
    const c0 = Math.cos(st.ang);
    const s0 = Math.sin(st.ang);
    for (let hi = 0; hi < HYP.length; hi++) {
      // con las dos primeras hipótesis suele bastar
      if (hi >= 2 && bestD <= 45) break;
      const [ds, ex, ey] = HYP[hi];
      const h = st.h * ds;
      const w = h * ASPECT;
      const p = [st.cx + ex * w * c0 - ey * h * s0, st.cy + ex * w * s0 + ey * h * c0, h, st.ang, 1];
      const q = hashAt(source, p);
      for (const [d, i] of nearest(db, q, 12, 'base')) {
        if (!short.has(i)) short.set(i, true);
        if (d < bestD) { bestD = d; bestP = p; }
      }
    }
    const cand = [...short.keys()];
    const score = (p) => {
      const q = hashAt(source, p);
      let m = Infinity;
      for (const i of cand) { const d = hamming(db, i, q); if (d < m) m = d; }
      return m;
    };
    let p = bestP;
    let d = bestD;
    if (refine) {
      // descenso por coordenadas con pasos cada vez más finos
      for (const k of [1, 0.5, 0.25]) {
        let improved = true;
        let guard = 0;
        while (improved && guard++ < 4) {
          improved = false;
          const w = p[2] * ASPECT;
          const steps = [
            [0.012 * w * k, 0, 0, 0], [-0.012 * w * k, 0, 0, 0],
            [0, 0.012 * p[2] * k, 0, 0], [0, -0.012 * p[2] * k, 0, 0],
            [0, 0, 0.02 * p[2] * k, 0], [0, 0, -0.02 * p[2] * k, 0],
            [0, 0, 0, 0.035 * k], [0, 0, 0, -0.035 * k],
          ];
          for (const st2 of steps) {
            const p2 = [p[0] + st2[0], p[1] + st2[1], p[2] + st2[2], p[3] + st2[3], p[4] + (st2[4] || 0)];
            if (Math.abs(p2[4] - 1) > 0.08) continue;
            // sin alejarse demasiado del punto de partida (evita «derivar» hacia otra cosa)
            if (Math.hypot(p2[0] - bestP[0], p2[1] - bestP[1]) > 0.08 * bestP[2] || Math.abs(p2[2] / bestP[2] - 1) > 0.12 || Math.abs(p2[3] - bestP[3]) > 0.1) continue;
            const d2 = score(p2);
            if (d2 < d) { d = d2; p = p2; improved = true; }
          }
        }
      }
    }
    if (!bestRun || d < bestRun.d) bestRun = { d, p };
  }
  // búsqueda final en toda la base con el mejor encuadre y las dos huellas
  const q = hashAt(source, bestRun.p);
  const list = nearest(db, q, 24, 'sum');
  const [d, i] = list[0];
  const o = db.oracleIdx[i];
  const other = list.find(([, j]) => db.oracleIdx[j] !== o);
  const d2 = other ? other[0] : 2 * BITS;
  const [cx, cy, h, ang, ax] = bestRun.p;
  return { i, d, d2, margin: d2 - d, oracle: db.oracle(i), loc: { cx, cy, h, ang, ax } };
}

try {
  if (localStorage.getItem('mtgvr-debug')) window.__rec = { locateCard, identify, loadCardHash, hashFromInner, innerGray, nearest, enclosedRatio, processFrame };
} catch { /* */ }

/**
 * ¿Hay un rectángulo de carta claro alrededor de `loc` (en píxeles de g)?
 * Si lo hay, lo encontrado podría ser sólo la ilustración de otra carta.
 * Devuelve la puntuación del mejor rectángulo mayor dividida por la de `loc`.
 */
export function enclosedRatio(g, W, H, loc) {
  const { gx, gy } = sobel(g, W, H);
  const gm = new Float32Array(W * H);
  for (let i = 0; i < gm.length; i++) gm[i] = Math.hypot(gx[i], gy[i]);
  const F = { gx, gy, gm, W, H };
  const own = rectScore(F, loc.cx, loc.cy, loc.h, loc.ang);
  let best = 0;
  const c = Math.cos(loc.ang);
  const s = Math.sin(loc.ang);
  for (const sc of [1.2, 1.3, 1.4, 1.5, 1.6]) {
    for (const ey of [-0.06, -0.03, 0, 0.03, 0.06]) {
      for (const ex of [-0.04, 0, 0.04]) {
        const h = loc.h * sc;
        const cx = loc.cx + ex * h * c - ey * h * s;
        const cy = loc.cy + ex * h * s + ey * h * c;
        best = Math.max(best, rectScore(F, cx, cy, h, loc.ang));
      }
    }
  }
  return own > 0 ? best / own : 0;
}

/**
 * Todo el reconocimiento de un fotograma (sirve en el Web Worker y, si no hay
 * worker, en el hilo principal). rgba: píxeles del recorte de la zona (w×h).
 * opts: { gh (alto para localizar), hint, altFrom, altCount, encAbove }.
 * Devuelve { res, loc, k, enclosed } — res.loc en píxeles del recorte; loc y
 * hint en píxeles de la imagen pequeña (k: de la pequeña al recorte).
 */
export function processFrame(rgba, w, h, opts, db = hashDb) {
  const full = { g: grayFromRGBA(rgba, w, h), W: w, H: h };
  const small = downscaleGray(full.g, w, h, opts.gh || 200);
  // suavizado ligero (como el reescalado de calidad del navegador, con el que se ajustó el localizador)
  {
    const { g, W, H } = small;
    const t = new Float32Array(g.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const xm = Math.max(0, x - 1), xp = Math.min(W - 1, x + 1);
      t[y * W + x] = (g[y * W + xm] + 2 * g[y * W + x] + g[y * W + xp]) / 4;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const ym = Math.max(0, y - 1), yp = Math.min(H - 1, y + 1);
      g[y * W + x] = (t[ym * W + x] + 2 * t[y * W + x] + t[yp * W + x]) / 4;
    }
  }
  const k = h / small.H;
  let loc = locateCard(small.g, small.W, small.H, opts.hint || null);
  if (opts.hint && loc.score < opts.hint.score * 0.6) loc = locateCard(small.g, small.W, small.H, null);
  // el localizador usa centros de píxel en enteros; la imagen, en i + 0,5
  const toFull = (l) => ({ cx: (l.cx + 0.5) * k, cy: (l.cy + 0.5) * k, h: l.h * k, ang: l.ang });
  const res = identify(full, { ...toFull(loc), alts: (loc.alts || []).map(toFull) }, db, { altFrom: opts.altFrom || 0, altCount: opts.altCount ?? 99 });
  let enclosed = 0;
  if (res) {
    res.image = db.image(res.i);
    res.back = db.back(res.i);
    res.spanish = db.spanish(res.i);
    if (res.loc && res.d > (opts.encAbove ?? Infinity)) {
      enclosed = enclosedRatio(small.g, small.W, small.H, { cx: res.loc.cx / k - 0.5, cy: res.loc.cy / k - 0.5, h: res.loc.h / k, ang: res.loc.ang });
    }
  }
  return { res, loc: { cx: loc.cx, cy: loc.cy, h: loc.h, ang: loc.ang, score: loc.score }, k, enclosed };
}
