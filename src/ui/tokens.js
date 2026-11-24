// Imagen oficial de las fichas (tokens): se busca en Scryfall por tipo, color,
// fuerza/resistencia y habilidades, primero en español. Se recuerda.

const API = 'https://api.scryfall.com';
const KEY = 'mtgvr-token-images';
const COLOR_Q = { W: 'w', U: 'u', B: 'b', R: 'r', G: 'g' };
let memo = null;
const pending = new Map();

function load() {
  if (!memo) { try { memo = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { memo = {}; } }
  return memo;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(memo)); } catch { /* */ } }

const imgOf = (c) => (c.image_uris || c.card_faces?.[0]?.image_uris || {}).normal || null;

async function search(q, subtype) {
  const res = await fetch(`${API}/cards/search?q=${encodeURIComponent(q)}&unique=art&order=released&dir=desc&include_extras=true`, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const data = await res.json();
  const ok = (data.data || []).filter((c) => imgOf(c) && !/missing|placeholder/.test(c.image_status || ''));
  // preferimos el tipo exacto («— Soldier», no «— Human Soldier»)
  const exact = new RegExp(`— ${subtype}$`);
  const hit = ok.find((c) => exact.test(c.type_line || '')) || ok[0];
  return hit ? imgOf(hit) : null;
}

/** URL de la imagen de una ficha (o null si no se encuentra / sin conexión). */
export function tokenImage(card) {
  if (!card || !card.isToken || !card.subtype) return Promise.resolve(null);
  const key = card.id;
  const m = load();
  if (m[key]) return Promise.resolve(m[key]);
  if (pending.has(key)) return pending.get(key);
  const colors = card.colors && card.colors.length ? `c=${card.colors.map((c) => COLOR_Q[c]).join('')}` : 'c=c';
  const base = `t:token t:"${card.subtype}" pow=${card.power} tou=${card.toughness} ${colors}`;
  const kw = (card.keywords || []).map((k) => ` keyword:"${k}"`).join('');
  const p = (async () => {
    for (const q of [`${base}${kw} lang:es`, `${base}${kw}`, `${base} lang:es`, base]) {
      try {
        const url = await search(q, card.subtype);
        if (url) { m[key] = url; save(); return url; }
      } catch { /* sin conexión */ }
    }
    return null;
  })();
  pending.set(key, p);
  p.finally(() => pending.delete(key));
  return p;
}
