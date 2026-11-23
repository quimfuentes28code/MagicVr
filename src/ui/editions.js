// La edición exacta de cada carta: el jugador quiere ver SU Pantano, no uno
// cualquiera. (1) Comparación automática de la foto con las ilustraciones de
// esa carta; (2) galería para elegirla a mano. La elección se recuerda.

import { h, clear, sheet, toast } from './dom.js';
import { displayName } from '../engine/game.js';

const API = 'https://api.scryfall.com';
const KEY = 'mtgvr-editions';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
function save(map) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* */ }
}

/** Edición elegida antes para esta carta (o null). */
export function preferredEdition(card) {
  return load()[card.name] || null;
}

export function rememberEdition(card, ed) {
  const map = load();
  map[card.name] = ed;
  save(map);
}

/** Aplica la edición recordada a una carta (devuelve una copia). */
export function withPreferredEdition(card) {
  const ed = preferredEdition(card);
  return ed ? { ...card, image: ed.image, edition: ed.set } : card;
}

const imgOf = (c, size = 'normal') => (c.image_uris || c.card_faces?.[0]?.image_uris || {})[size] || null;

async function get(path) {
  const res = await fetch(API + path, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('scryfall ' + res.status);
  return res.json();
}

/** Ilustraciones distintas de una carta (y sus impresiones en español). */
async function artworks(card, max = 175) {
  const q = encodeURIComponent(`!"${card.name}"`);
  const r = await get(`/cards/search?q=${q}&unique=art&order=released&dir=desc`);
  return r.data.slice(0, max).filter((c) => imgOf(c, 'small'));
}

async function spanishOf(card, set) {
  try {
    const r = await get(`/cards/search?q=${encodeURIComponent(`!"${card.name}" set:${set} lang:es`)}&unique=prints`);
    const es = r.data.find((c) => /scan/.test(c.image_status || '')) || null;
    return es ? imgOf(es) : null;
  } catch {
    return null;
  }
}

// ----------------------------------------------------- comparación de imágenes

// Huella de una imagen de carta: la ilustración reducida a 12x9 en color.
const W = 12;
const H = 9;
const ART = { x: 0.1, y: 0.12, w: 0.8, h: 0.42 };

function fingerprint(source, sw, sh, region = ART) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, region.x * sw, region.y * sh, region.w * sw, region.h * sh, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const v = new Float32Array(W * H * 3);
  let mean = 0;
  for (let i = 0; i < W * H; i++) {
    v[i * 3] = d[i * 4];
    v[i * 3 + 1] = d[i * 4 + 1];
    v[i * 3 + 2] = d[i * 4 + 2];
    mean += d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2];
  }
  mean /= W * H * 3;
  // normalizamos el brillo (la luz de la mesa cambia mucho)
  let sd = 0;
  for (let i = 0; i < v.length; i++) { v[i] -= mean; sd += v[i] * v[i]; }
  sd = Math.sqrt(sd / v.length) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= sd;
  return v;
}

function distance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s / a.length);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * Busca la edición cuya ilustración más se parece a la foto de la carta.
 * photo: canvas con la carta tal y como la ve la cámara (el círculo).
 * Devuelve { image, set, setName } o null si no hay una coincidencia clara.
 */
export async function autoMatchEdition(photo, card) {
  if (!photo || preferredEdition(card)) return null;
  const arts = await artworks(card);
  if (arts.length <= 1) return null;
  const target = fingerprint(photo, photo.width, photo.height);
  const scored = [];
  for (let i = 0; i < arts.length; i += 8) {
    const batch = arts.slice(i, i + 8);
    const imgs = await Promise.all(batch.map((c) => loadImage(imgOf(c, 'small')).catch(() => null)));
    imgs.forEach((img, k) => {
      if (img) scored.push({ c: batch[k], d: distance(target, fingerprint(img, img.naturalWidth, img.naturalHeight)) });
    });
  }
  scored.sort((a, b) => a.d - b.d);
  const [best, second] = scored;
  // Sólo aceptamos una coincidencia clara (bastante parecida y mejor que la siguiente).
  if (!best || best.d > 0.75 || (second && second.d - best.d < 0.05)) return null;
  const es = await spanishOf(card, best.c.set);
  return { image: es || imgOf(best.c), set: best.c.set, setName: best.c.set_name };
}

// ------------------------------------------------------------ galería manual

/** Galería de ediciones para elegir a mano. onPick({ image, set, setName }). */
export function openEditionPicker(card, onPick) {
  const grid = h('div', { class: 'edition-grid' }, h('div', { class: 'loading' }, 'Buscando ediciones…'));
  const close = sheet(h('div', {},
    h('h3', {}, 'Elige tu edición de ' + displayName(card)),
    h('p', { class: 'muted' }, 'Toca la ilustración que coincide con tu carta física. Se recordará para las próximas veces.'),
    grid,
  ));
  (async () => {
    try {
      const q = encodeURIComponent(`!"${card.name}" (lang:es or lang:en)`);
      const r = await get(`/cards/search?q=${q}&unique=prints&include_multilingual=true&order=released&dir=desc`);
      const prints = r.data.filter((c) => imgOf(c, 'small') && /scan/.test(c.image_status || ''));
      clear(grid).append(...prints.slice(0, 120).map((c) => h('button', {
        class: 'edition', onClick: () => {
          const ed = { image: imgOf(c), set: c.set, setName: c.set_name };
          rememberEdition(card, ed);
          close();
          onPick(ed);
          toast(`Edición guardada: ${c.set_name}${c.lang === 'es' ? ' (español)' : ''}.`);
        },
      }, h('img', { src: imgOf(c, 'small'), loading: 'lazy', alt: c.set_name }), h('span', {}, `${c.set_name} · ${(c.released_at || '').slice(0, 4)}${c.lang === 'es' ? ' · ES' : ''}`))));
      if (!prints.length) clear(grid).append(h('p', {}, 'No se encontraron otras ediciones.'));
    } catch {
      clear(grid).append(h('p', {}, 'No se pudieron cargar las ediciones (¿sin conexión?).'));
    }
  })();
}
