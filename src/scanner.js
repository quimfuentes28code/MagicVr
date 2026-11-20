// Reconocimiento del nombre de una carta física con OCR (Tesseract.js).
// Se carga bajo demanda porque pesa varios MB.

import { grabFrame } from './camera.js';
import { autocomplete, findCard } from './scryfall.js';

let workerPromise = null;

async function getWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      return createWorker(['eng', 'spa'], 1, {
        logger: (m) => onProgress && m.progress != null && onProgress(m.status, m.progress),
      });
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

/** Limpia el texto reconocido y se queda con la línea que parece un nombre. */
export function cleanOcr(text) {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ',\- ]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((l) => l.replace(/[^A-Za-z]/g, '').length >= 3);
  lines.sort((a, b) => b.length - a.length);
  return lines[0] || '';
}

/**
 * Escanea la franja del nombre. rect = zona del marco guía (0..1).
 * Devuelve { text, card, suggestions }.
 */
export async function scanCardName(video, rect, onProgress) {
  const canvas = grabFrame(video, rect);
  if (!canvas) throw new Error('La cámara aún no está lista.');
  const worker = await getWorker(onProgress);
  const { data } = await worker.recognize(canvas);
  const text = cleanOcr(data.text || '');
  if (!text) return { text: '', card: null, suggestions: [] };
  const [card, suggestions] = await Promise.all([findCard(text), autocomplete(text)]);
  return { text, card, suggestions };
}
