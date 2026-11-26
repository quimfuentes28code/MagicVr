// Biblioteca: tus mazos y tu colección. Se rellenan escaneando las cartas con la
// cámara (una a una, en el círculo) o buscándolas en el grimorio. Se guarda en el
// propio dispositivo.

import { h, clear, sheet, toast, manaColor } from './dom.js';
import { icon } from './icons.js';
import { cardFace, cardInfo } from './cardview.js';
import { openPicker } from './picker.js';
import { startCamera, stopCamera, cameraSupported, cameraErrorText } from '../camera.js';
import { CardWatcher, preloadVision } from '../vision.js';
import { displayName } from '../engine/game.js';
import { cardByOracle } from '../carddb.js';
import { sfx } from './sfx.js';
import { buzz } from '../native.js';

const KEY = 'mtgvr-library';

// ------------------------------------------------------------ almacenamiento
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && Array.isArray(v.decks) && v.collection) return { deleted: [], ...v };
  } catch { /* */ }
  return { decks: [], collection: {} };
}
let lib = load();
const saveHooks = new Set();
function save() {
  lib.updated = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(lib)); } catch { toast('No se pudo guardar la biblioteca (¿memoria llena?).', 'warn'); }
  for (const fn of saveHooks) { try { fn(lib); } catch { /* */ } }
}

/** Para sincronizar con el perfil: leer, reemplazar y enterarse de cada cambio. */
export const getLibrary = () => lib;
export function setLibrary(v) {
  if (!v || !Array.isArray(v.decks)) return;
  lib = { decks: v.decks, collection: v.collection || {}, updated: v.updated || Date.now(), deleted: v.deleted || [] };
  try { localStorage.setItem(KEY, JSON.stringify(lib)); } catch { /* */ }
}
export function onLibrarySave(fn) { saveHooks.add(fn); return () => saveHooks.delete(fn); }

/** Datos mínimos de una carta para guardarla (con la imagen de SU edición). */
function entryOf(card) {
  return {
    id: card.id,
    name: card.name,
    printed: card.printedName || null,
    image: card.image || null,
    type: card.typeLine || card.type || '',
    cmc: card.cmc || 0,
    colors: card.colors || [],
    legendary: !!(card.isLegendary ?? card.legendary),
    creature: !!(card.isCreature ?? card.creature),
  };
}
const keyOf = (e) => e.id + '|' + (e.image || '');
const entryName = (e) => e.printed || e.name;

/** Carta completa (para ver su texto) a partir de lo guardado. */
function cardOfEntry(e) {
  const base = cardByOracle(e.id);
  return base ? { ...base, image: e.image || base.image } : null;
}

function addTo(store, card, n = 1) {
  const e = entryOf(card);
  const k = keyOf(e);
  const cur = store[k];
  if (cur) cur.n += n;
  else store[k] = { ...e, n };
  if (store[k].n <= 0) delete store[k];
  return k;
}
const countOf = (store) => Object.values(store).reduce((a, e) => a + e.n, 0);

function newDeck(name = 'Mazo nuevo', format = '1v1') {
  const d = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, format, cards: {}, commander: null, created: Date.now() };
  lib.decks.unshift(d);
  save();
  return d;
}

/** Al meter una carta en un mazo, la colección tiene al menos esas copias. */
function syncCollection(deck, k) {
  const e = deck.cards[k];
  if (!e) return;
  const c = lib.collection[k];
  if (!c) lib.collection[k] = { ...e };
  else if (c.n < e.n) c.n = e.n;
}

// ------------------------------------------------------------- utilidades
const TYPE_GROUPS = [
  ['Criaturas', (e) => /Creature/.test(e.type)],
  ['Planeswalkers', (e) => /Planeswalker/.test(e.type)],
  ['Instantáneos y conjuros', (e) => /Instant|Sorcery/.test(e.type)],
  ['Artefactos y encantamientos', (e) => /Artifact|Enchantment|Battle/.test(e.type)],
  ['Tierras', (e) => /Land/.test(e.type)],
];
function groupOf(e) {
  const g = TYPE_GROUPS.find(([, f]) => f(e));
  return g ? g[0] : 'Otras';
}
function deckColors(deck) {
  const set = new Set();
  Object.values(deck.cards).forEach((e) => (e.colors || []).forEach((c) => set.add(c)));
  return ['W', 'U', 'B', 'R', 'G'].filter((c) => set.has(c));
}
const pips = (cols) => h('span', { class: 'lib-pips' }, cols.map((c) => h('span', { class: 'pip', style: { background: manaColor(c) } })));
const target = (deck) => (deck.format === 'commander' ? 100 : 60);

function cardTile(e, onClick, extra = null) {
  return h('button', { class: 'deck-card lib-card', onClick },
    e.image ? h('img', { class: 'lib-img', src: e.image.replace('/normal/', '/small/'), alt: entryName(e), loading: 'lazy' }) : h('div', { class: 'lib-noimg' }, entryName(e)),
    e.n > 1 ? h('span', { class: 'qty' }, '×' + e.n) : null,
    extra);
}

// ------------------------------------------------------------- pantallas
let root = null;
let goBack = null;
let shell = null; // (titulo, onBack, ...hijos) => pantalla

/** Abre la biblioteca. mount(el) pinta una pantalla; back vuelve al menú. */
export function openLibrary({ app, subScreen, onBack }) {
  root = app;
  goBack = onBack;
  shell = subScreen;
  libraryHome('decks');
}

function libraryHome(tab = 'decks') {
  lib = load();
  const tabs = h('div', { class: 'book-tabs' },
    h('button', { class: 'sigil-opt' + (tab === 'decks' ? ' on' : ''), onClick: () => libraryHome('decks') }, icon('cards'), `Mis mazos (${lib.decks.length})`),
    h('button', { class: 'sigil-opt' + (tab === 'coll' ? ' on' : ''), onClick: () => libraryHome('coll') }, icon('book'), `Mi colección (${countOf(lib.collection)})`));
  const body = tab === 'decks' ? decksView() : collectionView();
  clear(root).append(shell('Biblioteca', goBack, h('div', { class: 'book' }, tabs, body)));
}

function decksView() {
  const tiles = lib.decks.map((d) => {
    const n = countOf(d.cards);
    const cover = (d.commander && d.cards[d.commander]) || Object.values(d.cards)[0];
    return h('button', { class: 'lib-deck', onClick: () => deckScreen(d.id) },
      h('div', { class: 'lib-cover', style: cover && cover.image ? { backgroundImage: `url(${cover.image.replace('/normal/', '/art_crop/')})` } : {} }),
      h('div', { class: 'lib-deck-info' },
        h('b', {}, d.name),
        h('span', {}, `${d.format === 'commander' ? 'Commander' : 'Duelo'} · ${n}/${target(d)} cartas`),
        pips(deckColors(d))));
  });
  return h('div', { class: 'deck-view parchment' },
    h('div', { class: 'lib-decks' },
      h('button', { class: 'lib-deck lib-new', onClick: createDeckDialog }, h('span', { class: 'plus' }, '+'), h('b', {}, 'Nuevo mazo'), h('span', {}, 'Escanea tus cartas una a una')),
      ...tiles),
    !lib.decks.length ? h('p', { class: 'muted', style: { marginTop: '12px' } }, 'Aún no tienes mazos. Crea uno y ve poniendo tus cartas en el círculo: cada carta reconocida se añade sola.') : null);
}

function createDeckDialog() {
  let format = '1v1';
  const name = h('input', { class: 'field-input', placeholder: 'Nombre del mazo', maxLength: 40, value: `Mazo ${lib.decks.length + 1}` });
  const segs = h('div', { class: 'seg' });
  const paint = () => clear(segs).append(
    h('button', { class: 'sigil-opt' + (format === '1v1' ? ' on' : ''), onClick: () => { format = '1v1'; paint(); } }, icon('swords'), 'Duelo (60)'),
    h('button', { class: 'sigil-opt' + (format === 'commander' ? ' on' : ''), onClick: () => { format = 'commander'; paint(); } }, icon('crown'), 'Commander (100)'));
  paint();
  const close = sheet(h('div', {},
    h('h3', {}, 'Nuevo mazo'),
    h('label', { class: 'field-label' }, 'Nombre'), name,
    h('label', { class: 'field-label', style: { marginTop: '10px', display: 'block' } }, 'Formato'), segs,
    h('div', { class: 'actions', style: { marginTop: '14px' } },
      h('button', { class: 'act primary', onClick: () => { const d = newDeck(name.value.trim() || 'Mazo nuevo', format); close(); deckScreen(d.id); } }, 'Crear y empezar a escanear'))));
  setTimeout(() => name.select(), 80);
}

function deckScreen(id) {
  lib = load();
  const deck = lib.decks.find((d) => d.id === id);
  if (!deck) return libraryHome('decks');
  const n = countOf(deck.cards);
  const groups = new Map();
  const entries = Object.entries(deck.cards).sort((a, b) => a[1].cmc - b[1].cmc || entryName(a[1]).localeCompare(entryName(b[1])));
  for (const [k, e] of entries) {
    if (k === deck.commander) continue;
    const g = groupOf(e);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push([k, e]);
  }
  const order = [...TYPE_GROUPS.map(([g]) => g), 'Otras'];
  const cmd = deck.commander && deck.cards[deck.commander];
  const name = h('input', { class: 'field-input lib-name', value: deck.name, maxLength: 40, onChange: (ev) => { deck.name = ev.target.value.trim() || deck.name; save(); } });
  const body = h('div', { class: 'deck-view parchment' },
    h('div', { class: 'lib-head' },
      name,
      h('span', { class: 'lib-count' + (n === target(deck) ? ' ok' : '') }, `${n}/${target(deck)}`),
      pips(deckColors(deck))),
    h('div', { class: 'lib-actions' },
      h('button', { class: 'gem small', onClick: () => scanScreen({ deckId: deck.id }) }, icon('eye'), 'Escanear cartas'),
      h('button', { class: 'gem small bronze', onClick: () => openPicker((card) => { const k = addTo(deck.cards, card); syncCollection(deck, k); save(); toast(`${displayName(card)} añadida.`); deckScreen(id); }, { title: 'Añadir al mazo', confirmLabel: 'Añadir al mazo', showLands: true }) }, icon('grimoire'), 'Añadir buscando'),
      h('button', { class: 'gem small bronze', onClick: () => deckOptions(deck) }, icon('gear'), 'Opciones')),
    cmd ? [h('h3', { class: 'lib-group' }, 'Comandante'), h('div', { class: 'deck-grid' }, cardTile(cmd, () => entrySheet(deck, deck.commander), h('span', { class: 'lib-crown' }, icon('crown'))))] : null,
    order.filter((g) => groups.has(g)).map((g) => [
      h('h3', { class: 'lib-group' }, `${g} (${groups.get(g).reduce((a, [, e]) => a + e.n, 0)})`),
      h('div', { class: 'deck-grid' }, groups.get(g).map(([k, e]) => cardTile(e, () => entrySheet(deck, k)))),
    ]),
    !n ? h('p', { class: 'muted', style: { marginTop: '12px' } }, 'Mazo vacío. Pulsa «Escanear cartas» y ve poniéndolas en el círculo, una detrás de otra.') : null);
  clear(root).append(shell(deck.name, () => libraryHome('decks'), h('div', { class: 'book' }, body)));
}

function deckOptions(deck) {
  const close = sheet(h('div', {},
    h('h3', {}, deck.name),
    h('div', { class: 'actions' },
      h('button', { class: 'act', onClick: () => { deck.format = deck.format === 'commander' ? '1v1' : 'commander'; if (deck.format !== 'commander') deck.commander = null; save(); close(); deckScreen(deck.id); } },
        deck.format === 'commander' ? 'Cambiar a Duelo (60 cartas)' : 'Cambiar a Commander (100 cartas)'),
      h('button', { class: 'act', onClick: () => { const copy = JSON.parse(JSON.stringify(deck)); copy.id = Date.now().toString(36); copy.name = deck.name + ' (copia)'; lib.decks.unshift(copy); save(); close(); deckScreen(copy.id); } }, 'Duplicar mazo'),
      h('button', { class: 'act', onClick: () => { close(); exportDeck(deck); } }, 'Copiar lista de cartas'),
      h('button', { class: 'act danger', onClick: () => { if (!confirm(`¿Borrar el mazo «${deck.name}»? Las cartas siguen en tu colección.`)) return; lib.decks = lib.decks.filter((d) => d.id !== deck.id); lib.deleted = [...(lib.deleted || []), deck.id].slice(-200); save(); close(); libraryHome('decks'); } }, 'Borrar mazo'))));
}

function exportDeck(deck) {
  const lines = Object.entries(deck.cards).map(([k, e]) => `${e.n} ${e.name}${k === deck.commander ? ' *CMDR*' : ''}`);
  const text = lines.join('\n');
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
    .then(() => toast('Lista copiada: puedes pegarla en Moxfield, Archidekt…'))
    .catch(() => sheet(h('div', {}, h('h3', {}, 'Lista del mazo'), h('textarea', { class: 'field-input', style: { height: '50vh', width: '100%' } }, text))));
}

function entrySheet(deck, k) {
  const e = deck.cards[k];
  if (!e) return;
  const card = cardOfEntry(e);
  const refresh = () => { save(); close(); deckScreen(deck.id); };
  const canCmd = deck.format === 'commander' && e.legendary && e.creature;
  const close = sheet(h('div', {},
    card ? cardInfo(card) : h('h3', {}, entryName(e)),
    h('p', { class: 'muted' }, `En este mazo: ${e.n} ${e.n === 1 ? 'copia' : 'copias'}.`),
    h('div', { class: 'row-btns' },
      h('button', { class: 'act', onClick: () => { e.n -= 1; if (e.n <= 0) { delete deck.cards[k]; if (deck.commander === k) deck.commander = null; } refresh(); } }, '−1'),
      h('button', { class: 'act', onClick: () => { e.n += 1; syncCollection(deck, k); refresh(); } }, '+1'),
      canCmd ? h('button', { class: 'act primary', onClick: () => { deck.commander = deck.commander === k ? null : k; refresh(); } }, deck.commander === k ? 'Quitar de comandante' : 'Hacer comandante') : null,
      h('button', { class: 'act danger', onClick: () => { delete deck.cards[k]; if (deck.commander === k) deck.commander = null; refresh(); } }, 'Quitar del mazo'))));
}

function collectionView() {
  const all = Object.entries(lib.collection).sort((a, b) => entryName(a[1]).localeCompare(entryName(b[1])));
  const grid = h('div', { class: 'deck-grid' });
  const paint = (q = '') => {
    const k = q.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const list = all.filter(([, e]) => !k || (e.name + ' ' + (e.printed || '')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(k));
    clear(grid).append(...list.map(([key, e]) => cardTile(e, () => collectionSheet(key))));
  };
  paint();
  const unique = new Set(all.map(([, e]) => e.id)).size;
  return h('div', { class: 'deck-view parchment' },
    h('div', { class: 'lib-head' },
      h('span', {}, h('b', {}, countOf(lib.collection)), ` cartas · ${unique} distintas`),
      h('input', { class: 'field-input lib-search', type: 'search', placeholder: 'Buscar en tu colección…', onInput: (ev) => paint(ev.target.value) })),
    h('div', { class: 'lib-actions' },
      h('button', { class: 'gem small', onClick: () => scanScreen({ collection: true }) }, icon('eye'), 'Escanear cartas'),
      h('button', { class: 'gem small bronze', onClick: () => openPicker((card) => { addTo(lib.collection, card); save(); toast(`${displayName(card)} añadida a tu colección.`); libraryHome('coll'); }, { title: 'Añadir a la colección', confirmLabel: 'Añadir', showLands: true }) }, icon('grimoire'), 'Añadir buscando')),
    grid,
    !all.length ? h('p', { class: 'muted', style: { marginTop: '12px' } }, 'Tu colección está vacía. Escanea tus cartas (o crea mazos: sus cartas se añaden aquí solas).') : null);
}

function collectionSheet(k) {
  const e = lib.collection[k];
  if (!e) return;
  const card = cardOfEntry(e);
  const refresh = () => { save(); close(); libraryHome('coll'); };
  const inDecks = lib.decks.filter((d) => d.cards[k]).map((d) => `${d.name} (${d.cards[k].n})`);
  const close = sheet(h('div', {},
    card ? cardInfo(card) : h('h3', {}, entryName(e)),
    h('p', { class: 'muted' }, `Tienes ${e.n} ${e.n === 1 ? 'copia' : 'copias'}.` + (inDecks.length ? ` En tus mazos: ${inDecks.join(', ')}.` : '')),
    h('div', { class: 'row-btns' },
      h('button', { class: 'act', onClick: () => { e.n -= 1; if (e.n <= 0) delete lib.collection[k]; refresh(); } }, '−1'),
      h('button', { class: 'act', onClick: () => { e.n += 1; refresh(); } }, '+1'),
      lib.decks.length ? h('button', { class: 'act primary', onClick: () => { close(); addToDeckSheet(e); } }, 'Añadir a un mazo') : null)));
}

function addToDeckSheet(e) {
  const close = sheet(h('div', {},
    h('h3', {}, `Añadir ${entryName(e)} a…`),
    h('div', { class: 'actions' }, lib.decks.map((d) => h('button', { class: 'act', onClick: () => {
      const k = keyOf(e);
      if (d.cards[k]) d.cards[k].n += 1; else d.cards[k] = { ...e, n: 1 };
      save(); close(); toast(`Añadida a ${d.name}.`);
    } }, `${d.name} (${countOf(d.cards)})`)))));
}

// ------------------------------------------------------------ escáner
/**
 * Pantalla de escaneo: la cámara con el círculo. Cada carta reconocida se añade
 * al mazo (o a la colección). Para varias copias: quita la carta y vuelve a ponerla
 * (o pulsa +1).
 */
function scanScreen({ deckId = null, collection = false }) {
  lib = load();
  const deck = deckId ? lib.decks.find((d) => d.id === deckId) : null;
  const store = deck ? deck.cards : lib.collection;
  const label = deck ? deck.name : 'Mi colección';
  const video = h('video', { class: 'cam scan-cam', autoplay: true, muted: true, playsinline: true });
  const frame = h('div', { class: 'scan-frame' }, h('i', { class: 'c1' }), h('i', { class: 'c2' }), h('i', { class: 'c3' }), h('i', { class: 'c4' }));
  const status = h('div', { class: 'scan-status' }, 'Despertando el ojo arcano…');
  const counter = h('div', { class: 'scan-count' });
  const recent = h('div', { class: 'scan-recent' });
  const outline = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  outline.setAttribute('class', 'card-outline');
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  outline.append(poly);
  const history = []; // [{ k, name }]
  const paintCount = () => {
    const n = countOf(store);
    counter.textContent = deck ? `${n}/${target(deck)} cartas` : `${n} cartas en tu colección`;
  };
  const paintRecent = () => {
    const keys = [];
    for (let i = history.length - 1; i >= 0 && keys.length < 6; i--) if (!keys.includes(history[i].k)) keys.push(history[i].k);
    clear(recent).append(...keys.map((k, i) => {
      const e = store[k];
      if (!e) return null;
      return h('div', { class: 'scan-item' + (i === 0 ? ' last' : '') },
        e.image ? h('img', { src: e.image.replace('/normal/', '/small/'), alt: '' }) : null,
        h('span', {}, entryName(e), e.n > 1 ? h('b', {}, ' ×' + e.n) : null),
        i === 0 ? h('button', { class: 'act small', onClick: () => { addCard(cardOfEntry(e) || e, true); } }, '+1') : null);
    }));
  };
  const addCard = (card, manual = false) => {
    const k = addTo(store, card);
    if (deck) syncCollection(deck, k);
    save();
    history.push({ k });
    sfx('play');
    buzz(30);
    frame.classList.remove('flash');
    void frame.offsetWidth;
    frame.classList.add('flash');
    paintCount();
    paintRecent();
    if (!manual) status.textContent = `Añadida: ${displayName(card)}. Quítala y pon la siguiente.`;
  };
  const undo = () => {
    const last = history.pop();
    if (!last || !store[last.k]) return;
    store[last.k].n -= 1;
    if (store[last.k].n <= 0) delete store[last.k];
    save();
    paintCount();
    paintRecent();
    toast('Deshecho.');
  };
  let watcher = null;
  const exit = () => {
    if (watcher) watcher.stop();
    stopCamera();
    if (deck) deckScreen(deck.id); else libraryHome('coll');
  };
  const screen = h('div', { class: 'scan-screen' },
    video, h('div', { class: 'cam-shade' }), frame, outline,
    h('div', { class: 'scan-top' },
      h('button', { class: 'rune-btn', onClick: exit }, icon('back')),
      h('div', {}, h('b', {}, label), counter)),
    h('div', { class: 'scan-side' },
      status,
      h('p', { class: 'muted' }, 'Pon las cartas en el recuadro una a una. Para otra copia de la misma carta, quítala y vuelve a ponerla.'),
      recent,
      h('div', { class: 'row-btns' },
        h('button', { class: 'act', onClick: undo }, icon('undo'), 'Deshacer'),
        h('button', { class: 'act', onClick: () => openPicker((card) => addCard(card, true), { title: 'Añadir a mano', confirmLabel: 'Añadir', showLands: true }) }, icon('grimoire'), 'Buscar'),
        h('button', { class: 'act primary', onClick: exit }, 'Listo'))));
  clear(root).append(screen);
  paintCount();

  const region = () => {
    const v = video.getBoundingClientRect();
    const r = frame.getBoundingClientRect();
    return { x: (r.left - v.left) / v.width, y: (r.top - v.top) / v.height, w: r.width / v.width, h: r.height / v.height };
  };
  if (!cameraSupported()) { status.textContent = 'Este navegador no permite usar la cámara: añade las cartas con «Buscar».'; return; }
  preloadVision();
  startCamera(video).then(() => {
    watcher = new CardWatcher(video, {
      getRegion: region,
      onCard: (card) => addCard(card),
      onState: ({ phase, text }) => { if (phase !== 'found') status.textContent = text; screen.dataset.phase = phase; },
      onOutline: (o) => {
        if (!o) { outline.classList.remove('show'); return; }
        const v = video.getBoundingClientRect();
        const sr = screen.getBoundingClientRect();
        poly.setAttribute('points', o.pts.map((p) => `${v.left - sr.left + p.x * v.width},${v.top - sr.top + p.y * v.height}`).join(' '));
        outline.dataset.state = o.state;
        outline.classList.add('show');
      },
    });
    watcher.start();
  }).catch((e) => { status.textContent = cameraErrorText(e) + ' Puedes añadir las cartas con «Buscar».'; });
}

