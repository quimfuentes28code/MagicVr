// Base de datos completa de cartas de Magic (public/carddb.json, ~37.000 cartas)
// con índice de búsqueda por nombre en inglés y en español, tolerante a errores
// de lectura (para el reconocimiento con cámara).

import { normalize } from './engine/cards.js';

export const imageUrl = (id, size = 'normal') =>
  id ? `https://cards.scryfall.io/${size}/front/${id[0]}/${id[1]}/${id}.jpg` : null;

export const norm = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

let db = null;
let loading = null;
const cache = new Map(); // oracle id -> carta normalizada

/** Carga la base de datos (una sola vez). onProgress(0..1). */
export function loadCardDb(onProgress) {
  if (db) return Promise.resolve(db);
  loading ||= (async () => {
    const url = new URL('./carddb.json', document.baseURI).href;
    const res = await fetch(url);
    if (!res.ok) throw new Error('No se encontró la base de datos de cartas.');
    const total = +res.headers.get('content-length') || 0;
    let text;
    if (total && res.body && onProgress) {
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        onProgress(Math.min(0.95, got / total));
      }
      text = new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
    } else text = await res.text();
    db = buildIndex(JSON.parse(text));
    onProgress && onProgress(1);
    return db;
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

export const cardDbReady = () => !!db;
export const cardDbCount = () => (db ? db.records.length : 0);

function buildIndex(data) {
  const records = data.cards;
  const keys = []; // [clave normalizada, índice de registro]
  const byKey = new Map();
  const add = (label, i) => {
    const k = norm(label);
    if (k.length < 2 || byKey.has(k)) return;
    byKey.set(k, i);
    keys.push([k, i]);
  };
  // Prioridad: nombre inglés > nombre español > caras de cartas dobles.
  records.forEach((r, i) => add(r.n, i));
  records.forEach((r, i) => r.en && add(r.en, i));
  records.forEach((r, i) => r.f && r.f.forEach((f) => add(f.n, i)));
  // Índice de trigramas (sin espacios) para búsquedas aproximadas.
  const tri = new Map();
  keys.forEach(([k], ki) => {
    const s = k.replace(/ /g, '');
    for (const t of new Set(trigrams(s))) {
      let list = tri.get(t);
      if (!list) tri.set(t, (list = []));
      list.push(ki);
    }
  });
  return { records, keys, byKey, tri, generated: data.generated };
}

function trigrams(s) {
  const out = [];
  const p = `  ${s} `;
  for (let i = 0; i + 3 <= p.length; i++) out.push(p.slice(i, i + 3));
  return out;
}

/** Convierte un registro compacto en una carta de la app (con caché). */
export function recordToCard(r) {
  if (!r) return null;
  let c = cache.get(r.o);
  if (c) return c;
  const front = r.f ? r.f[0] : null;
  c = normalize({
    id: r.o,
    name: r.n,
    printedName: r.en || null,
    image: imageUrl(r.ei || r.i || front?.i),
    imageEn: imageUrl(r.i || front?.i),
    manaCost: r.m || front?.m || '',
    cmc: r.v,
    typeLine: r.t,
    printedType: r.et || null,
    oracle: r.x || (r.f ? r.f.map((f) => f.x).join('\n//\n') : ''),
    printedText: r.ex || null,
    power: r.p ?? front?.p,
    toughness: r.d ?? front?.d,
    colors: (r.c || '').split('').filter(Boolean),
    keywords: r.k || [],
  });
  c.loyalty = r.l ?? front?.l ?? null;
  c.colorIdentity = (r.ci || '').split('').filter(Boolean);
  c.commanderLegal = !!r.cmd;
  c.set = r.s;
  c.rarity = r.r;
  if (r.f) c.faces = r.f.map((f) => ({ name: f.name || f.n, manaCost: f.m, typeLine: f.t, oracle: f.x, power: f.p, toughness: f.d, image: imageUrl(f.i) }));
  cache.set(r.o, c);
  return c;
}

/** Carta por su oracle id (identificador de Scryfall común a todas sus impresiones). */
export function cardByOracle(oracle) {
  if (!db) return null;
  if (!db.byOracle) {
    db.byOracle = new Map();
    db.records.forEach((r, i) => db.byOracle.set(r.o, i));
  }
  const i = db.byOracle.get(oracle);
  return i == null ? null : recordToCard(db.records[i]);
}

/** Carta por nombre exacto (inglés o español, sin importar tildes/mayúsculas). */
export function cardByName(name) {
  if (!db) return null;
  const i = db.byKey.get(norm(name));
  return i == null ? null : recordToCard(db.records[i]);
}

/** Nombres que empiezan por (o contienen) el texto, para el buscador. */
export function searchNames(q, limit = 12) {
  if (!db) return [];
  const k = norm(q);
  if (!k) return [];
  const starts = [];
  const contains = [];
  // El nombre exacto siempre primero (escribir «Choque» no debe dar «Choque de realidades»).
  if (db.byKey.has(k)) starts.push(db.byKey.get(k));
  for (const [key, i] of db.keys) {
    if (key.startsWith(k)) starts.push(i);
    else if (contains.length < limit && key.includes(k)) contains.push(i);
    if (starts.length >= limit) break;
  }
  const seen = new Set();
  const out = [];
  for (const i of [...starts, ...contains]) {
    if (seen.has(i)) continue;
    seen.add(i);
    const r = db.records[i];
    out.push(r.en && norm(r.en).startsWith(k) ? r.en : r.en && norm(r.en).includes(k) && !norm(r.n).includes(k) ? r.en : r.n);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Candidatos aproximados para un texto leído por la cámara: las claves que
 * comparten más trigramas. Devuelve [[clave, carta]].
 */
export function candidates(text, n = 30) {
  if (!db) return [];
  const s = norm(text).replace(/ /g, '');
  if (s.length < 3) return [];
  const counts = new Map();
  for (const t of new Set(trigrams(s))) {
    const list = db.tri.get(t);
    if (!list || list.length > 4000) continue; // trigramas demasiado comunes
    for (const ki of list) counts.set(ki, (counts.get(ki) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([ki]) => {
      const [key, i] = db.keys[ki];
      return [key, db.records[i]];
    });
}

/** Sólo para pruebas en Node: carga desde un objeto ya leído. */
export function _loadForTests(data) {
  db = buildIndex(data);
  return db;
}
