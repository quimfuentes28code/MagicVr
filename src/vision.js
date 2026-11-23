// "Ojo arcano": reconocimiento continuo de cartas con la cámara.
// Lee sin parar el nombre de la carta que hay dentro del círculo de invocación
// y avisa cuando reconoce una carta con seguridad. Sin botones.

import { grabFrame, titleBar } from './camera.js';
import { LOCAL_CARDS, localCard } from './engine/cards.js';
import { findCard, knownCards } from './scryfall.js';
import { cardDbReady, candidates, recordToCard } from './carddb.js';

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
        await this.tick(worker);
      } catch (e) {
        await sleep(500);
      }
      await sleep(120);
    }
  }

  stop() { this.running = false; }
  pause(v) { this.paused = v; }

  /** Empieza de cero (p. ej. al pedir el comandante). La carta que siga en el círculo no se repite. */
  forget() { this.last = null; }

  async tick(worker) {
    // 1º la franja del nombre (una línea, rápido y fiable); 2º la mitad superior.
    const r = this.getRegion();
    let text = '';
    let best = null;
    let lines = [];
    let canvas = null;
    // Pasadas: la barra del título detectada; la franja del nombre; la mitad superior.
    const PASSES = [
      { x: 0, w: 1, y: 0, h: 0.3, psm: '7', bar: true },
      { x: 0.07, w: 0.8, y: 0.02, h: 0.2, psm: '6' },
      { x: 0, w: 1, y: 0, h: 0.55, psm: '3' },
    ];
    for (const pass of PASSES) {
      canvas = grabFrame(this.video, { x: r.x + r.w * pass.x, y: r.y + r.h * pass.y, w: r.w * pass.w, h: r.h * pass.h });
      if (!canvas) return;
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
    // Pausa mínima entre dos cartas.
    if (Date.now() - this.lastAccept < 2000) return;

    if (best) {
      const key = norm(best.card.name);
      const count = this.last && this.last.key === key ? this.last.count + 1 : 1;
      this.last = { key, count };
      // La misma carta no se acepta otra vez hasta pasados unos segundos.
      const again = Date.now() - (this.recent.get(key) || 0) < 6000;
      if (count >= 2 && !again) return this.accept(best.card);
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
    this.lastAccept = Date.now();
    this.recent.set(this.accepted, this.lastAccept);
    this.onState({ phase: 'found', text: card.printedName || card.name });
    this.onCard(card);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export { localCard };
