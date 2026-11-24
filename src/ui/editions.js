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

/** Ilustraciones distintas de una carta (hasta 3 páginas: las tierras básicas tienen cientos). */
async function artworks(card, maxPages = 3) {
  const q = encodeURIComponent(`!"${card.name}"`);
  let url = `/cards/search?q=${q}&unique=art&order=released&dir=desc`;
  const out = [];
  for (let page = 0; page < maxPages && url; page++) {
    const r = await get(url);
    out.push(...r.data.filter((c) => imgOf(c, 'small')));
    url = r.has_more && r.next_page ? r.next_page.replace(API, '') : null;
  }
  return out;
}

async function spanishSameArt(card, art) {
  try {
    const artist = art.artist ? ` artist:"${art.artist}"` : '';
    const r = await get(`/cards/search?q=${encodeURIComponent(`!"${card.name}" lang:es${artist}`)}&unique=prints&include_multilingual=true&order=released&dir=desc`);
    return r.data.find((c) => c.illustration_id === art.illustration_id && imgOf(c) && !/missing|placeholder/.test(c.image_status || '')) || null;
  } catch {
    return null;
  }
}

// ----------------------------------------------------- comparación de imágenes

// Huella de una imagen de carta: la ilustración en gris reducida a 16x12 y
// convertida en "orden de brillo" (qué zonas son más claras que otras). Así da
// igual que la luz de la mesa sea amarilla, tenue o esté quemada: lo que se
// compara es la forma de la ilustración, no sus colores.
const W = 16;
const H = 12;
const ART = { x: 0.1, y: 0.12, w: 0.8, h: 0.42 };

function fingerprint(source, sw, sh, region = ART) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, region.x * sw, region.y * sh, region.w * sw, region.h * sh, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const n = W * H;
  const gray = Array.from({ length: n }, (_, i) => 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
  const order = gray.map((g, i) => [g, i]).sort((a, b) => a[0] - b[0]);
  const v = new Float32Array(n);
  order.forEach(([, i], rank) => { v[i] = rank; });
  let mean = (n - 1) / 2;
  let sd = 0;
  for (let i = 0; i < n; i++) { v[i] -= mean; sd += v[i] * v[i]; }
  sd = Math.sqrt(sd / n) || 1;
  for (let i = 0; i < n; i++) v[i] /= sd;
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
  // La carta no siempre llena el círculo exactamente: probamos varios encuadres de la foto.
  const targets = [];
  for (const dx of [-0.04, 0, 0.04]) for (const dy of [-0.04, 0, 0.04]) for (const sc of [0.92, 1]) {
    targets.push(fingerprint(photo, photo.width, photo.height, { x: ART.x + dx + (ART.w * (1 - sc)) / 2, y: ART.y + dy + (ART.h * (1 - sc)) / 2, w: ART.w * sc, h: ART.h * sc }));
  }
  const scored = [];
  for (let i = 0; i < arts.length; i += 12) {
    const batch = arts.slice(i, i + 12);
    const imgs = await Promise.all(batch.map((c) => loadImage(imgOf(c, 'small')).catch(() => null)));
    imgs.forEach((img, k) => {
      if (!img) return;
      const fp = fingerprint(img, img.naturalWidth, img.naturalHeight);
      scored.push({ c: batch[k], d: Math.min(...targets.map((t) => distance(t, fp))) });
    });
  }
  scored.sort((a, b) => a.d - b.d);
  const [best, second] = scored;
  if (window.__editionDebug) window.__editionDebug(scored.slice(0, 5).map((x) => [x.c.set_name, x.d.toFixed(3)]));
  // Aceptamos si es bastante parecida y se distingue claramente de la siguiente.
  if (!best || best.d > 0.5 || (second && second.d - best.d < 0.12)) return { unsure: true };
  // La misma ilustración se reimprime en muchas ediciones: buscamos la impresión
  // en español más reciente con ESA ilustración (p. ej. Fundamentos).
  const es = await spanishSameArt(card, best.c);
  const pick = es || best.c;
  return { image: imgOf(pick), set: pick.set, setName: pick.set_name };
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
      const prints = r.data.filter((c) => imgOf(c, 'small') && !/missing|placeholder/.test(c.image_status || ''));
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
