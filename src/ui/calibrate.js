// "Ajustar mesa": con la cámara encendida, el jugador arrastra el círculo de
// invocación, cambia su tamaño y mueve los bordes del tablero para que todo
// encaje con su mesa real. Se guarda en el móvil y se usa en todas las partidas.

import { h } from './dom.js';
import { icon } from './icons.js';

export const LAYOUT_DEFAULTS = { bl: 0, br: 66, sx: 80, sy: 48, sh: 74, tilt: 18 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Aplica la distribución (porcentajes) a la zona central de la mesa. */
export function applyLayout(mid, L) {
  mid.style.setProperty('--bl', L.bl + '%');
  mid.style.setProperty('--br', L.br + '%');
  mid.style.setProperty('--sx', L.sx + '%');
  mid.style.setProperty('--sy', L.sy + '%');
  mid.style.setProperty('--sh', L.sh + '%');
}

/**
 * Abre el editor sobre la mesa. elements: { screen, mid, board, summon, mat }.
 * onChange(layout) en cada cambio; onDone(layout) al pulsar «Listo».
 */
export function openCalibrator({ screen, mid, board, summon, mat }, layout, { onChange, onDone, firstTime = false }) {
  const L = { ...LAYOUT_DEFAULTS, ...layout };
  const update = () => {
    applyLayout(mid, L);
    mat.style.setProperty('--tilt', L.tilt + 'deg');
    onChange && onChange(L);
  };

  // Asas para arrastrar
  const leftHandle = h('div', { class: 'cal-handle cal-v cal-left', title: 'Borde izquierdo del tablero' }, h('span', {}, '⇔'));
  const rightHandle = h('div', { class: 'cal-handle cal-v cal-right', title: 'Borde derecho del tablero' }, h('span', {}, '⇔'));
  const sizeHandle = h('div', { class: 'cal-handle cal-size', title: 'Tamaño del círculo' }, '⤡');
  const moveHint = h('div', { class: 'cal-move' }, icon('portal'), 'Arrastra para mover');
  board.append(leftHandle, rightHandle);
  summon.append(sizeHandle, moveHint);

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
  drag(sizeHandle, (ev, r) => {
    const cy = r.top + (L.sy / 100) * r.height;
    L.sh = clamp(((ev.clientY - cy) * 2 / r.height) * 100, 35, 100);
  });
  let grab = null;
  summon.addEventListener('pointerdown', onSummonDown);
  function onSummonDown(e) {
    if (e.target === sizeHandle) return;
    e.preventDefault();
    const r = midRect();
    grab = { dx: e.clientX - (r.left + (L.sx / 100) * r.width), dy: e.clientY - (r.top + (L.sy / 100) * r.height) };
    summon.setPointerCapture(e.pointerId);
  }
  const onSummonMove = (e) => {
    if (!grab) return;
    const r = midRect();
    L.sx = clamp(((e.clientX - grab.dx - r.left) / r.width) * 100, 8, 92);
    L.sy = clamp(((e.clientY - grab.dy - r.top) / r.height) * 100, 15, 85);
    update();
  };
  const onSummonUp = () => { grab = null; };
  summon.addEventListener('pointermove', onSummonMove);
  summon.addEventListener('pointerup', onSummonUp);
  summon.addEventListener('pointercancel', onSummonUp);

  const tilt = h('input', { type: 'range', min: 0, max: 45, step: 1, value: L.tilt, onInput: (e) => { L.tilt = +e.target.value; update(); } });
  const panel = h('div', { class: 'cal-panel parchment' },
    h('div', { class: 'cal-text' },
      h('h3', {}, firstTime ? 'Antes de empezar: ajusta tu mesa' : 'Ajustar la mesa'),
      h('p', {}, 'Arrastra el ', h('b', {}, 'círculo'), ' (tamaño con ⤡) y los ', h('b', {}, 'bordes ⇔'), ' del tablero para que encajen con tu mesa.'),
    ),
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
    sizeHandle.remove();
    moveHint.remove();
    summon.removeEventListener('pointerdown', onSummonDown);
    summon.removeEventListener('pointermove', onSummonMove);
    summon.removeEventListener('pointerup', onSummonUp);
    summon.removeEventListener('pointercancel', onSummonUp);
    screen.classList.remove('calibrating');
    onDone && onDone({ ...L });
  }
  return done;
}
