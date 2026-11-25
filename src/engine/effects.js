// Habilidades automáticas: se leen del texto oficial (oracle) de la carta.
// Cubre las plantillas más comunes: daño, destruir, +X/+X, robar, vidas,
// fichas, devolver a la mano, contadores y recuperar del cementerio.
// Lo que no reconoce se aplica a mano (como en la mesa real).

import { abilitiesOf } from './abilities.js';

const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
const num = (s) => (s == null ? 1 : /^\d+$/.test(s) ? parseInt(s, 10) : NUM[s.toLowerCase()] ?? 1);
const COLOR_WORD = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: 'C' };

/** Divide el texto en efectos de "al entrar" y efectos de hechizo. */
export function parseEffects(card) {
  const text = (card.oracle || '').replace(/\([^)]*\)/g, ''); // quita textos recordatorio
  const out = { etb: [], spell: [], dies: [] };
  if (!text) return out;
  const self = new RegExp(escapeRe(card.name), 'g');
  const clean = text.replace(self, 'CARDNAME');
  // «Este hechizo cuesta {N} menos si hace objetivo a…» (p. ej. una criatura girada)
  const red = clean.match(/This spell costs \{(\d+)\} less to cast if it targets (?:a |an )?([^.\n]+)/i);
  // sólo condiciones que sabemos comprobar (girada, tuya, de un rival…); el resto, a mano
  if (red && /^(?:tapped |untapped |attacking |blocking |attacking or blocking )?(?:creature|permanent|artifact|enchantment|planeswalker|land)(?: or (?:creature|planeswalker|artifact|enchantment))?(?: you control| an opponent controls| you don't control)?$/i.test(red[2].trim().replace(/[’]/g, "'"))) {
    out.reduce = { n: +red[1], filter: parseTargetPhrase(red[2]) };
  }
  // Equipos que traen su criatura: Job select (Héroe 1/1), Living weapon (Germen 0/0), For Mirrodin! (Rebelde 2/2)
  const ownToken = /\bJob select\b/i.test(text) ? { subtype: 'Hero', power: 1, toughness: 1, colors: [] }
    : /\bLiving weapon\b/i.test(text) ? { subtype: 'Phyrexian Germ', power: 0, toughness: 0, colors: ['B'] }
      : /\bFor Mirrodin!/i.test(text) ? { subtype: 'Rebel', power: 2, toughness: 2, colors: ['R'] } : null;
  if (ownToken) out.etb.push({ kind: 'tokenAttach', amount: 1, keywords: [], ...ownToken });
  // Lector nuevo (abilities.js): cláusulas enteras. Lo que no entiende, con el lector antiguo (parcial).
  const abil = abilitiesOf(card);
  if (card.isInstant || card.isSorcery) {
    const sp = abil.filter((x) => x.kind === 'spell');
    const fx = sp.flatMap((x) => x.fx);
    const miss = sp.filter((x) => !x.ok).flatMap((x) => x.missing || []).join('. ');
    const hasModes = abil.some((x) => x.kind === 'modal');
    out.spell = fx.length ? [...fx, ...(miss ? parseSentence(miss).filter((e) => !fx.some((f) => f.kind === e.kind)) : [])] : hasModes ? [] : parseSentence(clean);
  } else {
    const etb = abil.filter((x) => x.kind === 'trigger' && x.ev === 'etb' && !x.cond && x.fx.length);
    if (etb.length) out.etb = etb.flatMap((x) => x.fx);
    else {
      const m = clean.match(/When (?:CARDNAME|this (?:creature|Aura|enchantment|artifact|Equipment|Vehicle|permanent|land)) enters(?: the battlefield)?,\s*([^\n]+)/i);
      if (m) out.etb = parseSentence(m[1]);
    }
    const dies = abil.filter((x) => x.kind === 'trigger' && x.ev === 'dies' && !x.cond && x.fx.length);
    if (dies.length) out.dies = dies.flatMap((x) => x.fx);
    else {
      const d = clean.match(/When (?:CARDNAME|this creature) (?:dies|is put into a graveyard from the battlefield),\s*([^\n]+)/i);
      if (d) out.dies = parseSentence(d[1]);
    }
    if (ownToken && !out.etb.some((e) => e.kind === 'tokenAttach')) out.etb.unshift({ kind: 'tokenAttach', amount: 1, keywords: [], ...ownToken });
  }
  // Modos («Elige uno —»): de un hechizo, o de la habilidad «al entrar» de un permanente
  const modes = abil.filter((x) => x.kind === 'mode');
  const header = abil.find((x) => x.kind === 'modal') || abil.find((x) => x.kind === 'trigger' && x.modal && x.ev === 'etb');
  if (header && modes.length) {
    const t = header.modal || header.text;
    out.modes = modes.map((x) => ({ text: x.text.replace(/^•\s*/, ''), fx: x.fx, ok: x.ok }));
    out.choose = /\bthree\b/i.test(t) ? 3 : /\btwo\b/i.test(t) ? 2 : /one or both|one or more|any number/i.test(t) ? -modes.length : 1;
    out.modesFor = card.isInstant || card.isSorcery ? 'spell' : 'etb';
  }
  return out;
}

const TYPE_WORDS = ['creature', 'artifact', 'enchantment', 'planeswalker', 'land', 'permanent', 'battle'];

/**
 * Lee la descripción de un objetivo («nonland permanent», «artifact or enchantment»,
 * «creature an opponent controls», «tapped creature», «creature with mana value 3 or less»…).
 */
export function parseTargetPhrase(ph) {
  const orig = ph.trim();
  ph = ph.toLowerCase().replace(/[’]/g, "'").split(/,? (?:then|until|if|unless|and (?!\/or)(?:its|that|you|it|put|create|gain|draw|target))\b/)[0];
  const f = { types: [], non: [], opp: false, you: false, tapped: false, untapped: false, combat: false, mvMax: null, powMin: null, powMax: null };
  const plain = ph.replace(/\bnon-?\w+/g, '');
  for (const w of TYPE_WORDS) if (new RegExp('\\b' + w + 's?\\b').test(plain)) f.types.push(w);
  for (const m of ph.matchAll(/\bnon-?(\w+)/g)) f.non.push(m[1]);
  if (/an opponent controls|you don't control|your opponents control/.test(ph)) f.opp = true;
  else if (/\byou control\b/.test(ph)) f.you = true;
  if (/\buntapped\b/.test(ph)) f.untapped = true;
  else if (/\btapped\b/.test(ph)) f.tapped = true;
  if (/\battacking\b|\bblocking\b/.test(ph)) f.combat = true;
  let m;
  if ((m = ph.match(/mana value (\d+) or less/))) f.mvMax = +m[1];
  if ((m = ph.match(/power (\d+) or greater/))) f.powMin = +m[1];
  if ((m = ph.match(/power (\d+) or less/))) f.powMax = +m[1];
  if (!f.types.length) {
    // jugadores, hechizos, cementerios o cartas: no son permanentes en juego
    if (/\b(player|opponent|spell|graveyard|card|ability)/.test(ph)) return null;
    // un subtipo («target Zombie», «target Equipment», «target Vehicle»)
    const sub = orig.match(/\b([A-Z][a-z]+)\b/);
    if (!sub) return null;
    f.types.push('permanent');
    f.sub = sub[1];
  }
  return f;
}

/** Objetivo de un efecto a partir de la frase: sólo criaturas → 'creature'; si no, 'permanent'. */
function permTarget(ph) {
  const filter = parseTargetPhrase(ph);
  if (!filter) return null;
  const onlyCreature = filter.types.length === 1 && filter.types[0] === 'creature';
  return { target: onlyCreature ? 'creature' : 'permanent', filter };
}

const PTYPE_ES = { creature: ['criatura', 'f'], artifact: ['artefacto', 'm'], enchantment: ['encantamiento', 'm'], planeswalker: ['planeswalker', 'm'], land: ['tierra', 'f'], permanent: ['permanente', 'm'], battle: ['batalla', 'f'] };
const NON_ES = { land: 'tierra', creature: 'criatura', artifact: 'artefacto', enchantment: 'encantamiento', planeswalker: 'planeswalker', token: 'ficha', legendary: 'legendario',
  black: 'negro', white: 'blanco', blue: 'azul', red: 'rojo', green: 'verde' };

/** «una criatura girada», «un permanente que no sea tierra», «un artefacto o encantamiento de un rival»… */
export function targetEs(f) {
  if (!f) return 'una criatura';
  const ts = f.types.map((t) => PTYPE_ES[t] || [t, 'm']);
  const fem = ts[0][1] === 'f';
  let out = f.sub ? (TOKEN_ES[f.sub] || f.sub) : (fem ? 'una ' : 'un ') + ts.map(([w]) => w).join(' o ');
  if (f.tapped) out += fem ? ' girada' : ' girado';
  if (f.untapped) out += fem ? ' enderezada' : ' enderezado';
  if (f.combat) out += ' que esté atacando o bloqueando';
  if (f.non.length) out += ' que no sea ' + f.non.map((n) => NON_ES[n] || n).join(' ni ');
  if (f.mvMax != null) out += ` de valor de maná ${f.mvMax} o menos`;
  if (f.powMin != null) out += ` con fuerza ${f.powMin} o más`;
  if (f.powMax != null) out += ` con fuerza ${f.powMax} o menos`;
  if (f.opp) out += ' de un rival';
  if (f.you) out += ' tuy' + (fem ? 'a' : 'o');
  return out;
}

function parseSentence(t) {
  const fx = [];
  let m;
  if ((m = t.match(/deals (\d+) damage to any target/i))) fx.push({ kind: 'damage', amount: +m[1], target: 'any' });
  else if ((m = t.match(/deals (\d+) damage to (?:up to one )?target ((?:attacking or blocking |tapped )?creature(?: or planeswalker)?(?: an opponent controls| you don't control)?)/i))) fx.push({ kind: 'damage', amount: +m[1], ...permTarget(m[2]) });
  else if ((m = t.match(/deals (\d+) damage to (?:target player|target opponent|each opponent)/i))) fx.push({ kind: 'damage', amount: +m[1], target: /each opponent/i.test(t) ? 'opponents' : 'player' });
  if ((m = t.match(/\b(Destroy|Exile) (?:up to one )?(?:another )?target ([^.\n]+)/i)) && !/^[\w ,]*\bcards?\b/i.test(m[2])) {
    const pt = permTarget(m[2]);
    if (pt) fx.push({ kind: m[1].toLowerCase() === 'destroy' ? 'destroy' : 'exile', ...pt });
  }
  if (/Counter target (?:creature |noncreature |instant or sorcery |instant |sorcery )?spell/i.test(t)) fx.push({ kind: 'counterspell', target: 'spell' });
  if ((m = t.match(/Target creature gets ([+-]\d+)\/([+-]\d+) until end of turn/i))) fx.push({ kind: 'pump', p: +m[1], t: +m[2], target: 'creature' });
  if ((m = t.match(/Return (?:up to one )?(?:another )?target ([^.\n]+?) to (?:its|their) owner(?:'|’)s hand/i)) && !/\bcard\b/i.test(m[1]) && permTarget(m[1])) fx.push({ kind: 'bounce', ...permTarget(m[1]) });
  if (/[Pp]ut a \+1\/\+1 counter on (?:up to one )?target creature/.test(t)) fx.push({ kind: 'counter', target: 'creature' });
  if ((m = t.match(/(?:target opponent|each opponent) loses (\d+) life/i))) fx.push({ kind: 'drain', amount: +m[1] });
  if ((m = t.match(/[Yy]ou gain (\d+) life/))) fx.push({ kind: 'gain', amount: +m[1] });
  // «Target player gains N life»: casi siempre te lo aplicas a ti
  else if ((m = t.match(/[Tt]arget player gains (\d+) life/))) fx.push({ kind: 'gain', amount: +m[1] });
  if ((m = t.match(/[Yy]ou lose (\d+) life/))) fx.push({ kind: 'lose', amount: +m[1] });
  if ((m = t.match(/[Dd]raws? (a|one|two|three|\d+) cards?/))) fx.push({ kind: 'draw', amount: num(m[1]) });
  if (!/you lose/i.test(t) && (m = t.match(/[Tt]arget player draws \w+ cards? and loses (\d+) life/))) fx.push({ kind: 'lose', amount: +m[1] });
  if ((m = t.match(/[Cc]reate (a|an|one|two|three|four|\d+) (\d+)\/(\d+) ((?:white|blue|black|red|green|colorless)(?: and (?:white|blue|black|red|green))?) ([A-Z][\w ]*?) (?:artifact )?creature tokens?(?: with ([a-z, ]+))?/))) {
    fx.push({
      kind: 'token', amount: num(m[1]), power: +m[2], toughness: +m[3],
      colors: m[4].split(' and ').map((w) => COLOR_WORD[w]).filter((c) => c && c !== 'C'), subtype: m[5].trim(),
      keywords: (m[6] || '').split(/,| and /).map((s) => s.trim()).filter(Boolean),
    });
  }
  if (/[Rr]eturn (?:up to one )?target creature card from your graveyard to your hand/.test(t)) fx.push({ kind: 'regrow' });
  // «Exilia la primera carta de tu biblioteca. Hasta el final de tu próximo turno, puedes jugar esa carta.»
  if ((m = t.match(/[Ee]xile the top (card|two cards|three cards|four cards|\d+ cards) of your library\.?\s*(?:Until (?:the )?end of (your next turn|turn), you may (play|cast) (?:that card|it|them|those cards)|You may (play|cast) (?:that card|it|them|those cards) (this turn|until the end of your next turn))/))) {
    fx.push({ kind: 'impulse', amount: m[1] === 'card' ? 1 : num(m[1].split(' ')[0]), until: /next/.test(m[2] || m[5] || '') ? 'next' : 'turn', play: m[3] || m[4] });
  }
  if ((m = t.match(/[Yy]ou may play (an|one|two|three) additional lands? this turn/))) fx.push({ kind: 'extraLand', amount: num(m[1]) });
  // girar / enderezar: la criatura encantada o equipada, o un objetivo
  if (/attach (?:it|this Equipment) to target creature you control/i.test(t)) fx.push({ kind: 'attachTo', target: 'creature', filter: { types: ['creature'], non: [], you: true } });
  if (/\btap (?:enchanted|equipped) creature/i.test(t)) fx.push({ kind: 'tapHost' });
  else if ((m = t.match(/\b(tap|untap) (?:up to one )?(?:another )?target ([^.\n]+?)(?:\.|,|$| and )/i)) && permTarget(m[2])) fx.push({ kind: m[1].toLowerCase() === 'tap' ? 'tap' : 'untap', ...permTarget(m[2]) });
  return fx;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export const needsTarget = (e) => ['any', 'creature', 'permanent', 'player', 'spell'].includes(e.target);

/** Lista de objetivos que pide una carta al jugarse (en orden). */
/** Efectos que aplica una carta al resolverse (incluidos los modos elegidos). */
export function effectFx(card) {
  const base = (card.isPermanent ? card.effects?.etb : card.effects?.spell) || [];
  const m = card.effects?.modes;
  if (!m || !card.chosenModes) return base;
  return [...base, ...card.chosenModes.flatMap((i) => (m[i] ? m[i].fx : []))];
}

export function targetsFor(card) {
  const fx = effectFx(card);
  const out = (fx || []).filter(needsTarget);
  // Aura: se lanza sobre una criatura (va al final para no mover los objetivos de sus efectos)
  if (/\bAura\b/.test(card.typeLine || '') && /^Enchant creature/im.test(card.oracle || '')) out.push({ kind: 'aura', target: 'creature', attach: true, oracle: card.oracle });
  return out;
}

const TOKEN_ES = { Hero: 'Héroe', Construct: 'Constructo', Thopter: 'Tóptero', Elemental: 'Elemental', Faerie: 'Hada', Dog: 'Perro', Squirrel: 'Ardilla',
  Snake: 'Serpiente', Plant: 'Planta', Ox: 'Buey', Pest: 'Plaga', Servo: 'Servo', Illusion: 'Ilusión', Golem: 'Gólem', Demon: 'Demonio', Giant: 'Gigante',
  Shapeshifter: 'Cambiaformas', Dwarf: 'Enano', Halfling: 'Mediano', Orc: 'Orco', Army: 'Ejército', Monk: 'Monje', Cleric: 'Clérigo', Wizard: 'Hechicero',
  Rogue: 'Pícaro', Horror: 'Horror', Treefolk: 'Arbóreo', Fungus: 'Hongo', Germ: 'Germen', Wurm: 'Sierpe', Hippo: 'Hipopótamo', Rabbit: 'Conejo', Frog: 'Rana',
  Soldier: 'Soldado', Goblin: 'Trasgo', Zombie: 'Zombi', Spirit: 'Espíritu', Elf: 'Elfo', Warrior: 'Guerrero', Beast: 'Bestia', Bird: 'Ave', Knight: 'Caballero', Saproling: 'Saprolín', Human: 'Humano', Cat: 'Gato', Wolf: 'Lobo', Insect: 'Insecto', Rat: 'Rata', Vampire: 'Vampiro', Angel: 'Ángel', Dragon: 'Dragón' };

const KW_ES = { flying: 'vuela', vigilance: 'vigilancia', lifelink: 'vínculo vital', haste: 'prisa', trample: 'arrollar', deathtouch: 'toque mortal',
  reach: 'alcance', menace: 'amenaza', 'first strike': 'dañar primero', defender: 'defensor', hexproof: 'antimaleficio', indestructible: 'indestructible', 'double strike': 'dañar dos veces' };
const COLOR_ES = { W: 'blanca', U: 'azul', B: 'negra', R: 'roja', G: 'verde' };
const COLOR_EN = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };

export function tokenCard(e) {
  const es = TOKEN_ES[e.subtype] || e.subtype;
  const kws = e.keywords.map((k) => k.toLowerCase());
  const colEs = e.colors.length ? e.colors.map((c) => COLOR_ES[c]).join(' y ') : 'incolora';
  const colEn = e.colors.length ? e.colors.map((c) => COLOR_EN[c]).join(' and ') : 'colorless';
  const kwEs = kws.map((k) => KW_ES[k] || k);
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  return {
    id: 'token:' + e.subtype + e.power + e.toughness + e.colors.join('') + kws.join(','),
    name: `${e.subtype} Token`,
    printedName: `Ficha de ${es}`,
    image: null,
    manaCost: '', cmc: 0,
    typeLine: `Token Creature — ${e.subtype}`,
    printedType: `Criatura ficha — ${es}`,
    oracle: (kws.length ? kws.map(cap).join(', ') + '\n' : '') + `(${e.power}/${e.toughness} ${colEn} ${e.subtype} creature token.)`,
    printedText: (kwEs.length ? kwEs.map(cap).join(', ') + '.\n' : '') + `Ficha de criatura ${es} ${e.power}/${e.toughness} ${colEs}. Es una criatura más: puede atacar y bloquear, pero si sale del campo de batalla deja de existir.`,
    power: e.power, toughness: e.toughness,
    colors: e.colors, keywords: kws,
    subtype: e.subtype,
    isLand: false, isCreature: true, isInstant: false, isSorcery: false, isLegendary: false, isPermanent: true, isToken: true,
    produces: [], effects: { etb: [], spell: [] },
  };
}

/** Texto en español de un efecto (para explicarlo al jugador). */
export function describeEffect(e) {
  switch (e.kind) {
    case 'damage': return `hace ${e.amount} de daño` + (e.target === 'creature' || e.target === 'permanent' ? ' a ' + targetEs(e.filter) : e.target === 'opponents' ? ' a cada rival' : e.target === 'player' ? ' a un jugador' : ' a cualquier objetivo');
    case 'destroy': return 'destruye ' + targetEs(e.filter);
    case 'exile': return 'exilia ' + targetEs(e.filter);
    case 'pump': return `da ${e.p >= 0 ? '+' : ''}${e.p}/${e.t >= 0 ? '+' : ''}${e.t} a una criatura hasta el final del turno`;
    case 'bounce': return 'devuelve ' + targetEs(e.filter) + ' a la mano de su propietario';
    case 'counter': return 'pone un contador +1/+1 en una criatura';
    case 'drain': return `cada rival pierde ${e.amount} vidas`;
    case 'gain': return `ganas ${e.amount} vidas`;
    case 'lose': return `pierdes ${e.amount} vidas`;
    case 'draw': return `robas ${e.amount} carta${e.amount > 1 ? 's' : ''}`;
    case 'token': return `crea ${e.amount} ficha${e.amount > 1 ? 's' : ''} de ${e.power}/${e.toughness}`;
    case 'regrow': return 'recupera una criatura de tu cementerio';
    case 'counterspell': return 'contrarresta un hechizo';
    case 'impulse': return `exilia ${e.amount === 1 ? 'la primera carta' : 'las ' + e.amount + ' primeras cartas'} de tu biblioteca y puedes ${e.play === 'cast' ? 'lanzarla' : 'jugarla'} ${e.until === 'next' ? 'hasta el final de tu próximo turno' : 'este turno'}`;
    case 'tapHost': return 'gira la criatura encantada';
    case 'tokenAttach': return `crea una ficha ${e.power}/${e.toughness} y se le equipa`;
    case 'attachTo': return 'se equipa a una criatura tuya';
    case 'tap': return 'gira ' + targetEs(e.filter);
    case 'untap': return 'endereza ' + targetEs(e.filter);
    case 'extraLand': return `puedes jugar ${e.amount === 1 ? 'una tierra adicional' : e.amount + ' tierras adicionales'} este turno`;
    case 'aura': return 'elige la criatura que encanta';
    case 'equip': return 'elige la criatura a la que lo equipas';
    default: return describeMore(e);
  }
}

const sgn = (n) => (n === 'X' ? 'X' : (n >= 0 ? '+' : '') + n);
const cards = (n) => (n === 1 ? 'una carta' : n + ' cartas');
function describeMore(e) {
  const t = e.filter ? targetEs(e.filter) : 'una criatura';
  const who = (w) => ({ 'each opponent': 'cada rival', 'target opponent': 'un rival', 'target player': 'un jugador', 'each player': 'cada jugador', you: 'tú', 'that player': 'ese jugador', 'defending player': 'el jugador defensor' }[w] || w || '');
  switch (e.kind) {
    case 'pickMine': return 'elige una criatura tuya';
    case 'bite': return `tu criatura hace daño igual a su fuerza a ${e.target === 'creature' || e.target === 'permanent' ? t : 'su objetivo'}`;
    case 'fight': return `tu criatura pelea con ${t}`;
    case 'destroyAll': return `destruye ${t.replace(/^una? /, 'todos los/las ')}`;
    case 'exileAll': return `exilia ${t.replace(/^una? /, 'todos los/las ')}`;
    case 'bounceAll': return `devuelve a la mano ${t.replace(/^una? /, 'todos los/las ')}`;
    case 'bounceSelf': return 'vuelve a la mano de su propietario';
    case 'tuck': return `pone ${t} en la biblioteca de su propietario`;
    case 'tapAll': return `gira ${t.replace(/^una? /, 'todos los/las ')}`;
    case 'untapAll': return `endereza ${t.replace(/^una? /, 'todos los/las ')}`;
    case 'untapSelf': return 'se endereza';
    case 'tapSelf': return 'se gira';
    case 'freeze': return 'esa criatura no se endereza en su próximo paso de enderezar';
    case 'pump': {
      const parts = [];
      if (e.p || e.t) parts.push(`${sgn(e.p)}/${sgn(e.t)}`);
      if (e.kw?.length) parts.push(e.kw.map((k) => KW_ES[k] || k).join(', '));
      return `${e.self ? 'esta criatura recibe' : e.host ? 'la criatura equipada recibe' : 'da a ' + t} ${parts.join(' y ')} hasta el final del turno`;
    }
    case 'pumpAll': return `${e.who === 'mine' ? 'tus criaturas reciben' : e.who === 'opp' ? 'las criaturas rivales reciben' : 'todas las criaturas reciben'} ${sgn(e.p)}/${sgn(e.t)}${e.kw?.length ? ' y ' + e.kw.map((k) => KW_ES[k] || k).join(', ') : ''} hasta el final del turno`;
    case 'noBlock': return `${t} no puede ${e.noAttack ? 'atacar ni bloquear' : 'bloquear'} este turno`;
    case 'noBlockAll': return 'las criaturas rivales no pueden bloquear este turno';
    case 'unblockable': return `${e.self ? 'esta criatura' : t} no puede ser bloqueada este turno`;
    case 'counter': return `${e.self ? 'esta criatura recibe' : e.host ? 'la criatura equipada recibe' : 'pone en ' + t} ${Math.abs(e.amount || 1)} contador${Math.abs(e.amount || 1) > 1 ? 'es' : ''} ${(e.amount || 1) > 0 ? '+1/+1' : '-1/-1'}`;
    case 'counterAll': return `pone ${Math.abs(e.amount)} contador${Math.abs(e.amount) > 1 ? 'es' : ''} ${e.amount > 0 ? '+1/+1' : '-1/-1'} en ${e.all ? 'cada criatura' : 'cada criatura tuya'}`;
    case 'proliferate': return 'prolifera';
    case 'drawOther': return `${who(e.who)} roba ${cards(e.amount)}`;
    case 'discard': return e.who === 'you' ? `descartas ${e.amount === 'all' ? 'tu mano' : cards(e.amount)}` : `${who(e.who)} descarta ${cards(e.amount)}`;
    case 'loseAll': return `cada jugador pierde ${e.amount} vidas`;
    case 'gainAll': return `cada jugador gana ${e.amount} vidas`;
    case 'artifactToken': return `crea ${e.amount === 1 ? 'una ficha' : e.amount + ' fichas'} de ${ART_TOKENS[e.subtype]?.es || e.subtype}`;
    case 'amass': return `amasa ${e.amount}`;
    case 'addMana': return `agrega ${e.mana.map((m) => (m.length > 1 ? '{' + m.join('/') + '}' : '{' + m[0] + '}')).join('')}`;
    case 'scry': return `adivina ${e.amount}`;
    case 'surveil': return `vigila ${e.amount}`;
    case 'mill': return e.who === 'you' ? `mueles ${e.amount}` : `${who(e.who)} muele ${e.amount}`;
    case 'tutor': return `busca ${e.what} en tu biblioteca`;
    case 'instruct': return e.text.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase());
    case 'explore': return 'explora';
    case 'connive': return 'conspira';
    case 'edict': return `${who(e.who)} sacrifica ${targetEs(e.filter)}`;
    case 'sacSelf': return 'se sacrifica';
    case 'regen': return 'se regenera';
    case 'reanimate': return 'devuelve una carta de tu cementerio al campo de batalla';
    case 'selfRecur': return e.to === 'hand' ? 'vuelve de tu cementerio a tu mano' : 'vuelve de tu cementerio al campo de batalla';
    case 'tapHost': return 'gira la criatura encantada';
    case 'tap': return 'gira ' + t;
    case 'untap': return 'endereza ' + t;
    default: return '';
  }
}

/** Coste de una habilidad activada, en español. */
export function costEs(c) {
  if (!c) return '';
  if (c.loyalty != null) return c.loyalty === 'X' ? '−X' : (c.loyalty > 0 ? '+' : c.loyalty < 0 ? '−' : '') + Math.abs(c.loyalty);
  const parts = [];
  if (c.mana) parts.push(c.mana);
  if (c.tap) parts.push('girar');
  if (c.untap) parts.push('enderezar');
  if (c.life) parts.push(`pagar ${c.life} vida${c.life > 1 ? 's' : ''}`);
  if (c.discard) parts.push(`descartar ${c.discard === 1 ? 'una carta' : c.discard + ' cartas'}`);
  if (c.removeCounters) parts.push(`quitar ${c.removeCounters} contador${c.removeCounters > 1 ? 'es' : ''}`);
  if (c.sacSelf) parts.push('sacrificarla');
  if (c.exileSelf) parts.push('exiliarla');
  return parts.join(', ') || 'gratis';
}

// ------------------------------------------------------------ equipo y auras

const ATTACH_KW = ['first strike', 'double strike', 'flying', 'vigilance', 'lifelink', 'haste', 'trample', 'deathtouch', 'reach', 'menace',
  'hexproof', 'indestructible', 'shroud', 'defender'];

/**
 * Lo que da un Equipo o un Aura a la criatura equipada/encantada, leído del oracle:
 * { equip: '{4}' | null, mods: [{ p, t, kw: [], types: [], myTurn }] }.
 */
export function parseAttach(card) {
  const type = card.typeLine || '';
  const isEquip = /\bEquipment\b/.test(type);
  const isAura = /\bAura\b/.test(type);
  if (!isEquip && !isAura) return null;
  const text = (card.oracle || '').replace(/\([^)]*\)/g, '');
  // «Equip {4}», «Gae Bolg — Equip {4}», «Equip—Pay {3} or discard a card», «Equip—Pay 3 life»
  const eqLine = (text.match(/(?:^|—\s*)Equip\b[^\n]*/im) || [''])[0].replace(/^—\s*/, '');
  const em = eqLine.match(/^Equip(?: [a-z ]+)?\s*(?:—\s*Pay\s*)?((?:\{[^}]+\})+)/i);
  const lifeM = eqLine.match(/^Equip\s*—\s*Pay (\d+) life/i);
  const mods = [];
  for (const raw of text.split(/\n|\.\s+/)) {
    if (/^\s*Whenever (?:enchanted|equipped) creature deals damage, you gain that much life/i.test(raw)) { mods.push({ p: 0, t: 0, kw: ['lifelink'], types: [], myTurn: false }); continue; }
    const m = raw.match(/^\s*(During your turn, )?(?:equipped|enchanted) (?:creature|permanent|artifact|land) (.+)$/i);
    if (!m) continue;
    const rest = m[2];
    const own = rest.replace(/[“"][^”"]*[”"]/g, ''); // sin habilidades entre comillas que se le dan
    const mod = { p: 0, t: 0, kw: [], types: [], myTurn: !!m[1] };
    const g = rest.match(/gets ([+-]\d+)\/([+-]\d+)/i);
    if (g) { mod.p = +g[1]; mod.t = +g[2]; }
    const hasM = rest.match(/\bha(?:s|ve) ([a-z ,]+?)(?:\.|$| and gets| as long| until)/i);
    if (hasM) for (const k of ATTACH_KW) if (new RegExp('\\b' + k + '\\b', 'i').test(hasM[1])) mod.kw.push(k);
    // «dañar dos veces» incluye «dañar primero» en el texto: no duplicar
    if (mod.kw.includes('double strike')) mod.kw = mod.kw.filter((k) => k !== 'first strike' || /first strike/i.test(hasM[1].replace(/double strike/ig, '')));
    const ty = rest.match(/is an? ([A-Z][\w ]*?) in addition to its other types/);
    if (ty) mod.types.push(ty[1].trim());
    if (/doesn['’]t untap during/i.test(own)) mod.noUntap = true;
    if (/can['’]t attack(?! you)/i.test(own) && !/can['’]t attack or block alone/i.test(own)) mod.cantAttack = true;
    if (/can['’]t (?:attack or )?block/i.test(own) && !/alone/i.test(own)) mod.cantBlock = true;
    if (mod.p || mod.t || mod.kw.length || mod.types.length || mod.noUntap || mod.cantAttack || mod.cantBlock) mods.push(mod);
  }
  const equip = !isEquip || !eqLine ? null : em ? em[1] : '';
  return { equip, equipLife: lifeM ? +lifeM[1] : 0, equipNote: equip === '' && !lifeM ? eqLine.replace(/^Equip\s*—\s*/i, '') : '', aura: isAura, mods };
}

/** Texto en español de lo que da un equipo/aura. */
export function describeAttach(att) {
  if (!att) return '';
  const fmt = (n) => (n >= 0 ? '+' : '') + n;
  return att.mods.map((m) => {
    const parts = [];
    if (m.p || m.t) parts.push(`${fmt(m.p)}/${fmt(m.t)}`);
    if (m.types.length) parts.push(`es ${m.types.map((t) => TOKEN_ES[t] || t).join(', ')}`);
    if (m.kw.length) parts.push(m.kw.map((k) => KW_ES[k] || k).join(', '));
    if (m.cantAttack && m.cantBlock) parts.push('no puede atacar ni bloquear');
    else if (m.cantAttack) parts.push('no puede atacar');
    else if (m.cantBlock) parts.push('no puede bloquear');
    if (m.noUntap) parts.push('no se endereza en su paso de enderezar');
    return parts.join(', ') + (m.myTurn ? ' (en tu turno)' : '');
  }).filter(Boolean).join('; ');
}
export const kwEs = (k) => KW_ES[k] || k;
export const TYPE_ES = TOKEN_ES;

// ------------------------------------------------------------ fichas de artefacto

const ART_TOKENS = {
  Treasure: { es: 'Tesoro', oracle: '{T}, Sacrifice this artifact: Add one mana of any color.', textEs: 'Gira y sacrifica este artefacto: agrega un maná de cualquier color.', produces: ['W', 'U', 'B', 'R', 'G'], sacOnMana: true },
  Gold: { es: 'Oro', oracle: 'Sacrifice this artifact: Add one mana of any color.', textEs: 'Sacrifica este artefacto: agrega un maná de cualquier color.', produces: ['W', 'U', 'B', 'R', 'G'], sacOnMana: true },
  Food: { es: 'Comida', oracle: '{2}, {T}, Sacrifice this artifact: You gain 3 life.', textEs: '{2}, gira y sacrifica este artefacto: ganas 3 vidas.' },
  Clue: { es: 'Pista', oracle: '{2}, Sacrifice this artifact: Draw a card.', textEs: '{2}, sacrifica este artefacto: roba una carta.' },
  Blood: { es: 'Sangre', oracle: '{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card.', textEs: '{1}, gira, descarta una carta y sacrifica este artefacto: roba una carta.' },
  Map: { es: 'Mapa', oracle: '{1}, {T}, Sacrifice this artifact: Target creature you control explores. Activate only as a sorcery.', textEs: '{1}, gira y sacrifica este artefacto: la criatura objetivo que controlas explora. Sólo como un conjuro.' },
  Powerstone: { es: 'Piedra de poder', oracle: '{T}: Add {C}. This mana can\'t be spent to cast a nonartifact spell.', textEs: 'Gira: agrega {C} (sólo para artefactos).', produces: ['C'] },
  Junk: { es: 'Chatarra', oracle: '{T}, Sacrifice this artifact: Exile the top card of your library. You may play that card this turn. Activate only as a sorcery.', textEs: 'Gira y sacrifica: exilia la primera carta de tu biblioteca; puedes jugarla este turno.' },
  Shard: { es: 'Fragmento', oracle: '{2}, Sacrifice this enchantment: Scry 1, then draw a card.', textEs: '{2}, sacrifica: adivina 1 y roba una carta.' },
  Lander: { es: 'Aterrizador', oracle: '{2}, {T}, Sacrifice this artifact: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.', textEs: '{2}, gira y sacrifica: busca una tierra básica y ponla en juego girada.' },
};

/** Ficha de Tesoro, Comida, Pista, Sangre… como carta jugable (con su habilidad). */
export function artifactTokenCard(subtype) {
  const d = ART_TOKENS[subtype] || { es: subtype, oracle: '', textEs: '' };
  return {
    id: 'token:' + subtype, name: `${subtype} Token`, printedName: `Ficha de ${d.es}`, image: null, manaCost: '', cmc: 0,
    typeLine: `Token ${subtype === 'Shard' ? 'Enchantment' : 'Artifact'} — ${subtype}`, printedType: `Artefacto ficha — ${d.es}`,
    oracle: d.oracle, printedText: d.textEs, power: null, toughness: null, colors: [], keywords: [], subtype,
    isLand: false, isCreature: false, isInstant: false, isSorcery: false, isLegendary: false, isPermanent: true, isToken: true,
    produces: d.produces || [], sacOnMana: !!d.sacOnMana, effects: { etb: [], spell: [], dies: [] },
  };
}
