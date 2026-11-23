// Grimorio: búsqueda manual de cartas (por si la cámara no puede leer una).

import { h, clear, sheet, manaColor } from './dom.js';
import { cardInfo } from './cardview.js';
import { BASICS } from '../engine/cards.js';
import { autocomplete, findCard } from '../scryfall.js';

/**
 * Abre el grimorio. onPick(card) se llama al confirmar.
 * opts: { title, confirmLabel, filter(card) -> string|null, showLands }
 */
export function openPicker(onPick, opts = {}) {
  const { title = 'Grimorio', confirmLabel = 'Invocar esta carta', filter = null, showLands = true } = opts;
  const body = h('div', { class: 'grimoire' });
  let close;

  const preview = async (cardOrName) => {
    clear(body).append(h('div', { class: 'loading' }, 'Consultando el grimorio…'));
    const card = typeof cardOrName === 'string' ? await findCard(cardOrName) : cardOrName;
    if (!card) {
      clear(body).append(h('p', {}, 'No encuentro esa carta en el grimorio.'), h('button', { class: 'act', onClick: render }, 'Volver'));
      return;
    }
    const err = filter && filter(card);
    clear(body).append(
      cardInfo(card, [
        err ? h('p', { class: 'warn' }, err) : null,
        h('div', { class: 'row-btns' },
          h('button', { class: 'act', onClick: render }, '← Otra'),
          h('button', { class: 'act primary', disabled: !!err, onClick: () => { close(); onPick(card); } }, confirmLabel),
        ),
      ]),
    );
  };

  const list = h('div', { class: 'suggestions' });
  let timer = null;
  let seq = 0;
  const input = h('input', {
    class: 'field-input', type: 'search', placeholder: 'Nombre de la carta (español o inglés)…', autocomplete: 'off', enterkeyhint: 'search',
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

  function render() {
    clear(body).append(
      h('h3', {}, title),
      h('p', { class: 'muted' }, 'Lo normal es poner la carta en el círculo de invocación y la cámara la reconoce sola. Usa el grimorio si no la lee.'),
      showLands ? h('div', { class: 'quick-lands' },
        Object.entries(BASICS).map(([col, card]) =>
          h('button', { class: 'land-btn', style: { '--c': manaColor(col) }, onClick: () => preview(card) }, card.printedName))) : null,
      input,
      list,
    );
  }

  render();
  close = sheet(body);
  return close;
}
