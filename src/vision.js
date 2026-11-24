// "Ojo arcano": reconocimiento continuo de cartas con la cámara.
// Lee sin parar el nombre de la carta que hay dentro del círculo de invocación
// y avisa cuando reconoce una carta con seguridad. Sin botones.

import { grabFrame, titleBar, stretchContrast, deskew, grabGray, videoToScreen } from './camera.js';
import { loadCardHash, cardHashReady, locateCard, identify, enclosedRatio } from './recognize.js';
import { LOCAL_CARDS, localCard } from './engine/cards.js';
import { findCard, knownCards } from './scryfall.js';
import { cardDbReady, candidates, recordToCard, cardByOracle, imageUrl } from './carddb.js';

let workerPromise = null;

function ocrWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const base = new URL('./ocr/', document.baseURI).href;
      const worker = await createWorker('eng', 1, {
        workerPath: base + 'worker.min.js',
        corePath: base,
        langPath: base,
        gzip: true,
        workerBlobURL: false,
        logger: (m) => onProgress && m.progress != null && onProgress(m.status, m.progress),
      });
      return worker;
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

/** Precarga el OCR en segundo plano (para que la primera lectura sea rápida). */
export function preloadVision() {
  loadCardHash().catch(() => {});
  ocrWorker().catch(() => {});
}

// Umbrales del reconocimiento por imagen (calibrados con el banco de pruebas).
// d: bits distintos de 330 (aciertos ≤ ~65, fallos ≥ ~84 en el banco de pruebas).
export const IMG = { present: 100, sure: 70, bigMargin: 32, instant: 52, instantMargin: 12, enclosed: 0.8 };

/** Carta (con la imagen de SU edición) a partir de una entrada de la base de huellas. */
function cardFromHash(db, i) {
  const base = cardByOracle(db.oracle(i));
  if (!base) return null;
  const id = db.image(i);
  const url = imageUrl(id).replace('/front/', db.back(i) ? '/back/' : '/front/');
  return { ...base, image: url, edition: id, editionSpanish: db.spanish(i) };
}

export const norm = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function similarity(a, b) {
  if (!a || !b) return 0;
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

/** Mejor coincidencia de un nombre dentro de una línea (tolera basura alrededor). */
function bestIn(line, name) {
  let best = Math.max(similarity(line, name), similarity(line.replace(/ /g, ''), name.replace(/ /g, '')));
  if (line.length > name.length) {
    for (let i = 0; i + name.length <= line.length; i++) {
      if (i > 0 && line[i - 1] !== ' ') continue;
      for (const d of [-1, 0, 1]) {
        const w = line.slice(i, i + name.length + d);
        if (w.length > 2) best = Math.max(best, similarity(w, name));
      }
    }
  }
  return best;
}

function nameIndex() {
  const map = new Map();
  const add = (label, card) => { const k = norm(label); if (k.length >= 3 && !map.has(k)) map.set(k, card); };
  for (const c of [...LOCAL_CARDS, ...knownCards()]) {
    add(c.name, c);
    if (c.printedName) add(c.printedName, c);
  }
  return map;
}

/**
 * Busca en un texto OCR la carta que mejor encaje. Con la base de datos
 * completa cargada busca entre todas las cartas de Magic (vía trigramas);
 * si no, entre las cartas locales.
 */
export function matchKnown(text, index = null) {
  const lines = text.split('\n').map(norm).filter((l) => l.replace(/ /g, '').length >= 3);
  const useDb = !index && cardDbReady();
  if (!index && !useDb) index = nameIndex();
  let best = null;
  lines.forEach((line, li) => {
    const pool = useDb ? candidates(line).map(([k, r]) => [k, r]) : index;
    for (const [key, entry] of pool) {
      const card = useDb ? null : entry;
      const s = bestIn(line, key) - li * 0.01; // preferimos las primeras líneas (el título)
      // Con 35.000 cartas hay nombres muy parecidos: exigimos bastante parecido.
      const need = key.length >= 9 ? 0.8 : key.length >= 6 ? 0.86 : 0.99;
      if (s >= need && (!best || s > best.score)) best = { card: card || recordToCard(entry), score: s, line };
    }
  });
  return { best, lines };
}

export class CardWatcher {
  /**
   * video: <video> con la cámara. getRegion(): rect 0..1 de la zona a leer.
   * onCard(card): carta reconocida. onState({ phase, text }): estado para la UI.
   */
  constructor(video, { getRegion, onCard, onState, onOutline }) {
    this.video = video;
    this.onOutline = onOutline || (() => {});
    this.getRegion = getRegion;
    this.onCard = onCard;
    this.onState = onState || (() => {});
    this.running = false;
    this.paused = false;
    this.last = null; // { key, count }
    this.accepted = null; // nombre aceptado que sigue en el círculo
    this.missing = 0;
    this.lastAccept = 0; // momento de la última carta aceptada
    this.recent = new Map(); // nombre -> momento en que se aceptó
    this.misses = new Set(); // candidatos que Scryfall no conoce
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.onState({ phase: 'loading', text: 'Despertando el ojo arcano…' });
    let worker;
    try {
      worker = await ocrWorker((st, p) => this.onState({ phase: 'loading', text: `Despertando el ojo arcano… ${Math.round(p * 100)}%` }));
    } catch (e) {
      this.running = false;
      this.onState({ phase: 'error', text: 'No se pudo cargar el reconocimiento de cartas.' });
      return;
    }
    this.onState({ phase: 'idle', text: 'Coloca una carta en el círculo' });
    while (this.running) {
      if (this.paused || !this.video.videoWidth) {
        await sleep(300);
        continue;
      }
      try {
        if (cardHashReady() && cardDbReady()) {
          const t0 = performance.now();
          await this.imageTick(worker);
          // a unos 8 por segundo como mucho (deja respirar al móvil)
          await sleep(Math.max(30, 120 - (performance.now() - t0)));
          continue;
        }
        await this.tick(worker);
      } catch (e) {
        if (window.__visionDebug) window.__visionDebug({ error: String(e && e.stack || e) });
        await sleep(300);
      }
      await sleep(120);
    }
  }

  stop() { this.running = false; }
  pause(v) { this.paused = v; }

  /** Empieza de cero (p. ej. al pedir el comandante). La carta que siga en el círculo no se repite. */
  forget() { this.last = null; }

  /**
   * Reconocimiento por imagen: localiza la carta, la endereza y busca su huella.
   * Si la imagen no basta (carta muy nueva, reflejo fuerte…), pide ayuda al OCR.
   */
  async imageTick(worker) {
    const region = this.getRegion();
    // Zona algo mayor que el círculo (la carta puede sobresalir). Si la carta no se
    // reconoce, cada lectura prueba un encuadre distinto: con la imagen quieta,
    // repetir lo mismo daría siempre el mismo resultado.
    const V = [[0.2, 200, 0, 0], [0.12, 230, 0, 0], [0.3, 190, 0, 0], [0.2, 240, 0.03, 0.02], [0.16, 210, -0.03, -0.02], [0.25, 220, 0, 0.03]];
    if (!this.hint) this.variant = ((this.variant || 0) + 1) % V.length;
    const [m, gh, ox, oy] = this.hint ? V[0] : V[this.variant];
    const rect = { x: region.x - region.w * m + region.w * ox, y: region.y - region.h * m + region.h * oy, w: region.w * (1 + 2 * m), h: region.h * (1 + 2 * m) };
    const shot = grabGray(this.video, rect, gh);
    if (!shot) return;
    const { g, W, H, r } = shot;
    let loc = locateCard(g, W, H, this.hint);
    if (this.hint && loc.score < this.hint.score * 0.6) loc = locateCard(g, W, H, null);
    const k = r.sh / H; // de la imagen pequeña a píxeles del vídeo
    const toVideo = (l) => ({ cx: r.sx + l.cx * k, cy: r.sy + l.cy * k, h: l.h * k, ang: l.ang });
    const vloc = { ...toVideo(loc), alts: (loc.alts || []).map(toVideo) };
    const db = await loadCardHash();
    // propuestas alternativas repartidas entre lecturas (2 por lectura)
    this.altTurn = ((this.altTurn || 0) + 2) % 8;
    const res = identify(this.video, vloc, db, { altFrom: this.hint ? 0 : this.altTurn, altCount: this.hint ? 0 : 2 });
    if (window.__visionDebug) window.__visionDebug({ image: true, loc, res });
    const present = res && res.d <= IMG.present;
    let sure = present && (res.d <= IMG.sure || (res.d <= IMG.present && res.margin >= IMG.bigMargin));
    // ¿lo encontrado es sólo la ilustración de una carta mayor? (p. ej. parece una tierra de arte completo)
    if (sure && res.d > IMG.instant && res.loc) {
      const small = { cx: (res.loc.cx - r.sx) / k, cy: (res.loc.cy - r.sy) / k, h: res.loc.h / k, ang: res.loc.ang };
      if (enclosedRatio(g, W, H, small) > IMG.enclosed) sure = false;
    }
    // contorno de la carta en pantalla (esquinas en coordenadas relativas)
    if (present && res.loc) {
      const { cx, cy, h, ang } = res.loc;
      const w = h * 63 / 88;
      const c = Math.cos(ang);
      const sn = Math.sin(ang);
      const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
        .map(([x, y]) => videoToScreen(this.video, cx + x * c - y * sn, cy + x * sn + y * c));
      this.onOutline({ pts, state: this.accepted && res.oracle === this.acceptedOracle ? 'found' : sure ? 'sure' : 'reading' });
    } else this.onOutline(null);
    // la próxima lectura busca cerca del encuadre ajustado (mucho más rápido)
    this.hint = present && res.loc
      ? { cx: (res.loc.cx - r.sx) / k, cy: (res.loc.cy - r.sy) / k, h: res.loc.h / k, ang: res.loc.ang, score: loc.score }
      : null;

    // ¿Sigue en el círculo la carta ya aceptada?
    if (this.accepted) {
      if (present && res.oracle === this.acceptedOracle) { this.missing = 0; return; }
      if (sure && res.oracle !== this.acceptedOracle) this.missing = 3; // otra carta distinta
      else if (++this.missing < 4) return;
      this.accepted = null;
      this.acceptedOracle = null;
      this.onState({ phase: 'idle', text: 'Coloca una carta en el círculo' });
    }
    if (Date.now() - this.lastAccept < 1200) return;
    if (!present) {
      this.last = null;
      this.ocrHelp = 0;
      this.onState({ phase: 'idle', text: 'Coloca una carta en el círculo' });
      return;
    }
    if (sure) {
      const key = res.oracle;
      const count = this.last && this.last.key === key ? this.last.count + 1 : 1;
      this.last = { key, count };
      const again = Date.now() - (this.recent.get(key) || 0) < 2500;
      // muy clara: a la primera; si no, dos lecturas seguidas iguales
      if ((count >= 2 || (res.d <= IMG.instant && res.margin >= IMG.instantMargin)) && !again) {
        const card = cardFromHash(db, res.i);
        if (card) return this.accept(card, key);
      }
      this.onState({ phase: 'reading', text: 'Leyendo…' });
      return;
    }
    // Hay carta pero la imagen duda: el OCR del nombre decide (cada pocas lecturas).
    this.onState({ phase: 'reading', text: 'Leyendo…' });
    // (la imagen casi siempre basta: el OCR sólo entra si tras ~1,5 s sigue sin saberse,
    // p. ej. una carta más nueva que la base de huellas)
    this.ocrHelp = (this.ocrHelp || 0) + 1;
    if (this.ocrHelp > 10 && this.ocrHelp % 4 === 0) await this.tick(worker);
  }

  async tick(worker) {
    // 1º la franja del nombre (una línea, rápido y fiable); 2º la mitad superior.
    const region = this.getRegion();
    // La carta puede ser más pequeña que el círculo (cámara lejos): cada lectura
    // prueba también un encuadre centrado más pequeño, hasta dar con ella.
    const SCALES = [1, 0.78, 0.62];
    this.n = (this.n || 0) + 1;
    const sc = this.accepted ? (this.acceptScale || 1) : (this.scale && this.hold > 0 ? this.scale : SCALES[this.n % SCALES.length]);
    const r = { x: region.x + (region.w * (1 - sc)) / 2, y: region.y + (region.h * (1 - sc)) / 2, w: region.w * sc, h: region.h * sc };
    let text = '';
    let best = null;
    let lines = [];
    let canvas = null;
    // Pasadas: la barra del título detectada; la franja del nombre; la mitad superior.
    // Con la carta quieta, cada intento usa un encuadre algo distinto (como si
    // la movieras un poco): así no se queda atascado en un recorte que no lee.
    const J = [[0, 0, 1], [0, 0.04, 1], [0.03, -0.02, 0.94], [-0.03, 0.02, 0.94], [0, 0.07, 0.9], [0.02, 0.01, 1.06]];
    const [jx, jy, js] = J[(this.jitter = (Math.floor(this.n / SCALES.length)) % J.length)];
    const PASSES = [
      { x: 0, w: 1, y: 0, h: 0.3, psm: '7', bar: true },
      { x: 0.07, w: 0.8, y: 0.02, h: 0.2, psm: '6' },
      { x: 0, w: 1, y: 0, h: 0.55, psm: '3' },
    ];
    for (const pass of PASSES) {
      const w = r.w * pass.w * js;
      const hgt = r.h * pass.h * js;
      const x = r.x + r.w * pass.x + r.w * jx + (r.w * pass.w - w) / 2;
      const y = r.y + r.h * pass.y + r.h * jy;
      canvas = grabFrame(this.video, { x, y, w, h: hgt });
      if (!canvas) return;
      stretchContrast(canvas);
      canvas = deskew(canvas);
      if (pass.bar) {
        canvas = titleBar(canvas);
        if (!canvas) continue;
      }
      if (this.psm !== pass.psm) { await worker.setParameters({ tessedit_pageseg_mode: pass.psm }); this.psm = pass.psm; }
      const { data } = await worker.recognize(canvas);
      text = data.text || '';
      ({ best, lines } = matchKnown(text));
      if (window.__visionDebug) window.__visionDebug({ canvas: canvas.toDataURL(), text, best, pass: PASSES.indexOf(pass) });
      if (best) break;
    }

    // ¿La carta aceptada sigue en el círculo? Mientras siga, no se vuelve a jugar.
    // Hace falta no verla en 3 lecturas seguidas para dar el círculo por vacío.
    if (this.accepted) {
      const still = best ? norm(best.card.name) === this.accepted : lines.some((l) => bestIn(l, this.accepted) > 0.6);
      if (still) { this.missing = 0; return; }
      if (++this.missing < 3) return;
      this.accepted = null;
      this.onState({ phase: 'idle', text: 'Coloca una carta en el círculo' });
    }
    if (this.hold > 0) this.hold--;
    // Pausa mínima entre dos cartas.
    if (Date.now() - this.lastAccept < 2000) return;

    if (best) {
      this.scale = sc; this.hold = 2; // confirmamos con el mismo encuadre
      const key = norm(best.card.name);
      const count = this.last && this.last.key === key ? this.last.count + 1 : 1;
      this.last = { key, count };
      // La misma carta no se acepta otra vez hasta pasados unos segundos.
      const again = Date.now() - (this.recent.get(key) || 0) < 6000;
      // Lectura muy clara: se acepta a la primera; si hay dudas, se espera a una segunda igual.
      const clear = best.score >= 0.94 && key.replace(/ /g, '').length >= 4;
      if ((count >= 2 || clear) && !again) return this.accept(best.card);
      this.onState({ phase: 'reading', text: 'Leyendo… ' + (best.card.printedName || best.card.name) });
      return;
    }

    // Carta desconocida: si leemos lo mismo dos veces, preguntamos a Scryfall.
    const cand = lines.find((l) => l.replace(/ /g, '').length >= 5 && l.split(' ').every((w) => w.length >= 2));
    if (!cand) {
      this.last = null;
      this.onState({ phase: 'idle', text: 'Coloca una carta en el círculo' });
      return;
    }
    const count = this.last && similarity(this.last.key, cand) > 0.85 ? this.last.count + 1 : 1;
    this.last = { key: cand, count };
    this.onState({ phase: 'reading', text: 'Leyendo…' });
    if (count < 2 || this.misses.has(cand)) return;
    const card = await findCard(cand).catch(() => null);
    if (card && Math.max(similarity(norm(card.name), cand), similarity(norm(card.printedName), cand)) > 0.7) {
      this.accept(card);
    } else {
      this.misses.add(cand);
    }
  }

  accept(card, oracle = null) {
    this.acceptScale = this.scale || 1;
    this.accepted = norm(card.name);
    this.acceptedOracle = oracle || card.id || null;
    this.missing = 0;
    this.last = null;
    this.lastAccept = Date.now();
    this.recent.set(this.accepted, this.lastAccept);
    this.onState({ phase: 'found', text: card.printedName || card.name });
    if (window.__visionDebug) window.__visionDebug({ accepted: card.name, image: card.image });
    this.onCard(card);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export { localCard };
