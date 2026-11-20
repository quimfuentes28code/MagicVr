// Descarga de Scryfall las cartas oficiales de los 5 mazos de práctica
// (datos, texto y nombre en español e imágenes oficiales) y genera
// src/data/cards.json. Uso: node scripts/build-cards.mjs

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';

export const DECKS = {
  G: {
    label: 'Furia del Bosque', color: 'G', commander: 'Kodama of the North Tree',
    blurb: 'Criaturas enormes, arrollar, alcance y trucos de +X/+X.',
    list: [['Llanowar Elves', 4], ['Elvish Visionary', 4], ['Grizzly Bears', 4], ['Thornweald Archer', 3], ['Centaur Courser', 4],
      ['Giant Spider', 3], ['Rumbling Baloth', 3], ['Colossal Dreadmaw', 3], ['Giant Growth', 4], ['Titanic Growth', 4], ['Forest', 24]],
  },
  R: {
    label: 'Horda Ardiente', color: 'R', commander: 'Kamahl, Pit Fighter',
    blurb: 'Ataque rápido con prisa y hechizos que hacen daño directo.',
    list: [['Raging Goblin', 4], ['Goblin Piker', 4], ['Viashino Pyromancer', 4], ['Gray Ogre', 4], ['Hill Giant', 4], ['Fire Elemental', 3],
      ['Shivan Dragon', 2], ['Shock', 4], ['Lightning Bolt', 4], ['Volcanic Hammer', 3], ['Mountain', 24]],
  },
  W: {
    label: 'Alas del Alba', color: 'W', commander: 'Isamaru, Hound of Konda',
    blurb: 'Voladores, vínculo vital, fichas de soldado y ganar vidas.',
    list: [['Savannah Lions', 4], ['Suntail Hawk', 3], ['Healer\'s Hawk', 4], ['Glory Seeker', 4], ['Ajani\'s Sunstriker', 3], ['Inspiring Overseer', 3],
      ['Serra Angel', 3], ['Siege Mastodon', 2], ['Raise the Alarm', 4], ['Divine Verdict', 3], ['Angel\'s Mercy', 3], ['Plains', 24]],
  },
  B: {
    label: 'Cripta Nocturna', color: 'B', commander: 'Yargle, Glutton of Urborg',
    blurb: 'Toque mortal, eliminación de criaturas y drenar vidas.',
    list: [['Typhoid Rats', 4], ['Bog Imp', 4], ['Walking Corpse', 4], ['Vampire Nighthawk', 3], ['Gravedigger', 3], ['Sengir Vampire', 3],
      ['Vampire Sovereign', 3], ['Murder', 4], ['Disfigure', 4], ['Sign in Blood', 4], ['Swamp', 24]],
  },
  U: {
    label: 'Mareas Arcanas', color: 'U', commander: 'Talrand, Sky Summoner',
    blurb: 'Voladores, robar cartas y devolver criaturas a la mano.',
    list: [['Coral Merfolk', 4], ['Wind Drake', 4], ['Horned Turtle', 3], ['Cloudkin Seer', 4], ['Man-o\'-War', 4], ['Air Elemental', 3],
      ['Mahamoti Djinn', 2], ['Opt', 4], ['Unsummon', 4], ['Divination', 4], ['Island', 24]],
  },
};

const API = 'https://api.scryfall.com';
const HEADERS = { 'User-Agent': 'MagicVR/1.0', Accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path, tries = 5) {
  await sleep(700);
  const res = await fetch(API + path, { headers: HEADERS });
  if (res.status === 429 && tries > 0) {
    await sleep(6000);
    return get(path, tries - 1);
  }
  if (!res.ok) throw new Error(res.status + ' ' + path);
  return res.json();
}

const img = (c) => (c.image_uris || c.card_faces?.[0]?.image_uris || {}).normal || null;

async function fetchCard(name) {
  const en = await get(`/cards/named?exact=${encodeURIComponent(name)}`);
  let es = null;
  let noSpanish = false;
  try {
    const r = await get(`/cards/search?q=${encodeURIComponent(`!"${en.name}" lang:es`)}&unique=prints&order=released&dir=desc`);
    // Sólo impresiones de ESTA carta (no de cartas dobles con una cara del mismo nombre).
    const same = r.data.filter((c) => c.oracle_id === en.oracle_id);
    es = same.find((c) => img(c) && /scan/.test(c.image_status)) || same[0] || null;
    if (!same.length) noSpanish = true;
  } catch (e) {
    if (/^404/.test(e.message)) noSpanish = true; // de verdad no existe en español
  }
  return {
    name: en.name,
    printedName: es?.printed_name || null,
    // Si la impresión española no tiene escaneo real, usamos la imagen inglesa.
    image: (es && /scan/.test(es.image_status) && img(es)) || img(en),
    imageEn: img(en),
    manaCost: en.mana_cost || '',
    cmc: en.cmc,
    typeLine: en.type_line,
    oracle: en.oracle_text || '',
    printedText: es?.printed_text || null,
    power: en.power ?? null,
    toughness: en.toughness ?? null,
    colors: en.colors || [],
    keywords: en.keywords || [],
    set: (es || en).set_name,
    noSpanish,
  };
}

if (import.meta.url !== `file://${process.argv[1]}`) process.exit(0);

const names = new Set();
for (const d of Object.values(DECKS)) {
  d.list.forEach(([n]) => names.add(n));
  names.add(d.commander);
}
['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].forEach((n) => names.add(n));

const OUT = 'src/data/cards.json';
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')).cards : {};
const cards = {};
for (const n of names) {
  if (prev[n] && (prev[n].printedName || prev[n].noSpanish) && !process.argv.includes('--refresh')) { cards[n] = prev[n]; continue; }
  try {
    cards[n] = await fetchCard(n);
    console.log('✓', n, '→', cards[n].printedName || '(sin español)');
  } catch (e) {
    if (prev[n]) cards[n] = prev[n]; // sin red: conservamos lo que ya teníamos
    console.error('✗', n, e.message);
    process.exitCode = 1;
  }
}

mkdirSync('src/data', { recursive: true });
writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString().slice(0, 10), cards, decks: DECKS }, null, 1));
console.log(Object.keys(cards).length, 'cartas guardadas en src/data/cards.json');
