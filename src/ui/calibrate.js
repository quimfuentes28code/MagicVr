// "Ajustar mesa": con la cámara encendida, el jugador arrastra el círculo de
// invocación, cambia su tamaño y mueve los bordes del tablero para que todo
// encaje con su mesa real. Se guarda en el móvil y se usa en todas las partidas.

import { h } from './dom.js';
import { icon } from './icons.js';

// Por defecto: vista cenital (cámara en el techo mirando a la mesa), sin inclinación.
export const LAYOUT_DEFAULTS = { bl: 0, br: 58, sx: 84, sy: 50, sh: 70, zx: 65.5, zy: 70, zh: 56, tilt: 0 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Aplica la distribución (porcentajes) a la zona central de la mesa. */
export function applyLayout(mid, L) {
  mid.style.setProperty('--bl', L.bl + '%');
  mid.style.setProperty('--br', L.br + '%');
  mid.style.setProperty('--sx', L.sx + '%');
  mid.style.setProperty('--sy', L.sy + '%');
  mid.style.setProperty('--sh', L.sh + '%');
  mid.style.setProperty('--zx', L.zx + '%');
  mid.style.setProperty('--zy', L.zy + '%');
  mid.style.setProperty('--zh', L.zh + '%');
  updateCardCap(mid);
}

/**
 * Las cartas del tablero no pasan del tamaño de tu carta real: el del círculo de
 * invocación (que se ajusta a tu carta). Así no tapan la mesa.
 */
export function updateCardCap(mid) {
  const sh = parseFloat(mid.style.getPropertyValue('--sh')) / 100;
  if (!sh || !mid.clientHeight) return;
  mid.style.setProperty('--card-cap', Math.max(18, sh * mid.clientHeight * (63 / 88) * 0.93).toFixed(1) + 'px');
}

/**
 * Abre el editor sobre la mesa. elements: { screen, mid, board, summon, mat }.
 * onChange(layout) en cada cambio; onDone(layout) al pulsar «Listo».
 */
export function openCalibrator({ screen, mid, board, summon, mat, zones }, layout, { onChange, onDone, firstTime = false, extra = null, toLocal = null, defaults = LAYOUT_DEFAULTS, intro = '' }) {
  const L = { ...LAYOUT_DEFAULTS, ...layout };
  const smallChecks = [];
  const update = () => {
    applyLayout(mid, L);
    requestAnimationFrame(() => smallChecks.forEach((f) => f()));
    mat.style.setProperty('--tilt', L.tilt + 'deg');
    onChange && onChange(L);
  };

  // Asas para arrastrar
  const leftHandle = h('div', { class: 'cal-handle cal-v cal-left', title: 'Borde izquierdo del tablero' }, h('span', {}, '⇔'));
  const rightHandle = h('div', { class: 'cal-handle cal-v cal-right', title: 'Borde derecho del tablero' }, h('span', {}, '⇔'));
  board.append(leftHandle, rightHandle);
  // Posición del puntero en el plano de la mesa (que puede estar en perspectiva).
  const size = () => ({ w: mid.clientWidth, h: mid.clientHeight });
  const loc = (ev) => {
    if (toLocal) return toLocal(ev.clientX, ev.clientY);
    const r = mid.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  const midRect = () => size();
  const drag = (el, onMove) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      const move = (ev) => { onMove(loc(ev), midRect()); update(); };
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  };
  drag(leftHandle, (p, r) => { L.bl = clamp((p.x / r.w) * 100, 0, L.br - 25); });
  drag(rightHandle, (p, r) => { L.br = clamp((p.x / r.w) * 100, L.bl + 25, 100); });

  // Elementos que se pueden mover (arrastrando) y redimensionar (esquina ⤡):
  // el círculo de invocación y las casillas de mazo / cementerio / exilio.
  const cleanups = [];
  function movable(el, kx, ky, kh, label, minH = 25) {
    if (!el) return;
    const size = h('div', { class: 'cal-handle cal-size', title: 'Tamaño' }, '⤡');
    const hint = h('div', { class: 'cal-move' }, icon('portal'), h('span', { class: 'cal-move-txt' }, label));
    el.append(size, hint);
    // si queda muy pequeño, sólo el icono (para que el texto no se salga)
    smallChecks.push(() => el.classList.toggle('cal-small', el.offsetHeight < 120));
    drag(size, (p, r) => {
      const cy = (L[ky] / 100) * r.h;
      L[kh] = clamp(((p.y - cy) * 2 / r.h) * 100, minH, 100);
    });
    let grab = null;
    const down = (e) => {
      if (e.target === size) return;
      e.preventDefault();
      const r = midRect();
      const p = loc(e);
      grab = { dx: p.x - (L[kx] / 100) * r.w, dy: p.y - (L[ky] / 100) * r.h };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e) => {
      if (!grab) return;
      const r = midRect();
      const p = loc(e);
      L[kx] = clamp(((p.x - grab.dx) / r.w) * 100, 5, 95);
      L[ky] = clamp(((p.y - grab.dy) / r.h) * 100, 10, 90);
      update();
    };
    const up = () => { grab = null; };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.classList.add('cal-movable');
    cleanups.push(() => {
      size.remove(); hint.remove(); el.classList.remove('cal-movable');
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      el.classList.remove('cal-small');
    });
  }
  // Mínimos pequeños: con la cámara lejos de la mesa las cartas se ven pequeñas.
  movable(summon, 'sx', 'sy', 'sh', 'Círculo: arrastra para mover', 8);
  movable(zones, 'zx', 'zy', 'zh', 'Mazo · cementerio · exilio', 10);

  const tilt = h('input', { type: 'range', min: 0, max: 45, step: 1, value: L.tilt, onInput: (e) => { L.tilt = +e.target.value; update(); } });
  // Panel compacto y plegable, para que no tape las áreas que estás moviendo.
  const fold = h('button', { class: 'cal-fold', title: 'Plegar / desplegar el panel', onClick: () => { panel.classList.toggle('min'); fold.textContent = panel.classList.contains('min') ? '▴ Ajustes' : '▾ Ocultar'; } }, '▾ Ocultar');
  const panel = h('div', { class: 'cal-panel parchment' },
    h('div', { class: 'cal-text' },
      h('h3', {}, firstTime ? 'Antes de empezar: ajusta tu mesa' : 'Ajustar la mesa', fold),
      h('p', {}, intro, 'Arrastra el ', h('b', {}, 'círculo'), ' y las casillas de ', h('b', {}, 'mazo, cementerio y exilio'), ' (tamaño con ⤡) y los ', h('b', {}, 'bordes ⇔'), ' del tablero. ',
        '¿La cámara mira la mesa en ángulo? Pulsa ', h('b', {}, 'Adaptar a la mesa automáticamente'), '. Pliega este panel para mover las áreas cómodamente.'),
    ),
    h('div', { class: 'cal-controls' },
      extra,
      h('label', { class: 'slider' }, h('span', {}, 'Inclinación'), tilt),
      h('div', { class: 'cal-btns' },
        h('button', { class: 'act', onClick: () => { Object.assign(L, defaults); tilt.value = L.tilt; update(); } }, 'Restablecer'),
        h('button', { class: 'act primary', onClick: done }, firstTime ? '¡A jugar!' : 'Listo'),
      ),
    ),
  );
  screen.append(panel);
  screen.classList.add('calibrating');
  update();

  function done() {
    panel.remove();
    leftHandle.remove();
    rightHandle.remove();
    cleanups.forEach((f) => f());
    screen.classList.remove('calibrating');
    onDone && onDone({ ...L });
  }
  /** Cambia la distribución desde fuera (p. ej. «Adaptar el círculo a mi carta»). */
  done.set = (patch) => {
    Object.assign(L, patch);
    L.sh = clamp(L.sh, 8, 100);
    L.sx = clamp(L.sx, 5, 95);
    L.sy = clamp(L.sy, 10, 90);
    update();
  };
  return done;
}
