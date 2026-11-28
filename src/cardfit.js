// «Adaptar el círculo a mi carta»: busca una carta de referencia dentro o cerca
// del círculo, a varias escalas (por si la carta es más pequeña o más grande que
// el círculo) y en varias posiciones (por si no está justo en el centro), y
// devuelve dónde está y qué tamaño tiene.

import { locateCard } from './recognize.js';

/**
 * Recortes que se miran: escala (veces la altura del círculo) y desplazamiento
 * del centro (en veces la altura del recorte).
 */
export const FIT_TILES = (() => {
  const t = [];
  for (const dy of [-0.45, 0, 0.45]) for (const dx of [-0.45, 0, 0.45]) t.push({ scale: 1.3, dx, dy });
  for (const [dx, dy] of [[0, 0], [-0.35, 0], [0.35, 0], [0, -0.35], [0, 0.35]]) t.push({ scale: 2.4, dx, dy });
  t.push({ scale: 4, dx: 0, dy: 0 });
  return t;
})();

/**
 * De varias búsquedas, la buena: entre las que puntúan casi como la mejor, la
 * que tiene la carta a un tamaño cómodo dentro del recorte.
 * results: [{ res: {cx, cy, h, ang, score}, H }]
 */
export function pickFit(results, minScore = -Infinity) {
  const valid = results.filter((r) => r && r.res && r.res.score >= minScore && r.res.h / r.H > 0.3 && r.res.h / r.H < 0.92);
  if (!valid.length) return null;
  const max = Math.max(...valid.map((r) => r.res.score));
  const good = valid.filter((r) => r.res.score >= max - Math.abs(max) * 0.25);
  good.sort((a, b) => Math.abs(a.res.h / a.H - 0.6) - Math.abs(b.res.h / b.H - 0.6));
  return good[0];
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * sample({ scale, dx, dy }, outH) → { g, W, H, ... } recorte en gris; devuelve el
 * mejor ajuste (afinado a más resolución) o null.
 */
export async function locateAcross(sample, { tiles = FIT_TILES, minScore = -Infinity, coarse = 140, fine = 200 } = {}) {
  const results = [];
  for (const t of tiles) {
    const s = sample(t, coarse);
    if (s) results.push({ ...s, tile: t, res: locateCard(s.g, s.W, s.H) });
    await tick(); // deja respirar a la pantalla
  }
  const best = pickFit(results, minScore);
  if (!best) return null;
  // afinar en el mismo recorte con más resolución
  const s = sample(best.tile, fine);
  if (!s) return best;
  const k = s.H / best.H;
  const res = locateCard(s.g, s.W, s.H, { cx: best.res.cx * k, cy: best.res.cy * k, h: best.res.h * k, ang: best.res.ang });
  return res && res.score >= minScore ? { ...s, tile: best.tile, res } : best;
}
