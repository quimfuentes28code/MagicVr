// "Ojo arcano": reconocimiento continuo de cartas con la cámara.
// Lee sin parar el nombre de la carta que hay dentro del círculo de invocación
// y avisa cuando reconoce una carta con seguridad. Sin botones.

import { grabFrame } from './camera.js';
import { LOCAL_CARDS, localCard } from './engine/cards.js';
import { findCard, knownCards } from './scryfall.js';

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
  ocrWorker().catch(() => {});
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
  let best = similarity(line, name);
  if (line.length > name.length + 2) {
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

/** Busca en un texto OCR la carta conocida que mejor encaje. */
export function matchKnown(text, index = nameIndex()) {
  const lines = text.split('\n').map(norm).filter((l) => l.replace(/ /g, '').length >= 3);
  let best = null;
  lines.forEach((line, li) => {
    for (const [key, card] of index) {
      const s = bestIn(line, key) - li * 0.01; // preferimos las primeras líneas (el título)
      const need = key.length >= 7 ? 0.78 : key.length >= 5 ? 0.84 : 0.99;
      if (s >= need && (!best || s > best.score)) best = { card, score: s, line };
    }
  });
  return { best, lines };
}

export class CardWatcher {
  /**
   * video: <video> con la cámara. getRegion(): rect 0..1 de la zona a leer.
   * onCard(card): carta reconocida. onState({ phase, text }): estado para la UI.
   */
  constructor(video, { getRegion, onCard, onState }) {
    this.video = video;
    this.getRegion = getRegion;
    this.onCard = onCard;
    this.onState = onState || (() => {});
    this.running = false;
    this.paused = false;
    this.last = null; // { key, count }
    this.accepted = null; // nombre aceptado que sigue en el círculo
    this.missing = 0;
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
        await this.tick(worker);
      } catch (e) {
        await sleep(500);
      }
      await sleep(120);
    }
  }

  stop() { this.running = false; }
  pause(v) { this.paused = v; }

  /** Permite volver a reconocer la misma carta (p. ej. tras deshacer). */
  forget() { this.accepted = null; this.last = null; }

  async tick(worker) {
    // El nombre está arriba: leemos la mitad superior del círculo (más rápido).
    const r = this.getRegion();
    const canvas = grabFrame(this.video, { x: r.x, y: r.y, w: r.w, h: r.h * 0.55 });
    if (!canvas) return;
    const { data } = await worker.recognize(canvas);
    const text = data.text || '';
    const { best, lines } = matchKnown(text);
    if (window.__visionDebug) window.__visionDebug({ canvas: canvas.toDataURL(), text, best });

    // ¿La carta aceptada sigue en el círculo?
    if (this.accepted) {
      const still = best ? norm(best.card.name) === this.accepted : lines.some((l) => bestIn(l, this.accepted) > 0.7);
      if (still) return;
      if (++this.missing < 2) return;
      this.accepted = null;
    }

    if (best) {
      const key = norm(best.card.name);
      const count = this.last && this.last.key === key ? this.last.count + 1 : 1;
      this.last = { key, count };
      if (best.score >= 0.92 || count >= 2) return this.accept(best.card);
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

  accept(card) {
    this.accepted = norm(card.name);
    this.missing = 0;
    this.last = null;
    this.onState({ phase: 'found', text: card.printedName || card.name });
    this.onCard(card);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export { localCard };
