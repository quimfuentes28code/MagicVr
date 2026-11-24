// Representación visual de una carta (imagen de Scryfall con marco de respaldo).

import { h, manaCost, manaColor } from './dom.js';
import { explainType, keywordList } from './learn.js';
import { displayName } from '../engine/game.js';

export function cardFace(card, { big = false } = {}) {
  const color = card.colors[0] || card.produces?.[0] || 'C';
  const fallback = h('div', { class: 'card-fallback', style: { '--frame': manaColor(color) } },
    h('div', { class: 'cf-head' }, h('span', { class: 'cf-name' }, displayName(card)), manaCost(card.manaCost)),
    h('div', { class: 'cf-art' }, card.isLand ? '⛰' : card.isCreature ? '⚔' : '✦'),
    h('div', { class: 'cf-type' }, card.printedType || card.typeLine),
    h('div', { class: 'cf-text' }, card.printedText || card.oracle),
    card.isCreature ? h('div', { class: 'cf-pt' }, `${card.power}/${card.toughness}`) : null,
  );
  const el = h('div', { class: 'card' + (big ? ' big' : '') }, fallback);
  if (card.image) {
    const img = h('img', { src: card.image, alt: displayName(card), loading: 'lazy', draggable: 'false' });
    img.addEventListener('error', () => img.remove());
    img.addEventListener('load', () => el.classList.add('has-img'));
    el.append(img);
  }
  return el;
}

/** Ficha didáctica de una carta: imagen + qué es + palabras clave. */
export function cardInfo(card, extra = []) {
  const kws = keywordList(card);
  return h('div', { class: 'card-info' },
    cardFace(card, { big: true }),
    h('div', { class: 'ci-body' },
      h('h3', {}, displayName(card)),
      card.printedName && card.printedName !== card.name ? h('div', { class: 'muted' }, card.name) : null,
      h('div', { class: 'ci-cost' }, card.manaCost ? ['Coste: ', manaCost(card.manaCost), ` (${card.cmc} en total)`] : card.isLand ? 'Sin coste' : 'Coste 0'),
      h('p', { class: 'ci-type' }, explainType(card)),
      kws.length ? h('ul', { class: 'ci-kw' }, kws.map(([n, d]) => h('li', {}, h('b', {}, n + ': '), d))) : null,
      (card.printedText || card.oracle) ? h('p', { class: 'ci-oracle' }, card.printedText || card.oracle) : null,
      extra,
    ),
  );
}
