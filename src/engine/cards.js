// Datos de cartas: normalización de Scryfall + una pequeña base de datos local
// (funciona sin conexión para el tutorial y los mazos de los bots).

const IMG = (name) =>
  `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=normal`;

export const COLOR_NAMES = { W: 'Blanco', U: 'Azul', B: 'Negro', R: 'Rojo', G: 'Verde', C: 'Incoloro' };

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

const L = (name, es, sub, color) =>
  normalize({ name, printedName: es, typeLine: `Basic Land — ${sub}`, oracle: `({T}: Add {${color}}.)` });
const C = (name, cost, p, t, sub, extra = {}) =>
  normalize({ name, manaCost: cost, power: p, toughness: t, typeLine: `Creature — ${sub}`, ...extra });

export const BASICS = {
  W: L('Plains', 'Llanura', 'Plains', 'W'),
  U: L('Island', 'Isla', 'Island', 'U'),
  B: L('Swamp', 'Pantano', 'Swamp', 'B'),
  R: L('Mountain', 'Montaña', 'Mountain', 'R'),
  G: L('Forest', 'Bosque', 'Forest', 'G'),
};

// Criaturas sencillas (sin habilidades complejas) para los mazos de práctica.
export const LOCAL_CARDS = [
  ...Object.values(BASICS),
  C('Llanowar Elves', '{G}', 1, 1, 'Elf Druid', { printedName: 'Elfos de Llanowar', oracle: '{T}: Add {G}.' }),
  C('Grizzly Bears', '{1}{G}', 2, 2, 'Bear', { printedName: 'Osos pardos' }),
  C('Centaur Courser', '{2}{G}', 3, 3, 'Centaur Warrior'),
  C('Giant Spider', '{3}{G}', 2, 4, 'Spider', { keywords: ['Reach'], oracle: 'Reach' }),
  C('Rumbling Baloth', '{2}{G}{G}', 4, 4, 'Beast'),
  C('Craw Wurm', '{4}{G}{G}', 6, 4, 'Wurm'),
  C('Colossal Dreadmaw', '{4}{G}{G}', 6, 6, 'Dinosaur', { keywords: ['Trample'], oracle: 'Trample' }),
  C('Raging Goblin', '{R}', 1, 1, 'Goblin Berserker', { keywords: ['Haste'], oracle: 'Haste' }),
  C('Goblin Piker', '{1}{R}', 2, 1, 'Goblin Warrior', { oracle: 'Goblin Piker can’t block.' }),
  C('Gray Ogre', '{2}{R}', 2, 2, 'Ogre'),
  C('Hill Giant', '{3}{R}', 3, 3, 'Giant'),
  C('Fire Elemental', '{3}{R}{R}', 5, 4, 'Elemental'),
  C('Shivan Dragon', '{4}{R}{R}', 5, 5, 'Dragon', { keywords: ['Flying'], oracle: 'Flying' }),
  C('Savannah Lions', '{W}', 2, 1, 'Cat'),
  C('Suntail Hawk', '{W}', 1, 1, 'Bird', { keywords: ['Flying'], oracle: 'Flying' }),
  C('Glory Seeker', '{1}{W}', 2, 2, 'Human Soldier'),
  C('Siege Mastodon', '{4}{W}', 3, 5, 'Elephant'),
  C('Serra Angel', '{3}{W}{W}', 4, 4, 'Angel', { keywords: ['Flying', 'Vigilance'], oracle: 'Flying, vigilance' }),
  C('Typhoid Rats', '{B}', 1, 1, 'Rat', { keywords: ['Deathtouch'], oracle: 'Deathtouch' }),
  C('Walking Corpse', '{1}{B}', 2, 2, 'Zombie'),
  C('Feral Shadow', '{2}{B}', 2, 1, 'Nightstalker', { keywords: ['Flying'], oracle: 'Flying' }),
  C('Vampire Nighthawk', '{1}{B}{B}', 2, 3, 'Vampire Shaman', {
    keywords: ['Flying', 'Deathtouch', 'Lifelink'],
    oracle: 'Flying, deathtouch, lifelink',
  }),
  C('Sengir Vampire', '{3}{B}{B}', 4, 4, 'Vampire', { keywords: ['Flying'], oracle: 'Flying' }),
  // Comandantes de los bots
  normalize({ name: 'Isamaru, Hound of Konda', manaCost: '{W}', power: 2, toughness: 2, typeLine: 'Legendary Creature — Dog' }),
  normalize({ name: 'Yargle, Glutton of Urborg', manaCost: '{4}{B}', power: 9, toughness: 3, typeLine: 'Legendary Creature — Frog Spirit' }),
  normalize({
    name: 'Kamahl, Pit Fighter', manaCost: '{4}{R}{R}', power: 6, toughness: 1,
    typeLine: 'Legendary Creature — Human Barbarian', keywords: ['Haste'], oracle: 'Haste',
  }),
  normalize({
    name: 'Kodama of the North Tree', manaCost: '{2}{G}{G}{G}', power: 6, toughness: 4,
    typeLine: 'Legendary Creature — Spirit', keywords: ['Trample'], oracle: 'Trample',
  }),
  // Hechizos de ejemplo para el tutorial
  normalize({
    name: 'Giant Growth', printedName: 'Crecimiento gigante', manaCost: '{G}', typeLine: 'Instant',
    oracle: 'Target creature gets +3/+3 until end of turn.',
  }),
  normalize({
    name: 'Lightning Bolt', manaCost: '{R}', typeLine: 'Instant',
    oracle: 'Lightning Bolt deals 3 damage to any target.',
  }),
];

export function localCard(name) {
  const q = name.trim().toLowerCase();
  return LOCAL_CARDS.find((c) => c.name.toLowerCase() === q || (c.printedName || '').toLowerCase() === q) || null;
}

export function searchLocal(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  return LOCAL_CARDS.filter(
    (c) => c.name.toLowerCase().includes(q) || (c.printedName || '').toLowerCase().includes(q),
  );
}

export const BOT_DECKS = {
  G: {
    label: 'Bosque salvaje (verde)',
    commander: 'Kodama of the North Tree',
    creatures: ['Llanowar Elves', 'Grizzly Bears', 'Centaur Courser', 'Giant Spider', 'Rumbling Baloth', 'Craw Wurm', 'Colossal Dreadmaw'],
  },
  R: {
    label: 'Horda goblin (rojo)',
    commander: 'Kamahl, Pit Fighter',
    creatures: ['Raging Goblin', 'Goblin Piker', 'Gray Ogre', 'Hill Giant', 'Fire Elemental', 'Shivan Dragon'],
  },
  W: {
    label: 'Alas del alba (blanco)',
    commander: 'Isamaru, Hound of Konda',
    creatures: ['Savannah Lions', 'Suntail Hawk', 'Glory Seeker', 'Siege Mastodon', 'Serra Angel'],
  },
  B: {
    label: 'Cripta nocturna (negro)',
    commander: 'Yargle, Glutton of Urborg',
    creatures: ['Typhoid Rats', 'Walking Corpse', 'Feral Shadow', 'Vampire Nighthawk', 'Sengir Vampire'],
  },
};

/** Lista de cartas (sin barajar) de un mazo de bot. */
export function buildBotDeck(color, size) {
  const d = BOT_DECKS[color];
  const lands = Math.round(size * 0.42);
  const list = [];
  for (let i = 0; i < lands; i++) list.push(BASICS[color]);
  let i = 0;
  while (list.length < size) list.push(localCard(d.creatures[i++ % d.creatures.length]));
  return list;
}
