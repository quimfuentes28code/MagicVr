// Animaciones de combate: grito de guerra al declarar el ataque y embestida de
// la carta contra su objetivo, con estela, impacto, número de daño y retroceso.

import { magicColor } from './magic.js';

const reduce = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Al declarar el ataque: la carta se alza con un aura de su color. */
export function warCry(permEl, color) {
  if (!permEl || !permEl.isConnected) return;
  const [light, deep] = magicColor(color);
  permEl.style.setProperty('--aura-l', light);
  permEl.style.setProperty('--aura-d', deep);
  permEl.classList.remove('war-cry');
  void permEl.offsetWidth;
  permEl.classList.add('war-cry');
  setTimeout(() => permEl.classList.remove('war-cry'), 1300);
  // polvo que se levanta
  const r = permEl.getBoundingClientRect();
  for (let i = 0; i < 14; i++) {
    const p = document.createElement('div');
    p.className = 'dust';
    const a = Math.PI + (Math.random() - 0.5) * Math.PI * 0.9;
    p.style.left = r.left + r.width * (0.15 + Math.random() * 0.7) + 'px';
    p.style.top = r.bottom - 6 + 'px';
    p.style.setProperty('--dx', Math.cos(a) * (20 + Math.random() * 40) * (Math.random() < 0.5 ? -1 : 1) + 'px');
    p.style.setProperty('--dy', -(10 + Math.random() * 40) + 'px');
    p.style.background = deep;
    document.body.append(p);
    setTimeout(() => p.remove(), 900);
  }
}

/**
 * Embestida: una copia de la carta sale de `from` (rect), coge carrerilla,
 * vuela hasta `to` (rect), impacta (onImpact) y vuelve a su sitio.
 * cardEl: el elemento .card original (se clona para la animación).
 * Devuelve los ms hasta el impacto.
 */
export function strike(layer, cardEl, from, to, color, onImpact, { delay = 0 } = {}) {
  const DUR = reduce() ? 500 : 980;
  const HIT = 0.58; // momento del impacto (fracción)
  if (!cardEl || !from || !to || !from.width) {
    setTimeout(() => onImpact && onImpact(), delay);
    return delay;
  }
  const [light, deep] = magicColor(color);
  const w = from.width;
  const hgt = from.height;
  // las cartas giradas (tapped) se ven giradas: la copia vuela derecha
  const upright = hgt >= w;
  const cw = upright ? w : hgt;
  const ch = upright ? hgt : w;
  const sx = from.left + from.width / 2;
  const sy = from.top + from.height / 2;
  const tx = to.left + to.width / 2;
  const ty = to.top + to.height / 2;
  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  // se detiene justo al tocar el objetivo
  const stop = Math.max(0, dist - (Math.min(to.width, to.height) * 0.35 + ch * 0.25));
  const ang = Math.atan2(dy, dx) * 180 / Math.PI + 90; // la parte de arriba de la carta mira al objetivo
  const tilt = Math.max(-28, Math.min(28, ((ang + 540) % 360) - 180));

  const ghost = document.createElement('div');
  ghost.className = 'strike-ghost';
  ghost.style.width = cw + 'px';
  ghost.style.height = ch + 'px';
  ghost.style.left = sx - cw / 2 + 'px';
  ghost.style.top = sy - ch / 2 + 'px';
  ghost.style.setProperty('--aura-l', light);
  ghost.style.setProperty('--aura-d', deep);
  const clone = cardEl.cloneNode(true);
  clone.style.width = '100%';
  clone.style.height = '100%';
  clone.style.setProperty('--card-w', cw + 'px');
  ghost.append(clone);

  setTimeout(() => {
    layer.append(ghost);
    const back = { x: -ux * Math.min(40, dist * 0.12), y: -uy * Math.min(40, dist * 0.12) };
    const anim = ghost.animate([
      { transform: 'translate(0,0) scale(1) rotate(0deg)', offset: 0, easing: 'cubic-bezier(.3,0,.5,1)' },
      { transform: `translate(${back.x}px, ${back.y}px) scale(1.12) rotate(${-tilt * 0.3}deg)`, offset: 0.24, easing: 'cubic-bezier(.6,0,.9,.4)' },
      { transform: `translate(${ux * stop}px, ${uy * stop}px) scale(1.28) rotate(${tilt * 0.45}deg)`, offset: HIT, easing: 'cubic-bezier(.2,.8,.3,1)' },
      { transform: `translate(${ux * (stop - 26)}px, ${uy * (stop - 26)}px) scale(1.18) rotate(${tilt * 0.2}deg)`, offset: HIT + 0.1, easing: 'cubic-bezier(.4,0,.2,1)' },
      { transform: 'translate(0,0) scale(1) rotate(0deg)', offset: 1 },
    ], { duration: DUR, fill: 'forwards' });
    ghost.animate([{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.9 }, { opacity: 0 }], { duration: DUR, fill: 'forwards' });
    cardEl.classList.add('striking');
    // estela durante la carga
    const t0 = performance.now();
    const trail = () => {
      const t = (performance.now() - t0) / DUR;
      if (t > HIT || !ghost.isConnected) return;
      if (t > 0.22) {
        const r = ghost.getBoundingClientRect();
        for (let k = 0; k < 2; k++) {
          const p = document.createElement('div');
          p.className = 'strike-trail';
          p.style.left = r.left + r.width * (0.2 + Math.random() * 0.6) + 'px';
          p.style.top = r.top + r.height * (0.2 + Math.random() * 0.6) + 'px';
          p.style.background = Math.random() < 0.5 ? light : deep;
          p.style.boxShadow = `0 0 10px 3px ${deep}`;
          layer.append(p);
          setTimeout(() => p.remove(), 500);
        }
      }
      requestAnimationFrame(trail);
    };
    requestAnimationFrame(trail);
    setTimeout(() => onImpact && onImpact(), DUR * HIT);
    anim.onfinish = () => { ghost.remove(); cardEl.classList.remove('striking'); };
    setTimeout(() => { ghost.remove(); cardEl.classList.remove('striking'); }, DUR + 200);
  }, delay);
  return delay + DUR * HIT;
}

/** Destello y onda en el punto de impacto, del color de quien golpea. */
export function impactFlash(layer, rect, color, big = false) {
  if (!rect || !rect.width) return;
  const [light, deep] = magicColor(color);
  const size = Math.max(rect.width, rect.height) * (big ? 1.9 : 1.5);
  const box = document.createElement('div');
  box.className = 'strike-impact';
  Object.assign(box.style, { left: rect.left + rect.width / 2 + 'px', top: rect.top + rect.height / 2 + 'px', width: size + 'px', height: size + 'px' });
  box.style.setProperty('--aura-l', light);
  box.style.setProperty('--aura-d', deep);
  box.innerHTML = '<i class="core"></i><i class="ring"></i><i class="ring r2"></i><i class="slash"></i>';
  layer.append(box);
  // chispas
  for (let i = 0; i < 26; i++) {
    const p = document.createElement('div');
    p.className = 'strike-spark';
    const a = Math.random() * Math.PI * 2;
    const d = size * (0.3 + Math.random() * 0.55);
    p.style.left = rect.left + rect.width / 2 + 'px';
    p.style.top = rect.top + rect.height / 2 + 'px';
    p.style.setProperty('--dx', Math.cos(a) * d + 'px');
    p.style.setProperty('--dy', Math.sin(a) * d + 'px');
    p.style.background = i % 3 ? light : '#fff';
    p.style.boxShadow = `0 0 8px 2px ${deep}`;
    layer.append(p);
    setTimeout(() => p.remove(), 800);
  }
  setTimeout(() => box.remove(), 900);
}

/** Número de daño grande que salta desde el objetivo. */
export function damageNumber(layer, rect, amount) {
  if (!rect || !rect.width || !amount) return;
  const n = document.createElement('div');
  n.className = 'dmg-number';
  n.textContent = '-' + amount;
  n.style.left = rect.left + rect.width / 2 + 'px';
  n.style.top = rect.top + rect.height * 0.35 + 'px';
  layer.append(n);
  setTimeout(() => n.remove(), 1300);
}
