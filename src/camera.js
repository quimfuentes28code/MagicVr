// Cámara trasera del móvil como fondo de la mesa ("realidad aumentada").

let stream = null;
let starting = null;

export function cameraSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

async function openStream() {
  // 1º la cámara trasera a la máxima resolución; si el navegador o la webcam
  // no aceptan esas condiciones, cualquier cámara.
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
    });
  } catch (e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e;
    return navigator.mediaDevices.getUserMedia({ audio: false, video: true });
  }
}

/** Explicación en español de por qué no se pudo abrir la cámara. */
export function cameraErrorText(e) {
  switch (e && e.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'El navegador ha bloqueado la cámara. Pulsa el candado (o el icono de cámara) junto a la dirección, permite la cámara y vuelve a intentarlo.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No se ha encontrado ninguna cámara conectada.';
    case 'NotReadableError':
    case 'AbortError':
      return 'La cámara está ocupada por otra aplicación (Zoom, Teams, Discord…). Ciérrala y vuelve a intentarlo.';
    default:
      return 'No se pudo abrir la cámara' + (e && e.message ? ` (${e.message})` : '') + '.';
  }
}

export async function startCamera(video) {
  if (!cameraSupported()) {
    const err = new Error('Este navegador no permite usar la cámara (hace falta HTTPS).');
    err.name = 'Unsupported';
    throw err;
  }
  if (!stream) {
    starting ||= openStream();
    try {
      stream = await starting;
    } finally {
      starting = null;
    }
  }
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play().catch(() => {});
  return stream;
}

export function stopCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
}

export function cameraActive() {
  return !!stream;
}

/**
 * Escala con la que se pinta el vídeo: «completa» (contain: se ve toda la imagen de la
 * cámara, sin recortar) o «llenar» (cover: llena la pantalla recortando los bordes).
 */
export function fitScale(video, ew, eh, vw, vh) {
  return video.dataset.fit === 'cover' ? Math.max(ew / vw, eh / vh) : Math.min(ew / vw, eh / vh);
}

/** Captura un recorte del vídeo (coordenadas relativas 0..1 sobre lo que se ve en pantalla). */
export function grabFrame(video, rect, { color = false } = {}) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw) return null;
  // El vídeo se muestra entero (contain) o llenando la pantalla (cover); calculamos qué parte es visible.
  const ew = video.clientWidth;
  const eh = video.clientHeight;
  const scale = fitScale(video, ew, eh, vw, vh);
  const visW = ew / scale;
  const visH = eh / scale;
  const offX = (vw - visW) / 2;
  const offY = (vh - visH) / 2;
  const sx = offX + rect.x * visW;
  const sy = offY + rect.y * visH;
  const sw = rect.w * visW;
  const sh = rect.h * visH;
  const canvas = document.createElement('canvas');
  const up = Math.min(4, Math.max(1, 1000 / sw));
  canvas.width = Math.round(sw * up);
  canvas.height = Math.round(sh * up);
  const ctx = canvas.getContext('2d');
  ctx.filter = color ? 'none' : 'grayscale(1)';
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Binarización adaptativa (umbral por zonas): separa el texto del fondo y los bordes. */
export function adaptiveThreshold(src, k = 0.9) {
  const w = src.width;
  const h = src.height;
  const ctx = src.getContext('2d');
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    let row = 0;
    for (let x = 1; x <= w; x++) {
      row += d[((y - 1) * w + (x - 1)) * 4];
      integral[y * (w + 1) + x] = integral[(y - 1) * (w + 1) + x] + row;
    }
  }
  const r = Math.max(8, Math.round(h / 4));
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const sum = integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      const i = (y * w + x) * 4;
      const v = d[i] < mean * k ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d').putImageData(img, 0, 0);
  return out;
}

/**
 * Busca la barra clara del título de la carta (la franja horizontal más
 * brillante) y devuelve solo esa barra, sin bordes. null si no la encuentra.
 */
export function titleBar(src) {
  const w = src.width;
  const h = src.height;
  const d = src.getContext('2d').getImageData(0, 0, w, h).data;
  const gray = (x, y) => d[(y * w + x) * 4];
  const rows = new Float64Array(h);
  const xa = Math.round(w * 0.15);
  const xb = Math.round(w * 0.85);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = xa; x < xb; x++) s += gray(x, y);
    rows[y] = s / (xb - xa);
  }
  const mean = rows.reduce((a, b) => a + b, 0) / h;
  const std = Math.sqrt(rows.reduce((a, b) => a + (b - mean) ** 2, 0) / h);
  const thr = mean + 0.35 * std;
  let best = null;
  let start = -1;
  for (let y = 0; y <= h; y++) {
    const v = y < h ? rows[y] : 0;
    if (v > thr && start < 0) start = y;
    else if (v <= thr && start >= 0) {
      const hh = y - start;
      let m = 0;
      for (let k = start; k < y; k++) m += rows[k];
      const score = m; // altura × brillo
      if (hh >= h * 0.04 && hh <= h * 0.45 && (!best || score > best.score)) best = { y0: start, y1: y, score };
      start = -1;
    }
  }
  if (!best) return null;
  const pad = Math.round((best.y1 - best.y0) * 0.15);
  const y0 = Math.max(0, best.y0 - pad);
  const y1 = Math.min(h, best.y1 + pad);
  const cols = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = y0; y < y1; y++) s += gray(x, y);
    cols[x] = s / (y1 - y0);
  }
  const cm = cols.reduce((a, b) => a + b, 0) / w;
  const cs = Math.sqrt(cols.reduce((a, b) => a + (b - cm) ** 2, 0) / w);
  let x0 = 0;
  let x1 = w - 1;
  while (x0 < w && cols[x0] <= cm - 0.5 * cs) x0++;
  while (x1 > x0 && cols[x1] <= cm - 0.5 * cs) x1--;
  if (x1 - x0 < w * 0.3) return null;
  const out = document.createElement('canvas');
  out.width = x1 - x0;
  out.height = y1 - y0;
  out.getContext('2d').drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/**
 * Zoom de la cámara (1 = sin zoom). Usa el zoom real de la cámara si lo tiene
 * (sin perder calidad); si no, amplía la imagen hacia `origin` (% en pantalla).
 * Devuelve 'hw' (zoom real) o 'css' (digital).
 */
export async function setCameraZoom(video, z, origin = { x: 50, y: 50 }) {
  const track = stream && stream.getVideoTracks()[0];
  const caps = track && track.getCapabilities ? track.getCapabilities() : null;
  if (caps && caps.zoom && caps.zoom.max > caps.zoom.min) {
    const { min, max } = caps.zoom;
    const value = Math.min(max, Math.max(min, min * z));
    try {
      await track.applyConstraints({ advanced: [{ zoom: value }] });
      video.style.transform = '';
      return 'hw';
    } catch { /* algunos navegadores lo anuncian pero no lo aplican */ }
  }
  video.style.transformOrigin = `${origin.x}% ${origin.y}%`;
  video.style.transform = z > 1 ? `scale(${z})` : '';
  return 'css';
}

/** Estira el contraste (percentiles 2-98 %) para que el texto destaque con poca luz. */
export function stretchContrast(src) {
  const ctx = src.getContext('2d');
  const img = ctx.getImageData(0, 0, src.width, src.height);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) hist[d[i]]++;
  const total = d.length / 4;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > total * 0.02) { hi = v; break; } }
  if (hi - lo < 20) return src;
  const k = 255 / (hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, (d[i] - lo) * k));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return src;
}

/**
 * Endereza el recorte si la carta está algo girada (hasta ±10°): busca el
 * ángulo en el que las filas de texto quedan más horizontales (el perfil de
 * filas tiene más contraste) y gira la imagen ese ángulo.
 */
export function deskew(src) {
  const sw = 220;
  const sh = Math.max(20, Math.round((src.height / src.width) * sw));
  const small = document.createElement('canvas');
  small.width = sw;
  small.height = sh;
  const sctx = small.getContext('2d', { willReadFrequently: true });
  const work = document.createElement('canvas');
  work.width = sw;
  work.height = sh;
  const wctx = work.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(src, 0, 0, sw, sh);
  const score = (deg) => {
    wctx.setTransform(1, 0, 0, 1, 0, 0);
    wctx.fillStyle = '#808080';
    wctx.fillRect(0, 0, sw, sh);
    wctx.translate(sw / 2, sh / 2);
    wctx.rotate((deg * Math.PI) / 180);
    wctx.drawImage(small, -sw / 2, -sh / 2);
    const d = wctx.getImageData(0, 0, sw, sh).data;
    // energía de los cambios verticales entre filas (texto horizontal = filas muy distintas)
    const rows = new Float64Array(sh);
    for (let y = 0; y < sh; y++) {
      let s = 0;
      for (let x = Math.round(sw * 0.1); x < sw * 0.9; x++) s += d[(y * sw + x) * 4];
      rows[y] = s;
    }
    let e = 0;
    for (let y = 1; y < sh; y++) e += (rows[y] - rows[y - 1]) ** 2;
    return e;
  };
  let best = 0;
  let bestScore = score(0);
  for (const deg of [-10, -8, -6, -4, -3, -2, -1, 1, 2, 3, 4, 6, 8, 10]) {
    const s = score(deg);
    if (s > bestScore * 1.04) { bestScore = s; best = deg; }
  }
  // afinamos en medios grados
  for (const deg of [best - 0.5, best + 0.5]) {
    const s = score(deg);
    if (s > bestScore) { bestScore = s; best = deg; }
  }
  if (!best) return src;
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((best * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  out.deskewed = best;
  return out;
}

/** Rectángulo relativo (0..1 de lo que se ve en pantalla) → píxeles del vídeo. */
export function regionToVideo(video, rect) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const ew = video.clientWidth;
  const eh = video.clientHeight;
  const scale = fitScale(video, ew, eh, vw, vh);
  const visW = ew / scale;
  const visH = eh / scale;
  const offX = (vw - visW) / 2;
  const offY = (vh - visH) / 2;
  return { sx: offX + rect.x * visW, sy: offY + rect.y * visH, sw: rect.w * visW, sh: rect.h * visH };
}

/** Recorte del vídeo en gris (Float32Array) con `height` píxeles de alto. */
export function grabGray(video, rect, height = 200) {
  const r = regionToVideo(video, rect);
  if (!r.sw || !r.sh) return null;
  const H = height;
  const W = Math.max(8, Math.round((r.sw / r.sh) * H));
  const c = grabGray.canvas || (grabGray.canvas = document.createElement('canvas'));
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, r.sx, r.sy, r.sw, r.sh, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const g = new Float32Array(W * H);
  for (let i = 0; i < g.length; i++) g[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  return { g, W, H, r };
}

/** Píxeles del vídeo → posición relativa (0..1) en lo que se ve en pantalla. */
export function videoToScreen(video, x, y) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const ew = video.clientWidth;
  const eh = video.clientHeight;
  const scale = fitScale(video, ew, eh, vw, vh);
  const visW = ew / scale;
  const visH = eh / scale;
  return { x: (x - (vw - visW) / 2) / visW, y: (y - (vh - visH) / 2) / visH };
}
