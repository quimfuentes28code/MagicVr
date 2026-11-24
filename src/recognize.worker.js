// Web Worker del círculo de invocación: localiza e identifica la carta fuera del
// hilo principal, para que las animaciones no se entrecorten.
import { parseCardHash, processFrame } from './recognize.js';

let db = null;

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      const res = await fetch(m.url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      db = parseCardHash(await res.arrayBuffer());
      self.postMessage({ type: 'ready', n: db.n });
    } catch (err) {
      self.postMessage({ type: 'error', error: String(err) });
    }
    return;
  }
  if (m.type === 'frame') {
    if (!db) { self.postMessage({ type: 'result', id: m.id, error: 'sin base' }); return; }
    const t0 = performance.now();
    try {
      const out = processFrame(new Uint8ClampedArray(m.buf), m.w, m.h, m.opts, db);
      self.postMessage({ type: 'result', id: m.id, out, ms: performance.now() - t0 });
    } catch (err) {
      self.postMessage({ type: 'result', id: m.id, error: String(err && err.stack || err) });
    }
  }
};
