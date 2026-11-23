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
}

/**
 * Abre el editor sobre la mesa. elements: { screen, mid, board, summon, mat }.
 * onChange(layout) en cada cambio; onDone(layout) al pulsar «Listo».
 */
export function openCalibrator({ screen, mid, board, summon, mat, zones }, layout, { onChange, onDone, firstTime = false, extra = null }) {
  const L = { ...LAYOUT_DEFAULTS, ...layout };
  const update = () => {
    applyLayout(mid, L);
    mat.style.setProperty('--tilt', L.tilt + 'deg');
    onChange && onChange(L);
  };

  // Asas para arrastrar
  const leftHandle = h('div', { class: 'cal-handle cal-v cal-left', title: 'Borde izquierdo del tablero' }, h('span', {}, '⇔'));
  const rightHandle = h('div', { class: 'cal-handle cal-v cal-right', title: 'Borde derecho del tablero' }, h('span', {}, '⇔'));
  board.append(leftHandle, rightHandle);
  const midRect = () => mid.getBoundingClientRect();
  const drag = (el, onMove) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      const move = (ev) => { onMove(ev, midRect()); update(); };
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  };
  drag(leftHandle, (ev, r) => { L.bl = clamp(((ev.clientX - r.left) / r.width) * 100, 0, L.br - 25); });
  drag(rightHandle, (ev, r) => { L.br = clamp(((ev.clientX - r.left) / r.width) * 100, L.bl + 25, 100); });

  // Elementos que se pueden mover (arrastrando) y redimensionar (esquina ⤡):
  // el círculo de invocación y las casillas de mazo / cementerio / exilio.
  const cleanups = [];
  function movable(el, kx, ky, kh, label, minH = 25) {
    if (!el) return;
    const size = h('div', { class: 'cal-handle cal-size', title: 'Tamaño' }, '⤡');
    const hint = h('div', { class: 'cal-move' }, icon('portal'), label);
    el.append(size, hint);
    drag(size, (ev, r) => {
      const cy = r.top + (L[ky] / 100) * r.height;
      L[kh] = clamp(((ev.clientY - cy) * 2 / r.height) * 100, minH, 100);
    });
    let grab = null;
    const down = (e) => {
      if (e.target === size) return;
      e.preventDefault();
      const r = midRect();
      grab = { dx: e.clientX - (r.left + (L[kx] / 100) * r.width), dy: e.clientY - (r.top + (L[ky] / 100) * r.height) };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e) => {
      if (!grab) return;
      const r = midRect();
      L[kx] = clamp(((e.clientX - grab.dx - r.left) / r.width) * 100, 5, 95);
      L[ky] = clamp(((e.clientY - grab.dy - r.top) / r.height) * 100, 10, 90);
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
    });
  }
  movable(summon, 'sx', 'sy', 'sh', 'Círculo: arrastra para mover');
  movable(zones, 'zx', 'zy', 'zh', 'Mazo · cementerio · exilio');

  const tilt = h('input', { type: 'range', min: 0, max: 45, step: 1, value: L.tilt, onInput: (e) => { L.tilt = +e.target.value; update(); } });
  const panel = h('div', { class: 'cal-panel parchment' },
    h('div', { class: 'cal-text' },
      h('h3', {}, firstTime ? 'Antes de empezar: ajusta tu mesa' : 'Ajustar la mesa'),
      h('p', {}, 'Arrastra el ', h('b', {}, 'círculo'), ' y las casillas de ', h('b', {}, 'mazo, cementerio y exilio'), ' (tamaño con ⤡) y los ', h('b', {}, 'bordes ⇔'), ' del tablero. Con el ', h('b', {}, 'zoom'), ', haz que tus cartas encajen.'),
    ),
    extra,
    h('label', { class: 'slider' }, h('span', {}, 'Inclinación'), tilt),
    h('div', { class: 'cal-btns' },
      h('button', { class: 'act', onClick: () => { Object.assign(L, LAYOUT_DEFAULTS); tilt.value = L.tilt; update(); } }, 'Restablecer'),
      h('button', { class: 'act primary', onClick: done }, firstTime ? '¡A jugar!' : 'Listo'),
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
  return done;
}
