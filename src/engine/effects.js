// Habilidades automáticas: se leen del texto oficial (oracle) de la carta.
// Cubre las plantillas más comunes: daño, destruir, +X/+X, robar, vidas,
// fichas, devolver a la mano, contadores y recuperar del cementerio.
// Lo que no reconoce se aplica a mano (como en la mesa real).

const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
const num = (s) => (s == null ? 1 : /^\d+$/.test(s) ? parseInt(s, 10) : NUM[s.toLowerCase()] ?? 1);
const COLOR_WORD = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: 'C' };

/** Divide el texto en efectos de "al entrar" y efectos de hechizo. */
export function parseEffects(card) {
  const text = (card.oracle || '').replace(/\([^)]*\)/g, ''); // quita textos recordatorio
  const out = { etb: [], spell: [] };
  if (!text) return out;
  const self = new RegExp(escapeRe(card.name), 'g');
  const clean = text.replace(self, 'CARDNAME');
  if (card.isInstant || card.isSorcery) {
    out.spell = parseSentence(clean);
  } else {
    const m = clean.match(/When (?:CARDNAME|this creature) enters(?: the battlefield)?,\s*([^\n]+)/i);
    if (m) out.etb = parseSentence(m[1]);
  }
  return out;
}

function parseSentence(t) {
  const fx = [];
  let m;
  if ((m = t.match(/deals (\d+) damage to any target/i))) fx.push({ kind: 'damage', amount: +m[1], target: 'any' });
  else if ((m = t.match(/deals (\d+) damage to target (?:creature|attacking or blocking creature)/i))) fx.push({ kind: 'damage', amount: +m[1], target: 'creature' });
  else if ((m = t.match(/deals (\d+) damage to (?:target player|target opponent|each opponent)/i))) fx.push({ kind: 'damage', amount: +m[1], target: /each opponent/i.test(t) ? 'opponents' : 'player' });
  if (/Destroy target (?:attacking or blocking |nonblack |tapped )?creature/i.test(t)) fx.push({ kind: 'destroy', target: 'creature' });
  if ((m = t.match(/Target creature gets ([+-]\d+)\/([+-]\d+) until end of turn/i))) fx.push({ kind: 'pump', p: +m[1], t: +m[2], target: 'creature' });
  if (/Return target (?:nonland permanent|creature) to its owner's hand/i.test(t)) fx.push({ kind: 'bounce', target: 'creature' });
  if (/[Pp]ut a \+1\/\+1 counter on target creature/.test(t)) fx.push({ kind: 'counter', target: 'creature' });
  if ((m = t.match(/(?:target opponent|each opponent) loses (\d+) life/i))) fx.push({ kind: 'drain', amount: +m[1] });
  if ((m = t.match(/[Yy]ou gain (\d+) life/))) fx.push({ kind: 'gain', amount: +m[1] });
  if ((m = t.match(/[Yy]ou lose (\d+) life/))) fx.push({ kind: 'lose', amount: +m[1] });
  if ((m = t.match(/[Dd]raws? (a|one|two|three|\d+) cards?/))) fx.push({ kind: 'draw', amount: num(m[1]) });
  if (!/you lose/i.test(t) && (m = t.match(/[Tt]arget player draws \w+ cards? and loses (\d+) life/))) fx.push({ kind: 'lose', amount: +m[1] });
  if ((m = t.match(/[Cc]reate (a|an|one|two|three|four|\d+) (\d+)\/(\d+) ((?:white|blue|black|red|green|colorless)(?: and (?:white|blue|black|red|green))?) ([A-Z][\w ]*?) (?:artifact )?creature tokens?(?: with ([a-z, ]+))?/))) {
    fx.push({
      kind: 'token', amount: num(m[1]), power: +m[2], toughness: +m[3],
      colors: m[4].split(' and ').map((w) => COLOR_WORD[w]).filter(Boolean), subtype: m[5].trim(),
      keywords: (m[6] || '').split(/,| and /).map((s) => s.trim()).filter(Boolean),
    });
  }
  if (/[Rr]eturn (?:up to one )?target creature card from your graveyard to your hand/.test(t)) fx.push({ kind: 'regrow' });
  return fx;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export const needsTarget = (e) => ['any', 'creature', 'player'].includes(e.target);

/** Lista de objetivos que pide una carta al jugarse (en orden). */
export function targetsFor(card) {
  const fx = card.isPermanent ? card.effects?.etb : card.effects?.spell;
  return (fx || []).filter(needsTarget);
}

const TOKEN_ES = { Soldier: 'Soldado', Goblin: 'Trasgo', Zombie: 'Zombi', Spirit: 'Espíritu', Elf: 'Elfo', Warrior: 'Guerrero', Beast: 'Bestia', Bird: 'Ave', Knight: 'Caballero', Saproling: 'Saprolín', Human: 'Humano', Cat: 'Gato', Wolf: 'Lobo', Insect: 'Insecto', Rat: 'Rata', Vampire: 'Vampiro', Angel: 'Ángel', Dragon: 'Dragón' };

export function tokenCard(e) {
  return {
    id: 'token:' + e.subtype + e.power + e.toughness,
    name: `${e.subtype} Token`,
    printedName: `Ficha de ${TOKEN_ES[e.subtype] || e.subtype}`,
    image: null,
    manaCost: '', cmc: 0,
    typeLine: `Token Creature — ${e.subtype}`,
    oracle: e.keywords.join(', '),
    printedText: null,
    power: e.power, toughness: e.toughness,
    colors: e.colors, keywords: e.keywords.map((k) => k.toLowerCase()),
    isLand: false, isCreature: true, isInstant: false, isSorcery: false, isLegendary: false, isPermanent: true, isToken: true,
    produces: [], effects: { etb: [], spell: [] },
  };
}

/** Texto en español de un efecto (para explicarlo al jugador). */
export function describeEffect(e) {
  switch (e.kind) {
    case 'damage': return `hace ${e.amount} de daño` + (e.target === 'creature' ? ' a una criatura' : e.target === 'opponents' ? ' a cada rival' : e.target === 'player' ? ' a un jugador' : ' a cualquier objetivo');
    case 'destroy': return 'destruye una criatura';
    case 'pump': return `da ${e.p >= 0 ? '+' : ''}${e.p}/${e.t >= 0 ? '+' : ''}${e.t} a una criatura hasta el final del turno`;
    case 'bounce': return 'devuelve una criatura a la mano de su propietario';
    case 'counter': return 'pone un contador +1/+1 en una criatura';
    case 'drain': return `cada rival pierde ${e.amount} vidas`;
    case 'gain': return `ganas ${e.amount} vidas`;
    case 'lose': return `pierdes ${e.amount} vidas`;
    case 'draw': return `robas ${e.amount} carta${e.amount > 1 ? 's' : ''}`;
    case 'token': return `crea ${e.amount} ficha${e.amount > 1 ? 's' : ''} de ${e.power}/${e.toughness}`;
    case 'regrow': return 'recupera una criatura de tu cementerio';
    default: return '';
  }
}
