// Genera public/carddb.json: TODAS las cartas de Magic (una entrada por carta
// distinta, ~37.000) con todo lo necesario para jugar, en inglés y en español.
//
// Fuente: datos masivos de Scryfall (https://scryfall.com/docs/api/bulk-data).
//   - oracle_cards: una versión de cada carta (texto oficial, coste, tipo...)
//   - all_cards: todas las impresiones; de aquí sacamos nombre, tipo, texto e
//     imagen en español.
//
// Uso: node scripts/build-carddb.mjs [--force]
// (detrás de un proxy: NODE_USE_ENV_PROXY=1 node scripts/build-carddb.mjs)

import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { existsSync, writeFileSync, mkdirSync, statSync } from 'node:fs';

const OUT = 'public/carddb.json';
const HEADERS = { 'User-Agent': 'MagicVR/1.0', Accept: 'application/json' };

if (existsSync(OUT) && !process.argv.includes('--force')) {
  console.log(`${OUT} ya existe (${(statSync(OUT).size / 1e6).toFixed(1)} MB). Usa --force para regenerarlo.`);
  process.exit(0);
}

async function bulkUrl(type) {
  const res = await fetch('https://api.scryfall.com/bulk-data', { headers: HEADERS });
  const { data } = await res.json();
  const b = data.find((x) => x.type === type);
  return b.jsonl_download_uri;
}

async function* lines(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(res.status + ' ' + url);
  const stream = Readable.fromWeb(res.body).pipe(createGunzip());
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim().replace(/,$/, '');
    if (t.startsWith('{')) yield JSON.parse(t);
  }
}

// La imagen se guarda como el id de Scryfall: la URL se reconstruye en la app.
const imgId = (uri) => (uri ? uri.split('/').pop().split('.')[0] : null);
const imageOf = (c) => imgId((c.image_uris || c.card_faces?.[0]?.image_uris || {}).normal);
const SKIP_LAYOUTS = new Set(['token', 'double_faced_token', 'emblem', 'art_series', 'vanguard', 'scheme', 'planar']);

function faceData(f) {
  return {
    n: f.name, m: f.mana_cost || '', t: f.type_line || '', x: f.oracle_text || '',
    p: f.power ?? null, d: f.toughness ?? null, l: f.loyalty ?? null,
    i: imgId(f.image_uris?.normal),
  };
}

console.log('1/2 Descargando el texto oficial de todas las cartas…');
const cards = new Map(); // oracle_id -> registro
for await (const c of lines(await bulkUrl('oracle_cards'))) {
  if (SKIP_LAYOUTS.has(c.layout) || !c.oracle_id || c.set_type === 'memorabilia') continue;
  const front = c.card_faces?.[0] || c;
  const rec = {
    o: c.oracle_id,
    n: c.name,
    m: c.mana_cost ?? front.mana_cost ?? '',
    v: c.cmc,
    t: c.type_line ?? front.type_line ?? '',
    x: c.oracle_text ?? front.oracle_text ?? '',
    p: c.power ?? front.power ?? null,
    d: c.toughness ?? front.toughness ?? null,
    l: c.loyalty ?? front.loyalty ?? null,
    c: (c.colors || front.colors || []).join(''),
    ci: (c.color_identity || []).join(''),
    k: c.keywords || [],
    cmd: c.legalities?.commander === 'legal' ? 1 : 0,
    i: imageOf(c),
    s: c.set,
    r: c.rarity?.[0],
  };
  if (c.card_faces && c.card_faces.length > 1) rec.f = c.card_faces.map(faceData);
  if (c.layout && !['normal'].includes(c.layout)) rec.y = c.layout;
  cards.set(c.oracle_id, rec);
}
console.log(`   ${cards.size} cartas.`);

console.log('2/2 Buscando las versiones en español (archivo grande, tarda un poco)…');
let es = 0;
for await (const c of lines(await bulkUrl('all_cards'))) {
  if (c.lang !== 'es' || !c.oracle_id) continue;
  const rec = cards.get(c.oracle_id);
  if (!rec) continue;
  const front = c.card_faces?.[0] || c;
  const name = c.printed_name || front.printed_name;
  if (!name) continue;
  const scan = /scan/.test(c.image_status || '');
  // Preferimos la impresión española más reciente con escaneo real.
  const better = !rec.en || (scan && !rec.eScan) || (scan === !!rec.eScan && c.released_at > rec.eDate);
  if (!better) continue;
  if (!rec.en) es++;
  rec.en = name; // "en" = nombre en español (printed name)
  rec.et = c.printed_type_line || front.printed_type_line || null;
  rec.ex = c.printed_text || front.printed_text || null;
  rec.eScan = scan;
  rec.eDate = c.released_at;
  if (!/missing|placeholder/.test(c.image_status || '')) rec.ei = imageOf(c);
}
console.log(`   ${es} cartas con nombre en español.`);

const out = [];
for (const r of cards.values()) {
  delete r.eScan;
  delete r.eDate;
  if (!r.ei) delete r.ei;
  for (const k of ['p', 'd', 'l', 'et', 'ex', 'en']) if (r[k] == null) delete r[k];
  if (!r.k.length) delete r.k;
  if (!r.cmd) delete r.cmd;
  out.push(r);
}
out.sort((a, b) => a.n.localeCompare(b.n));
mkdirSync('public', { recursive: true });
writeFileSync(OUT, JSON.stringify({ v: 1, generated: new Date().toISOString().slice(0, 10), count: out.length, cards: out }));
console.log(`Guardado ${OUT}: ${out.length} cartas, ${(statSync(OUT).size / 1e6).toFixed(1)} MB.`);
