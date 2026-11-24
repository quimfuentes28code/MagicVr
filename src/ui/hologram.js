// Invocación en 2,5D: la ilustración de la propia carta sale de ella como un
// holograma con profundidad (dos capas que se desplazan distinto al girar), un
// portal de su color en la base y partículas, y vuelve a entrar en la carta.
// Cada carta muestra su propio personaje porque usa su ilustración real.

import { magicColor } from './magic.js';

const reduce = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Imagen de la ilustración sola (recorte de Scryfall) a partir de la imagen de la carta. */
export function artOf(card) {
  const img = card && card.image;
  if (!img || !/cards\.scryfall\.io/.test(img)) return null;
  return img.replace(/\/(normal|large|small|png)\//, '/art_crop/').replace(/\.png(\?|$)/, '.jpg$1');
}

/**
 * Lanza el holograma de `card` encima del elemento `el` (la carta en la mesa).
 * opts.big: más grande y más largo (legendarias, míticas, caras).
 */
export function hologram(layer, el, card, { big = false } = {}) {
  const art = artOf(card);
  if (!art || !el || !el.isConnected || reduce()) return;
  const r = el.getBoundingClientRect();
  if (!r.width) return;
  const color = (card.colors && card.colors[0]) || 'C';
  const [light, deep] = magicColor(color);
  const vh = window.innerHeight;
  const w = Math.min(vh * (big ? 0.62 : 0.46), Math.max(r.width * (big ? 2.6 : 2.1), 150));
  const hgt = w * 0.78;
  const DUR = big ? 3400 : 2600;
  const box = document.createElement('div');
  box.className = 'holo' + (big ? ' big' : '');
  box.style.setProperty('--hl', light);
  box.style.setProperty('--hd', deep);
  box.style.setProperty('--art', `url("${art}")`);
  box.style.setProperty('--dur', DUR + 'ms');
  // la figura se apoya en la carta y se eleva por encima (sin salirse de la pantalla)
  const cx = r.left + r.width / 2;
  const baseY = r.top + r.height * 0.55;
  const left = Math.max(4, Math.min(window.innerWidth - w - 4, cx - w / 2));
  const top = Math.max(4, baseY - hgt);
  Object.assign(box.style, { left: left + 'px', top: top + 'px', width: w + 'px', height: hgt + 'px' });
  box.innerHTML = `
    <div class="holo-portal" style="left:${cx - left}px; top:${baseY - top}px"><i></i><i class="r2"></i></div>
    <div class="holo-stage">
      <div class="holo-fig">
        <div class="holo-layer back"></div>
        <div class="holo-layer front"></div>
        <div class="holo-scan"></div>
      </div>
    </div>`;
  layer.append(box);
  // la imagen se precarga: si no llega a tiempo, no se muestra nada raro
  const img = new Image();
  img.onload = () => box.classList.add('ready');
  img.onerror = () => box.remove();
  img.src = art;
  // partículas que suben del portal
  const n = big ? 26 : 16;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.className = 'holo-mote';
    p.style.left = cx - left + (Math.random() - 0.5) * w * 0.55 + 'px';
    p.style.top = baseY - top + 'px';
    p.style.setProperty('--dy', -(hgt * (0.4 + Math.random() * 0.6)) + 'px');
    p.style.setProperty('--dx', (Math.random() - 0.5) * 40 + 'px');
    p.style.animationDelay = (Math.random() * DUR * 0.6) + 'ms';
    p.style.background = Math.random() < 0.5 ? light : deep;
    box.append(p);
  }
  setTimeout(() => box.remove(), DUR + 300);
}
