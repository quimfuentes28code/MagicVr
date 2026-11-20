// Selector de cartas: escanear con la cámara, buscar por nombre o atajos de tierras.

import { h, clear, sheet, manaColor } from './dom.js';
import { cardInfo } from './cardview.js';
import { BASICS } from '../engine/cards.js';
import { autocomplete, findCard } from '../scryfall.js';
import { startCamera, cameraSupported } from '../camera.js';
import { scanCardName } from '../scanner.js';

// Zona del marco guía (relativa al vídeo del escáner): franja del nombre.
const GUIDE = { x: 0.12, y: 0.18, w: 0.76, h: 0.6 };
const NAME_BAND = { x: GUIDE.x + 0.02, y: GUIDE.y + 0.01, w: GUIDE.w * 0.8, h: GUIDE.h * 0.1 };

/**
 * Abre el selector. onPick(card) se llama al confirmar.
 * opts: { title, confirmLabel, filter(card) -> string|null (mensaje de error) }
 */
export function openPicker(onPick, opts = {}) {
  const { title = 'Jugar una carta', confirmLabel = 'Jugar esta carta', filter = null, showLands = true } = opts;
  const body = h('div', { class: 'picker' });
  let close;
  let tab = cameraSupported() ? 'scan' : 'search';

  const preview = async (cardOrName) => {
    clear(body).append(h('div', { class: 'loading' }, 'Buscando carta…'));
    const card = typeof cardOrName === 'string' ? await findCard(cardOrName) : cardOrName;
    if (!card) {
      clear(body).append(h('p', {}, 'No he encontrado esa carta. Prueba a escribir el nombre.'), h('button', { class: 'btn', onClick: render }, 'Volver'));
      return;
    }
    const err = filter && filter(card);
    clear(body).append(
      cardInfo(card),
      err ? h('p', { class: 'warn' }, err) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onClick: render }, '← Otra'),
        h('button', { class: 'btn primary', disabled: !!err, onClick: () => { close(); onPick(card); } }, confirmLabel),
      ),
    );
  };

  const render = () => {
    clear(body);
    body.append(h('h2', {}, title));
    const tabs = h('div', { class: 'tabs' },
      cameraSupported() ? h('button', { class: tab === 'scan' ? 'on' : '', onClick: () => { tab = 'scan'; render(); } }, '📷 Escanear') : null,
      h('button', { class: tab === 'search' ? 'on' : '', onClick: () => { tab = 'search'; render(); } }, '🔎 Buscar'),
    );
    body.append(tabs);
    if (showLands) {
      body.append(h('div', { class: 'quick-lands' },
        Object.entries(BASICS).map(([col, card]) =>
          h('button', { class: 'land-btn', style: { '--c': manaColor(col) }, onClick: () => preview(card) }, card.printedName)),
      ));
    }
    body.append(tab === 'scan' ? scanPane(preview) : searchPane(preview));
  };

  render();
  close = sheet(body, { className: 'tall', onClose: () => body.querySelector('video')?.pause() });
  return close;
}

function searchPane(preview) {
  const list = h('div', { class: 'suggestions' });
  let timer = null;
  let seq = 0;
  const input = h('input', {
    type: 'search', placeholder: 'Nombre de la carta (español o inglés)…', autocomplete: 'off', enterkeyhint: 'search',
    onInput: () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const my = ++seq;
        const names = await autocomplete(input.value);
        if (my !== seq) return;
        clear(list).append(...names.map((n) => h('button', { class: 'sugg', onClick: () => preview(n) }, n)));
      }, 220);
    },
    onKeydown: (e) => { if (e.key === 'Enter' && input.value.trim()) preview(input.value); },
  });
  setTimeout(() => input.focus(), 250);
  return h('div', { class: 'search-pane' }, input, list);
}

function scanPane(preview) {
  const video = h('video', { autoplay: true, playsinline: true, muted: true });
  const status = h('div', { class: 'scan-status' }, 'Coloca la carta dentro del marco, con el NOMBRE en la franja de arriba.');
  const results = h('div', { class: 'suggestions' });
  const guide = h('div', { class: 'scan-guide', style: pct(GUIDE) }, h('div', { class: 'scan-band', style: pctIn(NAME_BAND, GUIDE) }));
  const btn = h('button', { class: 'btn primary big' }, '📸 Escanear');
  btn.onclick = async () => {
    btn.disabled = true;
    status.textContent = 'Leyendo el nombre…';
    try {
      const r = await scanCardName(video, NAME_BAND, (st, p) => {
        if (/loading|initializing/.test(st)) status.textContent = `Preparando el lector (sólo la primera vez)… ${Math.round(p * 100)}%`;
      });
      if (r.card) {
        preview(r.card);
        return;
      }
      status.textContent = r.text ? `He leído "${r.text}" pero no la encuentro. ¿Es alguna de estas?` : 'No he podido leer el nombre. Acerca un poco más la carta y que haya buena luz.';
      clear(results).append(...r.suggestions.map((n) => h('button', { class: 'sugg', onClick: () => preview(n) }, n)));
    } catch (e) {
      status.textContent = 'Error al escanear: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  };
  startCamera(video).catch((e) => { status.textContent = 'No puedo abrir la cámara: ' + e.message + ' Usa la pestaña Buscar.'; });
  return h('div', { class: 'scan-pane' }, h('div', { class: 'scan-view' }, video, guide), status, btn, results);
}

const pct = (r) => ({ left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%' });
const pctIn = (r, p) => ({
  left: ((r.x - p.x) / p.w) * 100 + '%', top: ((r.y - p.y) / p.h) * 100 + '%',
  width: (r.w / p.w) * 100 + '%', height: (r.h / p.h) * 100 + '%',
});
