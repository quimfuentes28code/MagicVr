// Acceso a la API pública de Scryfall (https://scryfall.com/docs/api).
// Con caché en memoria + localStorage y respaldo a la base de datos local.

import { fromScryfall, localCard, searchLocal } from './engine/cards.js';
import { cardDbReady, cardByName, searchNames, candidates, recordToCard, norm } from './carddb.js';

const API = 'https://api.scryfall.com';
const mem = new Map();
const LS_KEY = 'mtgvr-cards-v1';

function loadCache() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) for (const [k, v] of Object.entries(JSON.parse(raw))) mem.set(k, v);
  } catch { /* sin almacenamiento */ }
}
function saveCache() {
  try {
    const obj = Object.fromEntries([...mem.entries()].slice(-300));
    localStorage.setItem(LS_KEY, JSON.stringify(obj));
  } catch { /* lleno o bloqueado */ }
}
loadCache();

let last = 0;
async function get(path) {
  // Scryfall pide <10 peticiones/segundo.
  const wait = Math.max(0, last + 110 - Date.now());
  last = Date.now() + wait;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  const res = await fetch(API + path, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const err = new Error('scryfall ' + res.status);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Sugerencias de nombres mientras escribes (inglés y español). */
export async function autocomplete(q) {
  if (cardDbReady()) return searchNames(q, 12);
  const local = searchLocal(q).map((c) => c.printedName || c.name);
  if (q.trim().length < 2) return local.slice(0, 8);
  try {
    const r = await get(`/cards/autocomplete?q=${encodeURIComponent(q)}&include_multilingual=true`);
    return [...new Set([...r.data, ...local])].slice(0, 12);
  } catch {
    return local.slice(0, 8);
  }
}

/** Busca una carta por nombre (tolera erratas y nombres en español). */
export async function findCard(name, { spanish = true } = {}) {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  // 1º la base de datos completa que va dentro de la app (sin internet).
  if (cardDbReady()) {
    const exact = cardByName(name);
    if (exact) return exact;
    const near = candidates(name, 5).find(([k]) => similar(k, norm(name)));
    if (near) return recordToCard(near[1]);
  }
  if (mem.has(key)) return mem.get(key);
  let card = null;
  try {
    let sc;
    try {
      sc = await get(`/cards/named?fuzzy=${encodeURIComponent(name)}`);
    } catch (e) {
      if (e.status !== 404) throw e;
      const r = await get(`/cards/search?q=${encodeURIComponent(name)}&include_multilingual=true`);
      sc = r.data && r.data[0];
    }
    if (sc) {
      card = fromScryfall(sc);
      if (spanish && sc.lang !== 'es') {
        try {
          const r = await get(`/cards/search?q=${encodeURIComponent(`!"${sc.name}" lang:es`)}&unique=prints`);
          const es = r.data && r.data[0];
          if (es) {
            const esCard = fromScryfall(es);
            card.printedName = esCard.printedName || card.printedName;
            card.printedText = esCard.printedText;
            card.image = esCard.image || card.image;
          }
        } catch { /* no hay impresión en español */ }
      }
    }
  } catch {
    card = null;
  }
  if (!card) card = localCard(name);
  if (card) {
    mem.set(key, card);
    saveCache();
  }
  return card;
}

/** Cartas ya encontradas antes (para reconocerlas al instante con la cámara). */
export function knownCards() {
  return [...new Set(mem.values())].filter(Boolean);
}

function similar(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 3) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] <= Math.max(1, Math.floor(b.length / 6));
}
