// Datos de cartas: normalización de Scryfall + una pequeña base de datos local
// (funciona sin conexión para el tutorial y los mazos de los bots).

const IMG = (name) =>
  `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=normal`;

export const COLOR_NAMES = { W: 'Blanco', U: 'Azul', B: 'Negro', R: 'Rojo', G: 'Verde', C: 'Incoloro' };

import data from '../data/cards.json' with { type: 'json' };
import { parseEffects } from './effects.js';

const BASIC_LAND_COLOR = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };

/** Convierte una carta de la API de Scryfall a nuestro formato interno. */
export function fromScryfall(sc) {
  const face = sc.card_faces && !sc.image_uris ? sc.card_faces[0] : null;
  const main = face || sc;
  const typeLine = main.type_line || sc.type_line || '';
  return normalize({
    id: sc.id,
    name: main.name || sc.name,
    printedName: sc.printed_name || (face && face.printed_name) || null,
    image: (sc.image_uris && sc.image_uris.normal) || (face && face.image_uris && face.image_uris.normal) || IMG(sc.name),
    manaCost: main.mana_cost || sc.mana_cost || '',
    cmc: sc.cmc || 0,
    typeLine,
    oracle: main.oracle_text || sc.oracle_text || '',
    printedText: sc.printed_text || null,
    power: main.power ?? sc.power,
    toughness: main.toughness ?? sc.toughness,
    colors: main.colors || sc.colors || sc.color_identity || [],
    keywords: sc.keywords || [],
  });
}

/** Rellena campos derivados (tipo, colores de maná que produce, etc). */
export function normalize(c) {
  const typeLine = c.typeLine || '';
  const n = (v) => (v === undefined || v === null ? null : parseInt(v, 10) || 0);
  const card = {
    id: c.id || 'local:' + c.name,
    name: c.name,
    printedName: c.printedName || null,
    image: c.image || IMG(c.name),
    manaCost: c.manaCost || '',
    cmc: c.cmc ?? cmcOf(c.manaCost || ''),
    typeLine,
    oracle: c.oracle || '',
    printedText: c.printedText || null,
    power: n(c.power),
    toughness: n(c.toughness),
    colors: c.colors || colorsOf(c.manaCost || ''),
    keywords: (c.keywords || []).map((k) => k.toLowerCase()),
  };
  card.isLand = /\bLand\b/.test(typeLine);
  card.isCreature = /\bCreature\b/.test(typeLine);
  card.isInstant = /\bInstant\b/.test(typeLine);
  card.isSorcery = /\bSorcery\b/.test(typeLine);
  card.isLegendary = /\bLegendary\b/.test(typeLine);
  card.isPermanent = !card.isInstant && !card.isSorcery;
  card.produces = manaProduced(card);
  card.effects = parseEffects(card);
  return card;
}

export function cmcOf(cost) {
  let total = 0;
  for (const p of pips(cost)) {
    if (/^\d+$/.test(p)) total += parseInt(p, 10);
    else if (p !== 'X') total += 1;
  }
  return total;
}

export function pips(cost) {
  return [...(cost || '').matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
}

function colorsOf(cost) {
  const set = new Set();
  for (const p of pips(cost)) for (const ch of p) if ('WUBRG'.includes(ch)) set.add(ch);
  return [...set];
}

/** Qué colores de maná puede producir una carta (tierras y "elfos de maná"). */
function manaProduced(card) {
  const out = new Set();
  for (const [word, col] of Object.entries(BASIC_LAND_COLOR)) {
    if (new RegExp('\\b' + word + '\\b').test(card.typeLine)) out.add(col);
  }
  const o = card.oracle || '';
  const addMatches = o.match(/Add[^.\n]*/g) || [];
  for (const m of addMatches) {
    if (/any color/i.test(m)) 'WUBRG'.split('').forEach((c) => out.add(c));
    for (const p of pips(m)) if ('WUBRGC'.includes(p)) out.add(p);
  }
  if (card.isLand && out.size === 0) out.add('C');
  return [...out];
}

// Cartas oficiales de los 5 mazos de práctica (generado con scripts/build-cards.mjs).
export const CARD_DATA = Object.fromEntries(
  Object.entries(data.cards).map(([k, c]) => [k, normalize({ ...c, id: 'db:' + c.name })]),
);
export const LOCAL_CARDS = Object.values(CARD_DATA);

export const BASICS = {
  W: CARD_DATA.Plains, U: CARD_DATA.Island, B: CARD_DATA.Swamp, R: CARD_DATA.Mountain, G: CARD_DATA.Forest,
};

export function localCard(name) {
  const q = name.trim().toLowerCase();
  return LOCAL_CARDS.find((c) => c.name.toLowerCase() === q || (c.printedName || '').toLowerCase() === q) || null;
}

export function searchLocal(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  return LOCAL_CARDS.filter((c) => c.name.toLowerCase().includes(q) || (c.printedName || '').toLowerCase().includes(q));
}

/** Mazos de práctica: { G: { label, blurb, commander, list: [[nombre, copias]] }, ... } */
export const BOT_DECKS = data.decks;

/** Lista de cartas de un mazo. Para Commander (99) se repite la lista. */
export function buildBotDeck(color, size = 60) {
  const base = [];
  for (const [name, n] of BOT_DECKS[color].list) for (let i = 0; i < n; i++) base.push(CARD_DATA[name]);
  const out = [];
  while (out.length < size) out.push(...base);
  return out.slice(0, size).filter(Boolean);
}
