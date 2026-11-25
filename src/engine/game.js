// Motor de reglas de Magic.
// Es un "reducer" puro: apply(state, action) -> nuevo estado. Así el mismo
// código sirve para jugar en local, contra bots y en red (el anfitrión manda).
//
// Sigue la estructura oficial del turno (reglas 500-514), la pila y la
// prioridad (405, 117), el combate con dañar primero (510) y las acciones
// basadas en estado más comunes (704). Las habilidades se leen del texto
// oficial (effects.js); lo que no se reconoce se aplica a mano.

import { pips } from './cards.js';
import { tokenCard, describeEffect, needsTarget, parseAttach, describeAttach, targetsFor, artifactTokenCard, kwEs, targetEs, effectFx } from './effects.js';
import { staticsOf, triggersOf, activatedOf, keywordsOf, abilitiesOf, altCosts, levelsOf } from './abilities.js';
import { manualParts } from './coverage.js';

// Etapas del turno en orden. Las marcadas como automáticas pasan solas
// (como en los juegos digitales) salvo que haya algo en la pila.
export const STEPS = ['untap', 'upkeep', 'draw', 'main1', 'begincombat', 'attack', 'block', 'firststrike', 'damage', 'endcombat', 'main2', 'end', 'cleanup'];
const AUTO = new Set(['untap', 'upkeep', 'draw', 'begincombat', 'firststrike', 'damage', 'endcombat', 'end', 'cleanup']);

export const PHASES = [
  { name: 'Inicio', steps: ['untap', 'upkeep', 'draw'] },
  { name: 'Principal 1', steps: ['main1'] },
  { name: 'Combate', steps: ['begincombat', 'attack', 'block', 'firststrike', 'damage', 'endcombat'] },
  { name: 'Principal 2', steps: ['main2'] },
  { name: 'Final', steps: ['end', 'cleanup'] },
];

export const STEP_INFO = {
  untap: { name: 'Enderezar', group: 'Inicio', help: 'Se enderezan todas tus cartas giradas. Ya puedes volver a usar tus tierras y criaturas.' },
  upkeep: { name: 'Mantenimiento', group: 'Inicio', help: 'Se resuelven los efectos de "al comienzo de tu mantenimiento".' },
  draw: { name: 'Robar', group: 'Inicio', help: 'Robas una carta de tu biblioteca (quien empieza la partida no roba en su primer turno).' },
  main1: { name: 'Fase principal 1', group: 'Principal', help: 'Puedes jugar UNA tierra por turno y lanzar criaturas, artefactos, encantamientos, planeswalkers y conjuros pagando su coste de maná.' },
  begincombat: { name: 'Inicio del combate', group: 'Combate', help: 'Último momento para usar efectos antes de declarar atacantes.' },
  attack: { name: 'Declarar atacantes', group: 'Combate', help: 'Toca las criaturas con las que quieres atacar. Se giran al atacar (salvo con vigilancia). Las que entraron este turno están "mareadas" y no pueden atacar (salvo con prisa).' },
  block: { name: 'Declarar bloqueadores', group: 'Combate', help: 'El defensor elige qué criaturas enderezadas bloquean a cada atacante. Después, ambos pueden usar trucos de combate (instantáneos).' },
  firststrike: { name: 'Daño de dañar primero', group: 'Combate', help: 'Las criaturas con dañar primero (o dañar dos veces) hacen su daño antes que las demás.' },
  damage: { name: 'Daño de combate', group: 'Combate', help: 'Cada criatura hace daño igual a su fuerza. Si una criatura recibe daño igual o mayor a su resistencia, muere. El daño no bloqueado va al jugador.' },
  endcombat: { name: 'Final del combate', group: 'Combate', help: 'Termina el combate.' },
  main2: { name: 'Fase principal 2', group: 'Principal', help: 'Otra fase principal: si no jugaste tierra, aún puedes, y puedes lanzar hechizos después de ver cómo fue el combate.' },
  end: { name: 'Paso final', group: 'Final', help: 'Se resuelven los efectos de "al comienzo del paso final".' },
  cleanup: { name: 'Limpieza', group: 'Final', help: 'Se descartan cartas hasta tener 7 en la mano, se cura el daño y terminan los efectos "hasta el final del turno".' },
};

const MAX_EVENTS = 60;
const MAX_HAND = 7;

const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/**
 * Crea una partida.
 * players: [{ id, name, isBot, level?, deck?: Card[], commander?: Card }]
 * first: índice de quien empieza (si no, se tira un dado).
 */
export function createGame({ mode = '1v1', players, seed = Date.now(), first = null }) {
  const commander = mode === 'commander';
  const rnd = rng(seed);
  const s = {
    mode,
    startingLife: commander ? 40 : 20,
    turn: 1,
    active: 0,
    step: 'main1',
    nextId: 1,
    combat: emptyCombat(),
    lastCombat: null,
    stack: [],
    events: [],
    eventSeq: 0,
    log: [],
    winner: null,
    seed: Math.floor(rnd() * 1e9),
  };
  s.players = players.map((p) => ({
    id: p.id,
    name: p.name,
    isBot: !!p.isBot,
    level: p.level || 'normal',
    deckLabel: p.deckLabel || null,
    life: s.startingLife,
    poison: 0,
    cmdDamage: {},
    battlefield: [],
    graveyard: [],
    exile: [],
    hand: [],
    // cartas en la mano física de un jugador humano (estimación que la app lleva sola)
    handCount: p.isBot ? 0 : 7,
    library: [],
    commander: null,
    commanderTax: 0,
    commanderInZone: false,
    landsPlayed: 0,
    manaPool: [], // maná ya sacado al girar tierras a mano: [['B'], ['W','U'], ...]
    eliminated: false,
  }));

  // ¿Quién empieza? Se tira un dado de 20 caras (regla 103.1).
  let rolls = null;
  if (first == null) {
    do {
      rolls = s.players.map(() => 1 + Math.floor(rnd() * 20));
    } while (rolls.filter((r) => r === Math.max(...rolls)).length > 1);
    first = rolls.indexOf(Math.max(...rolls));
  }
  s.active = first;
  s.rolls = rolls;

  s.players.forEach((pl, i) => {
    const src = players[i];
    if (src.deck) {
      pl.library = shuffle(src.deck.map((c) => ({ ...c, uid: s.nextId++ })), rnd);
      for (let k = 0; k < 7; k++) drawCard(s, pl);
      if (pl.isBot) botMulligan(s, pl, rnd, s.players.length > 2);
    }
    if (commander && src.commander) setCommander(s, pl, src.commander);
  });
  const starter = s.players[first];
  pushEvent(s, 'start', rolls
    ? `Se tira un dado: ${s.players.map((p, i) => `${p.name} saca ${rolls[i]}`).join(', ')}. Empieza ${starter.name}.`
    : `¡Empieza la partida! Turno de ${starter.name}.`, { player: starter.id, rolls });
  return s;
}

/** Mulligan de Londres para los bots: si la mano no tiene 2-5 tierras, otra vez (una vez). */
function botMulligan(s, pl, rnd, free = false) {
  const lands = pl.hand.filter((c) => c.isLand).length;
  if (lands >= 2 && lands <= 5) return;
  pl.library.push(...pl.hand.splice(0));
  shuffle(pl.library, rnd);
  for (let k = 0; k < 7; k++) drawCard(s, pl);
  // 103.5c: en multijugador el primer mulligan es gratis (no se pone ninguna carta al fondo).
  if (free) {
    pushEvent(s, 'info', `${pl.name} hace mulligan (el primero es gratis en multijugador).`);
    return;
  }
  // pone al fondo la carta peor (la más cara si sobran hechizos, una tierra si sobran tierras)
  const l2 = pl.hand.filter((c) => c.isLand).length;
  const pick = l2 > 4 ? pl.hand.find((c) => c.isLand) : [...pl.hand].filter((c) => !c.isLand).sort((a, b) => b.cmc - a.cmc)[0] || pl.hand[0];
  pl.hand.splice(pl.hand.indexOf(pick), 1);
  pl.library.push(pick);
  pushEvent(s, 'info', `${pl.name} hace mulligan y se queda con 6 cartas.`);
}

function emptyCombat() {
  return { attackers: {}, blocks: {}, confirmed: [], ready: [], result: null, firstDone: false };
}

// ---------------------------------------------------------------- utilidades

export const player = (s, id) => s.players.find((p) => p.id === id);
export const activePlayer = (s) => s.players[s.active];
export const alivePlayers = (s) => s.players.filter((p) => !p.eliminated);
export const opponents = (s, id) => s.players.filter((p) => p.id !== id && !p.eliminated);
export const stackTop = (s) => s.stack[s.stack.length - 1] || null;

export function findPerm(s, uid) {
  for (const p of s.players) {
    const perm = p.battlefield.find((x) => x.uid === uid);
    if (perm) return { perm, owner: p };
  }
  return null;
}

export function has(perm, kw) {
  return perm.card.keywords.includes(kw) || !!(perm.bonus && perm.bonus.kw.includes(kw)) || !!(perm.eot && perm.eot.kw && perm.eot.kw.includes(kw))
    || (kw === 'lifelink' && staticsOf(perm.card).some((x) => x.kind === 'lifelinkLike'));
}

export function power(perm) {
  return (perm.card.power || 0) + perm.counters + perm.pump.p + (perm.bonus ? perm.bonus.p : 0);
}
export function toughness(perm) {
  return (perm.card.toughness || 0) + perm.counters + perm.pump.t + (perm.bonus ? perm.bonus.t : 0);
}

/** Lo que da un equipo/aura (del oracle; las cartas antiguas guardadas no lo traen). */
export function attachOf(card) {
  if (card.attach !== undefined) return card.attach;
  return parseAttach(card);
}

/**
 * Recalcula lo que dan los equipos y auras a sus criaturas (efectos estáticos,
 * regla 613). Un equipo cuya criatura ya no está se queda sin equipar (301.5c);
 * un aura sin criatura va al cementerio (704.5m).
 */
function refreshStatics(s) {
  const active = activePlayer(s)?.id;
  for (const p of s.players) for (const perm of p.battlefield) perm.bonus = null;
  const orphans = [];
  for (const p of s.players) {
    for (const perm of p.battlefield) {
      if (perm.attachedTo == null) continue;
      const f = findPerm(s, perm.attachedTo);
      if (!f || !f.perm.card.isCreature) {
        perm.attachedTo = null;
        if (attachOf(perm.card)?.aura) orphans.push([p, perm]);
        continue;
      }
      const att = attachOf(perm.card);
      const b = (f.perm.bonus ||= { p: 0, t: 0, kw: [], types: [], from: [], noUntap: false, cantAttack: false, cantBlock: false });
      b.from.push(perm.uid);
      for (const m of att?.mods || []) {
        if (m.myTurn && active !== p.id) continue;
        b.p += m.p; b.t += m.t;
        if (m.noUntap) b.noUntap = true;
        if (m.cantAttack) b.cantAttack = true;
        if (m.cantBlock) b.cantBlock = true;
        for (const k of m.kw) if (!b.kw.includes(k)) b.kw.push(k);
        for (const t of m.types) if (!b.types.includes(t)) b.types.push(t);
      }
    }
  }
  // Señores y efectos globales («Las criaturas que controlas obtienen +1/+1»…)
  const B = (perm) => (perm.bonus ||= { p: 0, t: 0, kw: [], types: [], from: [], noUntap: false, cantAttack: false, cantBlock: false });
  for (const p of s.players) {
    for (const src of p.battlefield) {
      for (const st of staticsOf(src.card)) {
        if (st.kind === 'anthem') {
          const pool = st.who === 'mine' ? p.battlefield : st.who === 'opp' ? s.players.filter((o) => o.id !== p.id).flatMap((o) => o.battlefield) : s.players.flatMap((o) => o.battlefield);
          for (const c of pool) {
            if (!c.card.isCreature || (st.other && c.uid === src.uid)) continue;
            if (st.sub && !st.sub.split(' ').every((w) => new RegExp('\\b' + w + '\\b').test(c.card.typeLine) || (c.bonus && c.bonus.types.includes(w))) && !keywordsOf(c.card).includes('changeling')) continue;
            if (st.adj) {
              const col = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' }[st.adj];
              const ok = col ? c.card.colors.includes(col) : st.adj === 'artifact' ? /Artifact/.test(c.card.typeLine) : st.adj === 'nontoken' ? !c.card.isToken : st.adj === 'token' ? !!c.card.isToken
                : st.adj === 'tapped' ? c.tapped : st.adj === 'attacking' ? s.combat.attackers[c.uid] != null : st.adj === 'legendary' ? c.card.isLegendary
                  : st.adj === 'multicolored' ? c.card.colors.length > 1 : st.adj === 'colorless' ? !c.card.colors.length : true;
              if (!ok) continue;
            }
            if (st.withKw && !has(c, st.withKw)) continue;
            if (st.chosenType && (!src.chosen || !(new RegExp('\\b' + src.chosen + '\\b').test(c.card.typeLine) || keywordsOf(c.card).includes('changeling')))) continue;
            const b = B(c);
            b.p += st.p; b.t += st.t;
            for (const k of st.kw) if (!b.kw.includes(k)) b.kw.push(k);
          }
        } else if (st.kind === 'varPT' || st.kind === 'forEach') {
          const n = countFor(s, p, st.what, src) * (st.k || 1);
          const b = B(src);
          if (st.kind === 'forEach') { b.p += st.p * n; b.t += st.t * n; }
          else { if (st.which !== 't') b.p += n; if (st.which !== 'p') b.t += n; }
        } else if (st.kind === 'selfBuff' && (!st.myTurn || active === p.id)) {
          const b = B(src);
          b.p += st.p; b.t += st.t;
          for (const k of st.kw) if (!b.kw.includes(k)) b.kw.push(k);
        } else if (st.kind === 'levelUp' && src.level) {
          const lv = levelsOf(src.card).filter((x) => src.level >= x.min && src.level <= x.max).pop();
          if (lv) {
            const b = B(src);
            if (lv.p != null) { b.p += lv.p - (src.card.power || 0); b.t += lv.t - (src.card.toughness || 0); }
            for (const k of lv.kw) if (!b.kw.includes(k)) b.kw.push(k);
          }
        } else if (st.kind === 'menaceLike') {
          const b = B(src);
          if (!b.kw.includes('menace')) b.kw.push('menace');
        }
      }
    }
  }
  for (const [p, perm] of orphans) leaveBattlefield(s, p, perm, 'graveyard', 'se queda sin criatura encantada');
}
const isPlaneswalker = (perm) => /Planeswalker/.test(perm.card.typeLine);
const firstStriker = (perm) => has(perm, 'first strike') || has(perm, 'double strike');

const COLOR_WORDS = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

/** Colores (o 'everything') de los que tiene protección. Regla 702.16. */
export function protections(perm) {
  const out = new Set();
  for (const m of (perm.card.oracle || '').matchAll(/[Pp]rotection from ([a-z, ]+?)(?:\.|\n|$|\()/g)) {
    for (const w of m[1].split(/,| and | or /)) {
      const k = w.trim().replace(/^and /, '');
      if (COLOR_WORDS[k]) out.add(COLOR_WORDS[k]);
      else if (k === 'everything') out.add('everything');
      else if (k === 'creatures') out.add('creatures');
    }
  }
  return out;
}
/** ¿Lo protege su protección de algo con estos colores? */
export function protectedFrom(perm, colors = [], isCreature = false) {
  const pr = protections(perm);
  if (!pr.size) return false;
  if (pr.has('everything')) return true;
  if (isCreature && pr.has('creatures')) return true;
  return colors.some((c) => pr.has(c));
}
const unblockable = (perm) => /can[’']t be blocked(?! except| by)/i.test(perm.card.oracle || '');

/** Jugador defensor de un objetivo de ataque (un jugador o 'pw:uid'). */
export function defenderOf(s, target) {
  if (typeof target === 'string' && target.startsWith('pw:')) return findPerm(s, +target.slice(3))?.owner.id || null;
  return target;
}

/** ¿Le impide algo enderezarse en su paso de enderezar? */
export function noUntap(perm) {
  if (perm.bonus && perm.bonus.noUntap) return true;
  const o = (perm.card.oracle || '').split(perm.card.name).join('CARDNAME');
  return /^(?:CARDNAME|This [a-z]+) doesn['’]t untap during your untap step\.?$/im.test(o);
}

export function canAttack(s, perm) {
  if (!perm.card.isCreature || perm.tapped) return false;
  if (perm.bonus && perm.bonus.cantAttack) return false;
  if (perm.eot && perm.eot.noAttack) return false;
  if (staticsOf(perm.card).some((x) => x.kind === 'noAttackSelf')) return false;
  const only = staticsOf(perm.card).find((x) => x.kind === 'attackOnlyIf');
  if (only && !opponents(s, perm.ownerId).some((o) => o.battlefield.some((x) => new RegExp('\\b' + only.land + '\\b').test(x.card.typeLine)))) return false;
  if ((has(perm, 'defender') && !(perm.eot && perm.eot.canAttackDefender)) || (/can.t attack/i.test(perm.card.oracle) && !/can.t attack (unless|alone)/i.test(perm.card.oracle) && !(perm.eot && perm.eot.canAttackDefender))) return false;
  if (perm.sick && !has(perm, 'haste')) return false;
  return true;
}

export function canBlock(perm, attacker, s = null) {
  if (!perm.card.isCreature || perm.tapped) return false;
  if (perm.bonus && perm.bonus.cantBlock) return false;
  if (perm.eot && perm.eot.noBlock) return false;
  if (attacker.eot && attacker.eot.unblockable) return false;
  const st = staticsOf(perm.card);
  if (st.some((x) => x.kind === 'noBlockSelf' || (x.kind === 'noAttackSelf' && x.noBlock))) return false;
  const ast = staticsOf(attacker.card);
  if (ast.some((x) => x.kind === 'unblockableSelf')) return false;
  if (st.some((x) => x.kind === 'blockOnlyFlyers') && !has(attacker, 'flying')) return false;
  if (ast.some((x) => x.kind === 'evadePower' && power(perm) >= x.min)) return false;
  if (ast.some((x) => x.kind === 'evadeSmaller') && power(perm) < power(attacker)) return false;
  const evT = ast.find((x) => x.kind === 'evadeType');
  if (evT) {
    const w = evT.what;
    const c = perm.card;
    if ((w === 'artifact creatures' && /Artifact/.test(c.typeLine)) || (w === 'creatures with flying' && has(perm, 'flying')) || (w === 'Walls' && /\bWall\b/.test(c.typeLine))) return false;
    const col = { 'black creatures': 'B', 'white creatures': 'W', 'red creatures': 'R', 'green creatures': 'G', 'blue creatures': 'U' }[w];
    if (col && c.colors.includes(col)) return false;
  }
  // evasión por palabra clave
  const ak = keywordsOf(attacker.card);
  const bk = keywordsOf(perm.card);
  const isArt = /Artifact/.test(perm.card.typeLine);
  if ((has(attacker, 'fear') || ak.includes('fear')) && !isArt && !perm.card.colors.includes('B')) return false;
  if ((has(attacker, 'intimidate') || ak.includes('intimidate')) && !isArt && !perm.card.colors.some((c) => attacker.card.colors.includes(c))) return false;
  if (ak.includes('shadow') !== bk.includes('shadow')) return false;
  if (ak.includes('horsemanship') && !bk.includes('horsemanship')) return false;
  if (ak.includes('skulk') && power(perm) > power(attacker)) return false;
  if (s) {
    const blockerOwner = s.players.find((p) => p.battlefield.includes(perm));
    for (const k of ak) {
      const m = k.match(/^(plains|island|swamp|mountain|forest|land)walk$/);
      if (m && blockerOwner && blockerOwner.battlefield.some((x) => x.card.isLand && (m[1] === 'land' || new RegExp('\\b' + m[1] + '\\b', 'i').test(x.card.typeLine)))) return false;
    }
  }
  if (/can.t block/i.test(perm.card.oracle)) return false;
  if (has(attacker, 'flying') && !has(perm, 'flying') && !has(perm, 'reach')) return false;
  if (unblockable(attacker)) return false;
  if (protectedFrom(attacker, perm.card.colors, true)) return false;
  return true;
}

/**
 * ¿Cumple este permanente la descripción del objetivo (filtro de parseTargetPhrase)?
 * Sin filtro: una criatura.
 */
export function permMatches(s, f, perm, ownerId, casterId) {
  const c = perm.card;
  if (!f) return !!c.isCreature;
  const tl = c.typeLine || '';
  const isType = (w) => w === 'permanent' || (w === 'token' ? !!c.isToken : new RegExp('\\b' + w + '\\b', 'i').test(tl));
  if (!f.types.some(isType)) return false;
  if (f.sub && !new RegExp('\\b' + f.sub + '\\b').test(tl)) return false;
  for (const n of f.non) {
    if (COLOR_WORDS[n]) { if ((c.colors || []).includes(COLOR_WORDS[n])) return false; }
    else if (isType(n)) return false;
  }
  if (f.opp && ownerId === casterId) return false;
  if (f.you && ownerId !== casterId) return false;
  if (f.tapped && !perm.tapped) return false;
  if (f.untapped && perm.tapped) return false;
  if (f.combat && s && s.combat.attackers[perm.uid] == null && !Object.values(s.combat.blocks).some((l) => l.includes(perm.uid))) return false;
  if (f.mvMax != null && (c.cmc || 0) > f.mvMax) return false;
  if (f.powMin != null && power(perm) < f.powMin) return false;
  if (f.powMax != null && power(perm) > f.powMax) return false;
  return true;
}

/** Cuántas tierras puede jugar este turno (1 + adicionales de hechizos y permanentes). */
export function landLimit(pl) {
  let n = 1 + (pl.extraLands || 0);
  for (const perm of pl.battlefield) {
    const m = (perm.card.oracle || '').match(/You may play (an|two|three) additional lands? on each of your turns/i);
    if (m) n += { an: 1, two: 2, three: 3 }[m[1].toLowerCase()];
  }
  return n;
}

/** Número del próximo turno de este jugador (para «hasta el final de tu próximo turno»). */
export function nextOwnTurn(s, pid) {
  let i = s.active;
  let t = s.turn;
  for (let k = 0; k < s.players.length * 2; k++) {
    do i = (i + 1) % s.players.length;
    while (s.players[i].eliminated && s.players.some((p) => !p.eliminated));
    t += 1;
    if (s.players[i].id === pid) return t;
  }
  return s.turn + 1;
}

/** Reducción de coste del hechizo según sus objetivos («cuesta {2} menos si hace objetivo a…»). */
export function costReduction(s, card, targets, casterId) {
  const red = card.effects && card.effects.reduce;
  if (!red) return 0;
  for (const t of targets || []) {
    if (t.uid == null) continue;
    const f = findPerm(s, t.uid);
    if (f && permMatches(s, red.filter, f.perm, f.owner.id, casterId)) return red.n;
  }
  return 0;
}

/** ¿Puede `caster` hacer objetivo a este permanente? (antimaleficio, velo) */
export function canTarget(s, casterId, perm, owner, source = null) {
  if (has(perm, 'shroud')) return false;
  if (has(perm, 'hexproof') && owner.id !== casterId) return false;
  if (source && protectedFrom(perm, source.colors || [], source.isCreature)) return false;
  return true;
}

function pushEvent(s, kind, text, extra = {}) {
  s.eventSeq += 1;
  s.events.push({ id: s.eventSeq, kind, text, ...extra });
  if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
  if (kind !== 'illegal') {
    s.log.push(text);
    if (s.log.length > 250) s.log.shift();
  }
}

function illegal(s, to, text, action) {
  pushEvent(s, 'illegal', text, { to, action });
  return s;
}

function drawCard(s, pl) {
  const c = pl.library.shift();
  if (c) pl.hand.push(c);
  return c;
}

function setCommander(s, pl, card) {
  pl.commander = { ...card, uid: s.nextId++ };
  pl.commanderInZone = true;
}

function makePerm(s, card, ownerId) {
  return {
    uid: card.uid || s.nextId++,
    card: stripCard(card),
    ownerId,
    tapped: false,
    sick: true,
    damage: 0,
    counters: 0,
    loyalty: card.loyalty != null ? parseInt(card.loyalty, 10) || 0 : null,
    pump: { p: 0, t: 0 },
    isCommander: false,
    attachedTo: null,
  };
}

function stripCard(c) {
  const { uid, ...rest } = c;
  return rest;
}

// ------------------------------------------------------------------ maná

/** Colores que produce un permanente (incluido «el color elegido»). */
export function producesOf(p) {
  if (p.chosen && 'WUBRG'.includes(p.chosen) && /the chosen color/i.test(p.card.oracle || '')) return [...new Set([p.chosen, ...p.card.produces.filter((c) => c !== 'C' || /\{C\}/.test(p.card.oracle))])];
  return p.card.produces;
}

/** Fuentes de maná enderezadas de un jugador. */
export function manaSources(pl) {
  return pl.battlefield.filter(
    (p) => !p.tapped && producesOf(p).length > 0 && (p.card.isLand || !p.card.isCreature || !p.sick),
  );
}

/** Maná disponible por color (para mostrarlo como en los juegos digitales). */
export function manaAvailable(pl) {
  const out = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, any: 0, total: 0, pool: (pl.manaPool || []).length };
  const all = [...manaSources(pl).map((p) => p.card.produces), ...(pl.manaPool || [])];
  for (const c of all) {
    out.total++;
    if (c.length >= 5) out.any++;
    else if (c.length === 1) out[c[0]]++;
    else out[c[0]]++; // tierras duales: se cuentan por su primer color
  }
  return out;
}

/**
 * Intenta pagar un coste girando fuentes. Devuelve la lista de uids a girar
 * o null si no alcanza. Cada fuente produce 1 maná.
 */
export function planPayment(pl, cost, extraGeneric = 0, extra = []) {
  // Primero el maná que ya está en la reserva (tierras giradas a mano); luego
  // tierras enderezadas, y las criaturas de maná en último lugar.
  const base = manaSources(pl);
  const sources = [
    ...(pl.manaPool || []).map((colors, i) => ({ uid: 'pool:' + i, colors, w: -10 + colors.length })),
    ...base.map((p) => ({ uid: p.uid, colors: producesOf(p), w: (p.card.isCreature ? 10 : 0) + producesOf(p).length })),
    // convocar / improvisar: criaturas o artefactos enderezados que pagan girándose
    ...extra.filter((p) => !base.includes(p)).map((p) => ({ uid: p.uid, colors: p.convokeColors || [], w: 30 })),
  ];
  const byCost = (a, b) => a.w - b.w;
  const used = new Set();
  let generic = extraGeneric;
  const colored = [];
  for (const p of pips(cost)) {
    if (/^\d+$/.test(p)) generic += parseInt(p, 10);
    else if (p === 'X') continue;
    else colored.push(p.split('/').filter((c) => 'WUBRGC'.includes(c)));
  }
  colored.sort((a, b) => a.length - b.length);
  for (const opts of colored) {
    if (opts.length === 0) { generic += 1; continue; }
    const cand = sources.filter((src) => !used.has(src.uid) && src.colors.some((c) => opts.includes(c))).sort(byCost)[0];
    if (!cand) return null;
    used.add(cand.uid);
  }
  const rest = sources.filter((src) => !used.has(src.uid));
  if (rest.length < generic) return null;
  rest.sort(byCost);
  for (let i = 0; i < generic; i++) used.add(rest[i].uid);
  return [...used];
}

function tapForPayment(pl, uids) {
  for (const p of pl.battlefield) if (uids.includes(p.uid)) p.tapped = true;
  // Tesoros y similares: se sacrifican al usar su maná
  pl.battlefield = pl.battlefield.filter((p) => !(p.card.sacOnMana && uids.includes(p.uid)));
  const used = uids.filter((u) => typeof u === 'string' && u.startsWith('pool:')).map((u) => +u.slice(5));
  if (used.length) pl.manaPool = pl.manaPool.filter((_, i) => !used.includes(i));
}

const isMain = (s) => s.step === 'main1' || s.step === 'main2';
const speedOK = (card) => card.isInstant || card.keywords.includes('flash');

// ----------------------------------------------------------------- pila

/** ¿Quién tiene que decidir ahora? (para la UI y los bots) */
export function waitingOn(s) {
  const top = stackTop(s);
  if (top) return top.waiting[0] || null;
  if (s.step === 'block') {
    const pend = pendingDefenders(s);
    if (pend.length) return pend[0];
    const ready = combatReadyPending(s);
    if (ready.length) return ready[0];
  }
  return activePlayer(s).id;
}

/** Jugadores (humanos) que aún no han dicho "seguimos" tras los bloqueos. */
export function combatReadyPending(s) {
  if (s.step !== 'block' || pendingDefenders(s).length) return [];
  const defenders = [...new Set(Object.values(s.combat.attackers).map((t) => defenderOf(s, t)).filter(Boolean))];
  return defenders.filter((id) => !s.combat.ready.includes(id) && !player(s, id).eliminated && !player(s, id).isBot);
}

/** Orden de prioridad empezando por el jugador siguiente a `fromId`. */
function othersInOrder(s, fromId) {
  const n = s.players.length;
  const start = s.players.findIndex((p) => p.id === fromId);
  const out = [];
  for (let k = 1; k < n; k++) {
    const p = s.players[(start + k) % n];
    if (!p.eliminated) out.push(p.id);
  }
  return out;
}

function pushStack(s, item) {
  item.id = s.nextId++;
  item.waiting = othersInOrder(s, item.by); // cada rival puede responder o pasar
  s.stack.push(item);
}

/** Resuelve todo lo que ya no espera respuestas (la cima de la pila primero). */
function resolveReady(s) {
  while (s.stack.length && stackTop(s).waiting.length === 0 && !s.winner) {
    const item = s.stack.pop();
    resolveItem(s, item);
    // Lo que queda debajo ya tuvo su ronda de respuestas (quien quiso respondió
    // y por eso está encima): se resuelve a continuación.
    const next = stackTop(s);
    if (next) next.waiting = [];
  }
  if (!s.stack.length) autoAdvance(s);
}

function resolveItem(s, item) {
  const pl = player(s, item.by);
  const card = item.card;
  const name = displayName(card);
  // aviso de lo que hay que aplicar a mano (sólo humanos)
  if (!pl.isBot && !card.faceDown) {
    try {
      const parts = manualParts(card);
      if (parts.length) pushEvent(s, 'manualParts', `${name}: esto no se aplica solo, hazlo a mano`, { to: pl.id, parts, card: stripCard(card) });
    } catch { /* */ }
  }
  // ¿Siguen siendo legales sus objetivos? (regla 608.2b)
  const fx = effectFx(card);
  const needed = fx.filter(needsTarget);
  const legal = (item.targets || []).filter((t) => targetStillLegal(s, item.by, t));
  if (!card.isPermanent && needed.length && item.targets?.length && legal.length === 0) {
    pl.graveyard.push(stripCard(card));
    pushEvent(s, 'fizzle', `${name} se contrarresta al resolverse: su objetivo ya no es legal.`, { by: pl.id });
    return;
  }
  if (card.isPermanent) {
    const perm = makePerm(s, card, pl.id);
    if (item.commander) perm.isCommander = true;
    pl.battlefield.push(perm);
    pushEvent(s, 'play', `${name} entra al campo de batalla.`, { uid: perm.uid, by: pl.id, color: card.colors[0] || card.produces[0] || 'C' });
    const aura = attachOf(card)?.aura && (item.targets || []).find((t) => t.uid != null && t.attach);
    if (aura) {
      const tf = findPerm(s, aura.uid);
      if (tf && tf.perm.card.isCreature) {
        perm.attachedTo = tf.perm.uid;
        if (staticsOf(card).some((x) => x.kind === 'controlHost') && tf.owner.id !== pl.id) {
          tf.owner.battlefield = tf.owner.battlefield.filter((x) => x !== tf.perm);
          tf.perm.ownerId = pl.id;
          pl.battlefield.push(tf.perm);
          pushEvent(s, 'play', `${pl.name} toma el control de ${displayName(tf.perm.card)}.`, { uid: tf.perm.uid, by: pl.id });
        }
        pushEvent(s, 'pump', `${name} encanta a ${displayName(tf.perm.card)}${describeAttach(attachOf(card)) ? ': ' + describeAttach(attachOf(card)) : ''}.`, { uid: tf.perm.uid });
      }
    }
    applyEntersStatics(s, pl, perm);
    refreshStatics(s);
    stateBased(s);
    if (card.faceDown) { perm.faceDown = true; perm.hidden = card.hidden; perm.morphCost = card.morphCost; perm.morphKind = card.morphKind; perm.card = stripCard(card); }
    if (fx.length && !card.faceDown) resolveEffects(s, pl, card, fx, (item.targets || []).filter((t) => !t.attach), perm);
    if (findPerm(s, perm.uid)) fireEnterTriggers(s, pl, perm);
    if (card.evoked && findPerm(s, perm.uid)) leaveBattlefield(s, pl, perm, 'graveyard', 'se sacrifica (evocada)');
    if ((card.dashed || card.fromGraveyard === 'unearth') && findPerm(s, perm.uid)) {
      perm.eot = { ...(perm.eot || {}), kw: ['haste'] };
      (s.delayed ||= []).push({ at: 'end', from: s.turn, pid: pl.id, kind: card.dashed ? 'hand' : 'sac', uid: perm.uid, exile: true });
    }
  } else {
    pushEvent(s, 'resolve', `${name} se resuelve.`, { by: pl.id, card: stripCard(card), color: card.colors[0] || 'C' });
    if (fx.length) resolveEffects(s, pl, card, fx, item.targets || [], null);
    // Tormenta: una copia por cada hechizo lanzado antes este turno
    for (let i = 0; i < (card.stormCopies || 0) && fx.length && !s.winner; i++) {
      pushEvent(s, 'info', `Tormenta: copia ${i + 1} de ${name}.`);
      resolveEffects(s, pl, card, fx, fx.some(needsTarget) ? autoTargets(s, pl, fx.filter(needsTarget), null) : [], null);
    }
    if (card.rebound && !card.fromGraveyard) {
      card.exileOnResolve = true;
      (s.delayed ||= []).push({ at: 'upkeep', from: s.turn, pid: pl.id, kind: 'rebound', card: stripCard(card) });
      pushEvent(s, 'info', `${name} se exilia (rebote): se volverá a lanzar gratis en tu próximo mantenimiento.`, { to: pl.id });
    }
    if (card.adventureOf) {
      // Aventura (regla 715.4): se exilia y luego se puede lanzar la criatura desde el exilio.
      pl.exile.push({ ...stripCard(card.adventureOf), onAdventure: true });
      pushEvent(s, 'info', `${displayName(card.adventureOf)} se va de aventura: queda exiliada y más adelante puedes lanzar la criatura desde el exilio (pon la carta en el círculo y elige la criatura).`, { to: pl.id });
    } else if (card.exileOnResolve) { pl.exile.push(stripCard(card)); if (card.fromGraveyard === 'flashback') pushEvent(s, 'info', `${name} se exilia (retrospectiva).`); }
    else if (card.buyback) { if (pl.isBot) pl.hand.push({ ...stripCard(card), uid: s.nextId++ }); else { pl.handCount += 1; pushEvent(s, 'info', `${name} vuelve a tu mano (readquirir).`, { to: pl.id }); } }
    else pl.graveyard.push(stripCard(card));
  }
}

function targetStillLegal(s, casterId, t) {
  if (t.player) return !player(s, t.player)?.eliminated;
  if (t.stack) return s.stack.some((x) => x.id === t.stack);
  const f = findPerm(s, t.uid);
  return !!f && canTarget(s, casterId, f.perm, f.owner);
}

// --------------------------------------------------------------- acciones

export function apply(state, action) {
  if (state.winner && action.t !== 'reset') return state;
  const s = clone(state);
  const by = player(s, action.by);
  if (!by && action.by !== undefined) return state;
  const fn = HANDLERS[action.t];
  if (!fn) return state;
  const out = fn(s, action, by) || s;
  if (!out.winner && activePlayer(out).eliminated) passTurn(out);
  refreshStatics(out);
  if (out.players.some((p) => p.battlefield.some((x) => x.bonus))) stateBased(out);
  return out;
}

const HANDLERS = {
  /** Jugar una carta (física registrada, o de la mano del bot si trae handUid). */
  play(s, a, pl) {
    let card = a.card;
    let fromHand = -1;
    if (a.handUid) {
      fromHand = pl.hand.findIndex((c) => c.uid === a.handUid);
      if (fromHand < 0) return s;
      card = pl.hand[fromHand];
    }
    if (!card) return s;
    if (a.modes) card = { ...card, chosenModes: a.modes.slice(0, 3) };
    if (a.kicked) card = { ...card, kicked: true };
    // jugar una carta exiliada que se puede jugar («puedes jugar esa carta…»)
    let exIdx = -1;
    if (card.fromExile) {
      exIdx = pl.exile.findIndex((c) => c.playable && c.id === card.id);
      if (exIdx < 0) return illegal(s, pl.id, `${displayName(card)} ya no se puede jugar desde el exilio (se acabó el plazo).`, a);
      if (pl.exile[exIdx].playable.cast && card.isLand) return illegal(s, pl.id, 'Esa carta sólo se puede lanzar: una tierra exiliada así no se puede jugar.', a);
      card = { ...card };
      delete card.playable;
      delete card.fromExile;
    }
    const myTurn = activePlayer(s).id === pl.id;
    const stackEmpty = s.stack.length === 0;

    if (!a.force) {
      if (card.isLand) {
        if (!myTurn || !isMain(s) || !stackEmpty) return illegal(s, pl.id, 'Las tierras sólo se juegan en tu propio turno, en una fase principal y con la pila vacía.', a);
        const lim = landLimit(pl);
        if (pl.landsPlayed >= lim) return illegal(s, pl.id, lim === 1
          ? 'Sólo puedes jugar UNA tierra por turno (también cuenta una tierra jugada desde el exilio u otra zona, regla 305.2).'
          : `Ya has jugado ${pl.landsPlayed} tierras este turno: es tu máximo (${lim}).`, a);
      } else if (!speedOK(card) && (!myTurn || !isMain(s) || !stackEmpty)) {
        return illegal(s, pl.id,
          `${displayName(card)} es ${card.isSorcery ? 'un conjuro' : 'un permanente'}: sólo se lanza en tu turno, en una fase principal y con la pila vacía. Sólo los instantáneos (o cartas con destello) se pueden lanzar en cualquier momento, también en respuesta.`,
          a);
      }
      // ¿el objetivo es del tipo que pide la carta? (p. ej. «que no sea tierra»)
      const wanted = targetsFor(card);
      for (const [i, t] of (a.targets || []).entries()) {
        const w = wanted[i];
        if (t.uid == null || !w || !(w.target === 'creature' || w.target === 'permanent')) continue;
        const f = findPerm(s, t.uid);
        if (f && !permMatches(s, w.filter, f.perm, f.owner.id, pl.id)) return illegal(s, pl.id, `${displayName(f.perm.card)} no vale como objetivo: ${displayName(card)} ${describeEffect(w)}.`, a);
      }
      // antimaleficio / velo
      for (const t of a.targets || []) {
        if (t.uid == null) continue;
        const f = findPerm(s, t.uid);
        if (f && !canTarget(s, pl.id, f.perm, f.owner, card)) {
          const why = has(f.perm, 'shroud') ? 'velo' : has(f.perm, 'hexproof') && f.owner.id !== pl.id ? 'antimaleficio' : 'protección contra ese color';
          return illegal(s, pl.id, `${displayName(f.perm.card)} tiene ${why}: no puedes hacerla objetivo con ${displayName(card)}.`, a);
        }
      }
    }
    // Coste: normal, alternativo (evocar, retrospectiva, boca abajo…) y adicionales (estímulo, resguardo…)
    const alts = card.isLand ? {} : altCosts(card);
    let cost = card.manaCost;
    if (a.alt && ['evoke', 'flashback', 'dash', 'escape', 'unearth'].includes(a.alt) && alts[a.alt]) cost = alts[a.alt];
    if (a.alt && ['morph', 'megamorph', 'disguise'].includes(a.alt) && alts[a.alt]) cost = '{3}';
    if (card.kicked && alts.kicker) cost += alts.kicker;
    if (a.buyback && alts.buyback) cost += alts.buyback;
    if (a.entwine && alts.entwine) { cost += alts.entwine; card = { ...card, chosenModes: (card.effects?.modes || []).map((_, i) => i) }; }
    // costes adicionales: sacrificar / descartar / pagar vidas
    const addSac = staticsOf(card).find((x) => x.kind === 'addSac');
    if (addSac && !a.force) {
      const f = a.sacUid != null ? findPerm(s, a.sacUid) : null;
      if (!f || f.owner.id !== pl.id || !permMatches(s, addSac.filter, f.perm, pl.id, pl.id)) return illegal(s, pl.id, `Para lanzar ${displayName(card)} tienes que sacrificar ${targetEs(addSac.filter)} como coste adicional.`, a);
    }
    let discount = card.isLand ? 0 : costReduction(s, card, a.targets, pl.id);
    // coste X: el jugador elige X al lanzar
    const xv = /\{X\}/.test(cost) ? Math.max(0, +(a.x ?? card.xValue ?? 0) || 0) : null;
    if (xv != null) { discount -= xv * ((cost.match(/\{X\}/g) || []).length); card = { ...card, xValue: xv }; }
    // reductores («Los hechizos de instantáneo y conjuro que lanzas cuestan {1} menos»…)
    for (const x of pl.battlefield) for (const st of staticsOf(x.card)) {
      if (st.kind !== 'costReducer') continue;
      const w = st.what;
      const fits = w === 'any' || (w === 'instant and sorcery' && (card.isInstant || card.isSorcery)) || (w === 'noncreature' && !card.isCreature) || (w !== 'noncreature' && new RegExp('\\b' + w + '\\b', 'i').test(card.typeLine));
      if (fits) discount += st.n;
    }
    for (const st of staticsOf(card)) if (st.kind === 'selfReduce') discount += st.n * countFor(s, pl, st.what);
    let wardLife = 0;
    for (const t of a.targets || []) {
      const f = t.uid != null ? findPerm(s, t.uid) : null;
      if (!f || f.owner.id === pl.id) continue;
      const w = altCosts(f.perm.card).ward || (f.perm.faceDown && f.perm.wardFaceDown ? { mana: '{2}' } : null);
      if (w && w.mana) cost += w.mana;
      if (w && w.life) wardLife += w.life;
    }
    if (alts.affinity) discount += pl.battlefield.filter((x) => new RegExp('\\b' + alts.affinity + '\\b', 'i').test(x.card.typeLine)).length;
    let delved = 0;
    if (alts.delve && !card.isLand) {
      const generic = pips(cost).filter((x) => /^\d+$/.test(x)).reduce((acc, x) => acc + +x, 0) - discount;
      delved = Math.max(0, Math.min(generic, pl.graveyard.length));
      discount += delved;
    }
    const extraSrc = alts.convoke ? pl.battlefield.filter((x) => x.card.isCreature && !x.tapped).map((x) => Object.assign(x, { convokeColors: x.card.colors }))
      : alts.improvise ? pl.battlefield.filter((x) => /Artifact/.test(x.card.typeLine) && !x.tapped).map((x) => Object.assign(x, { convokeColors: [] })) : [];
    if (!card.isLand) {
      const plan = planPayment(pl, cost, -discount, extraSrc);
      for (const x of extraSrc) delete x.convokeColors;
      if (plan) {
        tapForPayment(pl, plan);
        if (delved) { const gone = pl.graveyard.splice(0, delved); pl.exile.push(...gone); pushEvent(s, 'info', `Delve: exilias ${delved} carta${delved > 1 ? 's' : ''} de tu cementerio para pagar.`, { to: pl.id }); }
        if (wardLife) { pl.life -= wardLife; pushEvent(s, 'life', `${pl.name} paga ${wardLife} vidas por el resguardo (${pl.life}).`, { target: pl.id, delta: -wardLife }); }
        if (addSac && a.sacUid != null) { const f = findPerm(s, a.sacUid); if (f) leaveBattlefield(s, pl, f.perm, 'graveyard', 'se sacrifica (coste adicional)'); }
        const addDis = staticsOf(card).find((x) => x.kind === 'addDiscard');
        if (addDis) { if (pl.isBot) botDiscard(s, pl, addDis.amount); else { pl.handCount = Math.max(0, pl.handCount - addDis.amount); pushEvent(s, 'manual', `Coste adicional: descarta ${addDis.amount === 1 ? 'una carta' : addDis.amount + ' cartas'}.`, { to: pl.id }); } }
        const addLife = staticsOf(card).find((x) => x.kind === 'addLife');
        if (addLife) { pl.life -= addLife.amount; pushEvent(s, 'life', `${pl.name} paga ${addLife.amount} vidas (coste adicional) (${pl.life}).`, { target: pl.id, delta: -addLife.amount }); }
      }
      else if (!a.force) {
        const m = manaAvailable(pl);
        return illegal(s, pl.id, `No te llega el maná para ${displayName(card)}: cuesta ${card.manaCost || '0'} (${card.cmc - discount} en total${discount ? `, ya con ${discount} menos por su objetivo` : ''}) y tienes ${m.total} disponible${m.total === 1 ? '' : 's'} (${m.pool} en la reserva + ${m.total - m.pool} en tierras sin girar)${m.total >= card.cmc ? ', pero no del color necesario' : ''}. Recuerda: la app gira tus tierras sola al pagar; si las giras tú a mano, su maná va a tu reserva hasta que cambie la fase.`, a);
      }
    }
    if (a.alt === 'flashback' || a.alt === 'escape' || a.alt === 'unearth') {
      const gi = pl.graveyard.findIndex((c) => c.name === card.name);
      if (gi < 0 && !a.force) return illegal(s, pl.id, `${displayName(card)} no está en tu cementerio.`, a);
      if (gi >= 0) pl.graveyard.splice(gi, 1);
      if (fromHand >= 0) fromHand = -1;
      card = { ...card, fromGraveyard: a.alt, exileOnResolve: a.alt === 'flashback' };
    } else if (fromHand >= 0) pl.hand.splice(fromHand, 1);
    else if (exIdx >= 0) pl.exile.splice(exIdx, 1);
    else if (card.fromAdventure) {
      // lanzada desde el exilio tras su aventura: sale del exilio (no de la mano)
      const i = pl.exile.findIndex((c) => c.onAdventure && c.id === card.id);
      if (i >= 0) pl.exile.splice(i, 1);
    } else if (!pl.isBot && !a.fromCommand && pl.handCount > 0) pl.handCount -= 1;
    if (a.alt === 'evoke') card = { ...card, evoked: true };
    if (a.alt === 'dash') card = { ...card, dashed: true };
    if (a.buyback) card = { ...card, buyback: true };
    if (['morph', 'megamorph', 'disguise'].includes(a.alt)) card = faceDownCard(card, a.alt, alts[a.alt]);

    // Las tierras no usan la pila (regla 305.1).
    if (card.isLand) {
      pl.landsPlayed += 1;
      const perm = makePerm(s, card, pl.id);
      pl.battlefield.push(perm);
      pushEvent(s, 'play', `${pl.name} juega ${displayName(card)}.`, { uid: perm.uid, by: pl.id, color: card.produces[0] || 'C' });
      applyEntersStatics(s, pl, perm);
      fireEnterTriggers(s, pl, perm);
      stateBased(s);
      return s;
    }
    const kwsCast = keywordsOf(card);
    if (kwsCast.includes('storm')) card = { ...card, stormCopies: s.spellsCast && s.spellsCast.turn === s.turn ? s.spellsCast.n : 0 };
    if (kwsCast.includes('rebound') && fromHand >= 0 || (kwsCast.includes('rebound') && !pl.isBot && !card.fromGraveyard && exIdx < 0)) card = { ...card, rebound: true };
    pushStack(s, { by: pl.id, card: stripCard(card), targets: a.targets || [] });
    castTriggers(s, pl, card);
    if (discount) pushEvent(s, 'info', `${displayName(card)} cuesta ${discount} menos por su objetivo.`, { to: pl.id });
    pushEvent(s, 'cast', `${pl.name} lanza ${displayName(card)}.`, { by: pl.id, card: stripCard(card), targets: a.targets || [], color: card.colors[0] || 'C', stackId: stackTop(s).id });
    resolveReady(s);
    return s;
  },

  /** Pasar la prioridad / no responder a lo que hay en la cima de la pila. */
  pass(s, a, pl) {
    const top = stackTop(s);
    if (!top) return s;
    top.waiting = top.waiting.filter((id) => id !== pl.id);
    resolveReady(s);
  },

  setCommander(s, a, pl) {
    setCommander(s, pl, a.card);
    pushEvent(s, 'info', `${pl.name} elige como comandante a ${displayName(a.card)}.`);
  },

  castCommander(s, a, pl) {
    if (!pl.commander || !pl.commanderInZone) return s;
    const myTurn = activePlayer(s).id === pl.id;
    if (!a.force && (!myTurn || !isMain(s) || s.stack.length)) return illegal(s, pl.id, 'El comandante se lanza en tu turno, en una fase principal y con la pila vacía.', a);
    const plan = planPayment(pl, pl.commander.manaCost, pl.commanderTax);
    if (plan) tapForPayment(pl, plan);
    else if (!a.force) return illegal(s, pl.id, `No tienes maná suficiente. Tu comandante cuesta ${pl.commander.manaCost}${pl.commanderTax ? ` + ${pl.commanderTax} de impuesto` : ''}.`, a);
    pl.commanderInZone = false;
    pl.commanderTax += 2;
    pushStack(s, { by: pl.id, card: stripCard(pl.commander), targets: a.targets || [], commander: true });
    pushEvent(s, 'cast', `${pl.name} lanza a su comandante ${displayName(pl.commander)} desde la zona de mando.`, { by: pl.id, card: stripCard(pl.commander), color: pl.commander.colors[0] || 'C', stackId: stackTop(s).id });
    resolveReady(s);
  },

  /** Girar/enderezar a mano. Girar una tierra (o fuente de maná) añade su maná a la reserva. */
  tap(s, a, pl) {
    const f = findPerm(s, a.uid);
    if (!f) return s;
    const perm = f.perm;
    const nowTapped = a.value ?? !perm.tapped;
    const source = perm.card.produces.length > 0 && (perm.card.isLand || !perm.card.isCreature || !perm.sick);
    if (source && f.owner.id === (pl?.id ?? f.owner.id)) {
      const pool = (f.owner.manaPool ||= []);
      if (nowTapped && !perm.tapped) {
        pool.push([...perm.card.produces]);
        pushEvent(s, 'mana', `${f.owner.name} gira ${displayName(perm.card)}: +1 maná ${perm.card.produces.map((c) => '{' + c + '}').join('/')} en su reserva.`, { by: f.owner.id, uid: perm.uid });
      } else if (!nowTapped && perm.tapped) {
        // deshacer: quita ese maná de la reserva si sigue ahí
        const i = pool.findIndex((c) => c.join() === perm.card.produces.join());
        if (i >= 0) pool.splice(i, 1);
      }
    }
    perm.tapped = nowTapped;
  },

  /**
   * Activar una habilidad de un permanente («{2}, {T}: …», lealtad «+1: …»).
   * a.idx: índice en activatedOf(card). a.targets: objetivos elegidos.
   */
  activate(s, a, pl) {
    const f = findPerm(s, a.uid);
    if (!f || f.owner.id !== pl.id) return s;
    const perm = f.perm;
    const ab = activatedOf(perm.card)[a.idx];
    if (!ab) return s;
    const c = ab.cost;
    const myTurn = activePlayer(s).id === pl.id;
    const name = displayName(perm.card);
    if (!a.force) {
      if (ab.sorcery && (!myTurn || !isMain(s) || s.stack.length)) return illegal(s, pl.id, `Esa habilidad de ${name} sólo se activa como un conjuro: en tu turno, en una fase principal y con la pila vacía.`, a);
      if (c.loyalty != null) {
        if (perm.loyaltyUsed === s.turn) return illegal(s, pl.id, `Sólo puedes activar UNA habilidad de lealtad de ${name} por turno.`, a);
        if (typeof c.loyalty === 'number' && c.loyalty < 0 && (perm.loyalty || 0) < -c.loyalty) return illegal(s, pl.id, `${name} no tiene lealtad suficiente (${perm.loyalty}).`, a);
      } else if (ab.once && (perm.used || {})[a.idx] === s.turn) return illegal(s, pl.id, `Esa habilidad de ${name} sólo se activa una vez por turno.`, a);
      if (ab.exhaust && (perm.exhausted || {})[a.idx]) return illegal(s, pl.id, `Esa habilidad de ${name} (agotar) sólo se puede activar una vez.`, a);
      if (c.tap && perm.tapped) return illegal(s, pl.id, `${name} ya está girada.`, a);
      if (c.untap && !perm.tapped) return illegal(s, pl.id, `${name} tiene que estar girada para esa habilidad.`, a);
      if (c.tap && perm.card.isCreature && perm.sick && !has(perm, 'haste')) return illegal(s, pl.id, `${name} acaba de entrar (mareo de invocación): no puede usar habilidades con {T} hasta tu próximo turno.`, a);
      if (c.removeCounters && perm.counters < c.removeCounters) return illegal(s, pl.id, `${name} no tiene contadores suficientes.`, a);
      if (c.life && pl.life < c.life) return illegal(s, pl.id, 'No tienes vidas suficientes para pagar.', a);
      if (c.energy && (pl.energy || 0) < c.energy) return illegal(s, pl.id, `Te falta energía: necesitas ${c.energy} y tienes ${pl.energy || 0}.`, a);
      if (c.mana) {
        const plan = planPayment(pl, c.mana, /\{X\}/.test(c.mana) ? Math.max(0, +a.x || 0) : 0);
        if (!plan) { const m = manaAvailable(pl); return illegal(s, pl.id, `No te llega el maná: la habilidad cuesta ${c.mana} y tienes ${m.total} disponible${m.total === 1 ? '' : 's'}.`, a); }
        tapForPayment(pl, plan);
      }
    }
    // pagar el resto del coste
    if (c.tap) perm.tapped = true;
    if (c.untap) perm.tapped = false;
    if (c.life) { pl.life -= c.life; pushEvent(s, 'life', `${pl.name} paga ${c.life} vidas (${pl.life}).`, { target: pl.id, delta: -c.life }); }
    if (c.removeCounters) perm.counters -= c.removeCounters;
    if (c.energy) pl.energy = (pl.energy || 0) - c.energy;
    if (c.discard) { if (pl.isBot) botDiscard(s, pl, c.discard); else { pl.handCount = Math.max(0, pl.handCount - c.discard); pushEvent(s, 'manual', `Descarta ${c.discard === 1 ? 'una carta' : c.discard + ' cartas'} para pagar la habilidad.`, { to: pl.id }); } }
    if (c.loyalty != null) { perm.loyaltyUsed = s.turn; if (typeof c.loyalty === 'number') perm.loyalty = (perm.loyalty || 0) + c.loyalty; }
    perm.used = { ...(perm.used || {}), [a.idx]: s.turn };
    if (ab.exhaust) perm.exhausted = { ...(perm.exhausted || {}), [a.idx]: true };
    if (c.sacSelf) leaveBattlefield(s, pl, perm, 'graveyard', 'se sacrifica');
    pushEvent(s, 'activate', `${pl.name} activa ${name}: ${ab.fx.map(describeEffect).filter(Boolean).join(', ') || 'su habilidad'}.`, { by: pl.id, uid: perm.uid, color: perm.card.colors[0] || 'C' });
    resolveEffects(s, pl, /\{X\}/.test(c.mana || '') ? { ...perm.card, xValue: Math.max(0, +a.x || 0) } : perm.card, ab.fx, a.targets || [], perm);
    stateBased(s);
  },

  /** Ciclo: paga el coste, descarta la carta y roba otra (o busca una tierra con ciclo de tierras). */
  cycle(s, a, pl) {
    const card = a.card;
    const alts = altCosts(card);
    const tc = a.type && alts.typecycling;
    const cost = tc ? alts.typecycling.cost : alts.cycling;
    if (!cost) return illegal(s, pl.id, `${displayName(card)} no tiene ciclo.`, a);
    const plan = planPayment(pl, cost);
    if (!plan) return illegal(s, pl.id, `No te llega el maná para ciclar ${displayName(card)} (${cost}).`, a);
    tapForPayment(pl, plan);
    pl.graveyard.push(stripCard(card));
    if (pl.isBot) { const i = pl.hand.findIndex((c) => c.uid === a.handUid); if (i >= 0) pl.hand.splice(i, 1); drawCard(s, pl); }
    pushEvent(s, 'draw', tc ? `${pl.name} cicla ${displayName(card)}: busca en tu biblioteca una carta de ${alts.typecycling.what.toLowerCase()}, ponla en tu mano y baraja.`
      : `${pl.name} cicla ${displayName(card)}: descártala y roba una carta.`, { to: pl.id, amount: 1 });
    fireTriggers(s, 'discard', { player: pl });
  },

  /** Poner boca arriba una criatura boca abajo (transfigurar / disfraz). */
  unmorph(s, a, pl) {
    const f = findPerm(s, a.uid);
    if (!f || f.owner.id !== pl.id || !f.perm.faceDown) return s;
    const perm = f.perm;
    if (!a.force) {
      const plan = planPayment(pl, perm.morphCost || '');
      if (!plan) return illegal(s, pl.id, `No te llega el maná para ponerla boca arriba (${perm.morphCost}).`, a);
      tapForPayment(pl, plan);
    }
    perm.card = stripCard(perm.hidden);
    perm.faceDown = false;
    if (perm.morphKind === 'megamorph') perm.counters += 1;
    pushEvent(s, 'play', `${pl.name} pone boca arriba ${displayName(perm.card)}.`, { uid: perm.uid, by: pl.id, color: perm.card.colors[0] || 'C' });
    fireTriggers(s, 'turnedFaceUp', { perm });
    refreshStatics(s);
    stateBased(s);
  },

  /** Subir de nivel (como un conjuro). */
  levelUp(s, a, pl) {
    const f = findPerm(s, a.uid);
    if (!f || f.owner.id !== pl.id) return s;
    const st = staticsOf(f.perm.card).find((x) => x.kind === 'levelUp');
    if (!st) return s;
    if (activePlayer(s).id !== pl.id || !isMain(s) || s.stack.length) return illegal(s, pl.id, 'Subir de nivel es como un conjuro: en tu turno, en una fase principal y con la pila vacía.', a);
    const plan = planPayment(pl, st.cost);
    if (!plan) return illegal(s, pl.id, `No te llega el maná para subir de nivel (${st.cost}).`, a);
    tapForPayment(pl, plan);
    f.perm.level = (f.perm.level || 0) + 1;
    pushEvent(s, 'pump', `${displayName(f.perm.card)} sube al nivel ${f.perm.level}.`, { uid: f.perm.uid });
    refreshStatics(s);
  },

  /** Tripular N: gira criaturas con fuerza total N o más; el vehículo es criatura hasta el final del turno. */
  crew(s, a, pl) {
    const f = findPerm(s, a.uid);
    if (!f || f.owner.id !== pl.id) return s;
    const kw = keywordsOf(f.perm.card).map((k) => k.match(/^crew (\d+)/)).find(Boolean);
    if (!kw) return s;
    const need = +kw[1];
    const crew = pl.battlefield.filter((x) => x.card.isCreature && !x.tapped && x.uid !== f.perm.uid).sort((x, y) => power(x) - power(y));
    const picked = [];
    let total = 0;
    // primero intenta con una sola criatura que llegue; si no, suma de menor a mayor
    const one = crew.find((x) => power(x) >= need);
    if (one) { picked.push(one); total = power(one); } else for (const x of crew) { if (total >= need) break; picked.push(x); total += power(x); }
    if (total < need) return illegal(s, pl.id, `Para tripular ${displayName(f.perm.card)} necesitas criaturas enderezadas con fuerza total ${need} o más.`, a);
    for (const x of picked) x.tapped = true;
    f.perm.card.isCreature = true;
    f.perm.crewed = true;
    f.perm.sick = f.perm.sick && false;
    pushEvent(s, 'pump', `${pl.name} tripula ${displayName(f.perm.card)} con ${picked.map((x) => displayName(x.card)).join(', ')}: es una criatura hasta el final del turno.`, { uid: f.perm.uid });
  },

  /** Objetivos de una habilidad disparada de un humano. */
  resolveTrigger(s, a, pl) {
    const list = pl.pendingTriggers || [];
    const i = list.findIndex((x) => x.id === a.id);
    if (i < 0) return s;
    const [tr] = list.splice(i, 1);
    const src = findPerm(s, tr.uid)?.perm || { uid: tr.uid, card: tr.card, ownerId: pl.id, counters: 0, pump: { p: 0, t: 0 } };
    if (!a.skip) resolveEffects(s, pl, tr.card, tr.fx, a.targets || [], src);
  },

  /** Sacrificar (cuando un efecto obliga a un humano a sacrificar algo). */
  sacrifice(s, a, pl) {
    const list = pl.pendingSacrifice || [];
    if (!list.length) return s;
    const f = findPerm(s, a.uid);
    if (!f || f.owner.id !== pl.id) return s;
    if (!permMatches(s, list[0].filter, f.perm, pl.id, null)) return illegal(s, pl.id, `Tienes que sacrificar ${targetEs(list[0].filter)}.`, a);
    list.shift();
    leaveBattlefield(s, pl, f.perm, 'graveyard', 'es sacrificada');
  },

  /** Respuesta a una pregunta del motor (p. ej. pagar 2 vidas por una tierra «shock»). */
  choice(s, a, pl) {
    const list = pl.pendingChoices || [];
    const i = list.findIndex((x) => x.uid === a.uid && x.type === a.type);
    if (i < 0) return s;
    const [ch] = list.splice(i, 1);
    if (ch.type === 'mayPay') {
      const src = findPerm(s, ch.uid)?.perm || null;
      const paid = !!a.yes && (ch.life ? pl.life > ch.life : !!planPayment(pl, ch.cost || ''));
      if (paid) payCost(s, pl, ch);
      const rest = ch.rest.filter((x) => (x.ifPaid ? paid : x.ifNotPaid ? !paid : true));
      const card = { ...ch.card, _paid: paid };
      if (rest.some(needsTarget) && !(ch.targets || []).length) pl.pendingTriggers = [...(pl.pendingTriggers || []), { id: s.eventSeq + 1, uid: ch.uid, card, fx: rest }];
      else resolveEffects(s, pl, card, rest, ch.targets || [], src);
      return s;
    }
    if (ch.type === 'chooseOnEnter') {
      const f = findPerm(s, ch.uid);
      if (f) { f.perm.chosen = a.value; pushEvent(s, 'info', `${ch.name}: eliges ${a.value}.`, { uid: ch.uid }); refreshStatics(s); }
      return s;
    }
    if (ch.type === 'upkeep') {
      const f = findPerm(s, ch.uid);
      if (!f) return s;
      const plan = a.yes ? planPayment(pl, ch.cost) : null;
      if (plan) { tapForPayment(pl, plan); pushEvent(s, 'info', `${pl.name} paga ${ch.cost} por ${ch.name}.`); }
      else leaveBattlefield(s, pl, f.perm, 'graveyard', a.yes ? 'se sacrifica (no te llega el maná)' : 'se sacrifica');
    }
    if (ch.type === 'shock') {
      const f = findPerm(s, ch.uid);
      if (f && a.yes) { pl.life -= 2; f.perm.tapped = false; pushEvent(s, 'life', `${pl.name} paga 2 vidas: ${ch.name} entra enderezada (${pl.life}).`, { target: pl.id, delta: -2 }); }
    }
  },

  /** Carta escaneada que un efecto pone en el campo de batalla (buscar una tierra, reanimar…). */
  scanPut(s, a, pl) {
    const list = pl.pendingScan || [];
    if (a.cancel) { pl.pendingScan = []; return s; }
    const p = list.shift();
    if (!p || !a.card) return s;
    const card = stripCard(a.card);
    if (p.fromGrave) { const k = pl.graveyard.findIndex((c) => c.name === card.name); if (k >= 0) pl.graveyard.splice(k, 1); }
    else if (pl.handCount > 0 && p.fromHand) pl.handCount -= 1;
    enterPerm(s, pl, card, { tapped: p.tapped, from: `(${p.src})` });
    stateBased(s);
  },

  /** La carta de arriba de la biblioteca (escaneada) va al exilio y se puede jugar un tiempo. */
  exileTop(s, a, pl) {
    const pend = pl.pendingExile || [];
    if (a.cancel) { pl.pendingExile = []; return s; }
    const p = pend.shift();
    if (!p || !a.card) return s;
    const card = { ...stripCard(a.card), playable: { until: p.until, cast: p.cast } };
    delete card.fromExile;
    pl.exile.push(card);
    pushEvent(s, 'info', `${displayName(card)} queda exiliada por ${p.src}: puedes ${p.cast ? 'lanzarla' : 'jugarla'} desde el exilio ${p.until === s.turn ? 'este turno' : 'hasta el final de tu próximo turno'} (toca la casilla de Exilio).`, { to: pl.id });
  },

  /** Equipar (regla 702.6): coste de equipar, a una criatura tuya, a velocidad de conjuro. */
  equip(s, a, pl) {
    const f = findPerm(s, a.uid);
    if (!f || f.owner.id !== pl.id) return s;
    const eq = f.perm;
    const att = attachOf(eq.card);
    if (a.target == null) {
      if (eq.attachedTo == null) return s;
      eq.attachedTo = null;
      pushEvent(s, 'info', `${displayName(eq.card)} se queda sin equipar.`, { uid: eq.uid });
      return s;
    }
    const tf = findPerm(s, a.target);
    if (!tf || !tf.perm.card.isCreature) return illegal(s, pl.id, 'Sólo se puede equipar a una criatura.', a);
    if (!a.force) {
      if (tf.owner.id !== pl.id) return illegal(s, pl.id, 'Sólo puedes equipar a una criatura que controles.', a);
      if (activePlayer(s).id !== pl.id || !isMain(s) || s.stack.length) return illegal(s, pl.id, 'Equipar es como un conjuro: sólo en tu turno, en una fase principal y con la pila vacía.', a);
      if (eq.attachedTo === tf.perm.uid) return illegal(s, pl.id, `${displayName(eq.card)} ya está equipado a ${displayName(tf.perm.card)}.`, a);
      const cost = att?.equip || '';
      if (att?.equipLife) {
        pl.life -= att.equipLife;
        pushEvent(s, 'life', `${pl.name} paga ${att.equipLife} vidas para equipar (${pl.life}).`, { target: pl.id, delta: -att.equipLife });
      } else if (att?.equipNote) pushEvent(s, 'manual', `Coste de equipar: ${att.equipNote}. Págalo a mano.`, { to: pl.id });
      if (cost) {
        const plan = planPayment(pl, cost);
        if (!plan) {
          const m = manaAvailable(pl);
          return illegal(s, pl.id, `No te llega el maná para equipar: cuesta ${cost} y tienes ${m.total} disponible${m.total === 1 ? '' : 's'}.`, a);
        }
        tapForPayment(pl, plan);
      }
    }
    eq.attachedTo = tf.perm.uid;
    const what = describeAttach(att);
    pushEvent(s, 'pump', `${pl.name} equipa ${displayName(eq.card)} a ${displayName(tf.perm.card)}${what ? ' (' + what + ')' : ''}.`, { uid: tf.perm.uid, by: pl.id });
  },

  move(s, a) {
    const f = findPerm(s, a.uid);
    if (!f) return s;
    leaveBattlefield(s, f.owner, f.perm, a.to);
  },

  life(s, a) {
    const t = player(s, a.target);
    if (!t) return s;
    t.life += a.delta;
    pushEvent(s, 'life', `${t.name} ${a.delta >= 0 ? 'gana' : 'pierde'} ${Math.abs(a.delta)} vida${Math.abs(a.delta) === 1 ? '' : 's'} (${t.life}).`, { target: t.id, delta: a.delta });
    stateBased(s);
  },

  /** Ajustar a mano cuántas cartas tienes en la mano (física). */
  hand(s, a, pl) {
    const t = player(s, a.target || pl.id);
    if (!t || t.isBot) return s;
    t.handCount = Math.max(0, a.set != null ? a.set : (t.handCount || 0) + (a.delta || 0));
  },

  poison(s, a) {
    const t = player(s, a.target);
    if (!t) return s;
    t.poison = Math.max(0, t.poison + a.delta);
    stateBased(s);
  },

  cmdDamage(s, a) {
    const t = player(s, a.target);
    if (!t) return s;
    t.cmdDamage[a.from] = Math.max(0, (t.cmdDamage[a.from] || 0) + a.delta);
    stateBased(s);
  },

  counter(s, a) {
    const f = findPerm(s, a.uid);
    if (!f) return s;
    f.perm.counters += a.delta;
    stateBased(s);
  },

  loyalty(s, a) {
    const f = findPerm(s, a.uid);
    if (!f || f.perm.loyalty == null) return s;
    f.perm.loyalty += a.delta;
    pushEvent(s, 'pump', `${displayName(f.perm.card)} ${a.delta >= 0 ? 'gana' : 'pierde'} ${Math.abs(a.delta)} de lealtad (${f.perm.loyalty}).`, { uid: f.perm.uid });
    stateBased(s);
  },

  pump(s, a) {
    const f = findPerm(s, a.uid);
    if (!f) return s;
    f.perm.pump.p += a.p;
    f.perm.pump.t += a.t;
    pushEvent(s, 'pump', `${displayName(f.perm.card)} recibe ${fmt(a.p)}/${fmt(a.t)} hasta el final del turno.`, { uid: f.perm.uid });
    stateBased(s);
  },

  damage(s, a) {
    const f = findPerm(s, a.uid);
    if (!f) return s;
    dealDamageToPerm(s, f.perm, a.amount, null);
    pushEvent(s, 'hit', `${displayName(f.perm.card)} recibe ${a.amount} de daño.`, { uid: f.perm.uid });
    stateBased(s);
  },

  draw(s, a, pl) {
    drawCard(s, pl);
  },

  attack(s, a, pl) {
    if (s.step !== 'attack' || activePlayer(s).id !== pl.id || s.stack.length) return s;
    const f = findPerm(s, a.uid);
    if (!f || f.owner.id !== pl.id) return s;
    if (s.combat.attackers[a.uid]) {
      delete s.combat.attackers[a.uid];
      return s;
    }
    if (!canAttack(s, f.perm)) {
      const why = f.perm.tapped ? 'está girada' : f.perm.sick ? 'acaba de entrar y está mareada (necesita prisa para atacar este turno)' : 'no puede atacar (defensor)';
      return illegal(s, pl.id, `${displayName(f.perm.card)} no puede atacar: ${why}.`);
    }
    let target = opponents(s, pl.id)[0]?.id;
    if (typeof a.target === 'string' && a.target.startsWith('pw:')) {
      const pw = findPerm(s, +a.target.slice(3));
      if (pw && pw.owner.id !== pl.id && isPlaneswalker(pw.perm)) target = a.target;
    } else if (a.target && player(s, a.target) && !player(s, a.target).eliminated && a.target !== pl.id) target = a.target;
    s.combat.attackers[a.uid] = target;
  },

  /** Atacar con todas las criaturas que pueden (botón "Todos al ataque"). */
  attackAll(s, a, pl) {
    if (s.step !== 'attack' || activePlayer(s).id !== pl.id) return s;
    const target = a.target || opponents(s, pl.id)[0]?.id;
    for (const perm of pl.battlefield) if (canAttack(s, perm) && !s.combat.attackers[perm.uid]) s.combat.attackers[perm.uid] = target;
  },

  block(s, a, pl) {
    if (s.step !== 'block') return s;
    const bf = findPerm(s, a.uid);
    if (!bf || bf.owner.id !== pl.id) return s;
    if (s.combat.confirmed.includes(pl.id)) return s;
    for (const k of Object.keys(s.combat.blocks)) {
      s.combat.blocks[k] = s.combat.blocks[k].filter((u) => u !== a.uid);
      if (!s.combat.blocks[k].length) delete s.combat.blocks[k];
    }
    if (a.attacker == null) return s;
    const af = findPerm(s, a.attacker);
    if (!af || defenderOf(s, s.combat.attackers[a.attacker]) !== pl.id) return s;
    if (!canBlock(bf.perm, af.perm, s)) {
      const why = bf.perm.tapped ? 'está girada' : has(af.perm, 'flying') ? 'el atacante tiene vuela (sólo lo bloquean criaturas con vuela o alcance)' : 'no puede bloquear';
      return illegal(s, pl.id, `${displayName(bf.perm.card)} no puede bloquear: ${why}.`);
    }
    (s.combat.blocks[a.attacker] ||= []).push(a.uid);
  },

  confirmBlocks(s, a, pl) {
    if (s.step !== 'block' || s.combat.confirmed.includes(pl.id)) return s;
    // Amenaza: necesita dos o más bloqueadores (regla 702.110).
    for (const [att, target] of Object.entries(s.combat.attackers)) {
      if (defenderOf(s, target) !== pl.id) continue;
      const f = findPerm(s, +att);
      const n = (s.combat.blocks[att] || []).length;
      if (f && has(f.perm, 'menace') && n === 1) {
        return illegal(s, pl.id, `${displayName(f.perm.card)} tiene amenaza: sólo puede ser bloqueada por dos o más criaturas.`);
      }
    }
    s.combat.confirmed.push(pl.id);
    if (pl.isBot) s.combat.ready.push(pl.id);
    const n = Object.values(s.combat.blocks).flat().length;
    pushEvent(s, 'blocks', n ? `${pl.name} bloquea con ${n} criatura${n > 1 ? 's' : ''}.` : `${pl.name} no bloquea.`, { by: pl.id });
  },

  /** "Seguimos": tras los bloqueos, no quiero (más) trucos de combate. */
  ready(s, a, pl) {
    if (s.step !== 'block') return s;
    if (!s.combat.ready.includes(pl.id)) s.combat.ready.push(pl.id);
  },

  next(s, a, pl) {
    if (activePlayer(s).id !== pl.id && !a.force) return s;
    if (s.stack.length) return illegal(s, pl.id, 'Hay hechizos en la pila: primero tienen que resolverse (o esperar a que los rivales respondan).');
    advance(s);
  },

  concede(s, a, pl) {
    eliminate(s, pl, 'se rinde');
  },

  /** Cambiar la imagen (edición) de una carta en juego. */
  setImage(s, a) {
    const f = findPerm(s, a.uid);
    if (f && typeof a.image === 'string' && /^https:\/\/cards\.scryfall\.io\//.test(a.image)) f.perm.card.image = a.image;
  },

  /** Mensaje rápido entre jugadores. */
  emote(s, a, pl) {
    const text = String(a.text || '').slice(0, 40);
    if (!text) return s;
    s.eventSeq += 1;
    s.events.push({ id: s.eventSeq, kind: 'emote', text, by: pl.id });
    if (s.events.length > MAX_EVENTS) s.events.shift();
  },
};

export function pendingDefenders(s) {
  const defenders = [...new Set(Object.values(s.combat.attackers).map((t) => defenderOf(s, t)).filter(Boolean))];
  return defenders.filter((id) => !s.combat.confirmed.includes(id) && !player(s, id).eliminated);
}

// ----------------------------------------------------------------- fases

function advance(s) {
  const step = s.step;
  if (step === 'main1') {
    // Sin criaturas que puedan atacar, el combate se salta.
    const any = activePlayer(s).battlefield.some((p) => canAttack(s, p));
    return enterStep(s, any ? 'begincombat' : 'main2');
  }
  if (step === 'attack') {
    if (Object.keys(s.combat.attackers).length === 0) return enterStep(s, 'endcombat');
    for (const uid of Object.keys(s.combat.attackers)) {
      const f = findPerm(s, +uid);
      if (f && !has(f.perm, 'vigilance')) f.perm.tapped = true;
    }
    const n = Object.keys(s.combat.attackers).length;
    pushEvent(s, 'attack', `${activePlayer(s).name} ataca con ${n} criatura${n > 1 ? 's' : ''}.`, { uids: Object.keys(s.combat.attackers).map(Number), targets: { ...s.combat.attackers } });
    attackTriggers(s);
    return enterStep(s, 'block');
  }
  if (step === 'block') {
    if (pendingDefenders(s).length) return s;
    const anyFirst = Object.keys(s.combat.attackers).some((u) => { const f = findPerm(s, +u); return f && firstStriker(f.perm); })
      || Object.values(s.combat.blocks).flat().some((u) => { const f = findPerm(s, u); return f && firstStriker(f.perm); });
    blockTriggers(s);
    return enterStep(s, anyFirst ? 'firststrike' : 'damage');
  }
  if (step === 'cleanup') return passTurn(s);
  enterStep(s, STEPS[STEPS.indexOf(step) + 1]);
}

/** Las etapas automáticas avanzan solas cuando la pila está vacía. */
function autoAdvance(s) {
  let guard = 0;
  while (!s.winner && AUTO.has(s.step) && s.stack.length === 0 && guard++ < 20) advance(s);
}

function passTurn(s) {
  cleanup(s);
  if (s.winner) return;
  let i = s.active;
  const extra = (s.extraTurns || []).shift();
  const ei = extra != null ? s.players.findIndex((p) => p.id === extra && !p.eliminated) : -1;
  if (ei >= 0) { i = ei; pushEvent(s, 'info', `${s.players[i].name} juega un turno extra.`); }
  else {
    do i = (i + 1) % s.players.length;
    while (s.players[i].eliminated);
  }
  s.active = i;
  s.turn += 1;
  pushEvent(s, 'turn', `Turno ${s.turn}: le toca a ${s.players[i].name}.`, { player: s.players[i].id });
  enterStep(s, 'untap');
}

function cleanup(s) {
  const pl = activePlayer(s);
  // Descartar hasta 7 (los humanos lo hacen con sus cartas físicas).
  if (pl.isBot) {
    while (pl.hand.length > MAX_HAND) {
      const worst = [...pl.hand].sort((a, b) => (a.isLand ? -1 : 0) - (b.isLand ? -1 : 0) || a.cmc - b.cmc)[0];
      pl.hand.splice(pl.hand.indexOf(worst), 1);
      pl.graveyard.push(stripCard(worst));
      pushEvent(s, 'info', `${pl.name} descarta ${displayName(worst)} (máximo 7 cartas en mano).`);
    }
  }
  // se acaba el plazo para jugar cartas exiliadas («hasta el final de tu (próximo) turno»)
  for (const p of s.players) {
    for (const c of p.exile) if (c.playable && c.playable.until <= s.turn) delete c.playable;
    if (p.pendingExile) p.pendingExile = p.pendingExile.filter((x) => x.until > s.turn);
  }
  for (const p of s.players) {
    for (const perm of p.battlefield) {
      perm.damage = 0;
      perm.deathtouched = false;
      perm.pump = { p: 0, t: 0 };
      perm.eot = null;
      perm.regen = false;
      perm.prevent = 0;
      if (perm.crewed) { perm.crewed = false; perm.card.isCreature = false; }
    }
  }
  for (const p of s.players) p.prevent = 0;
  s.fog = false;
  // vuelve el control de lo que se tomó «hasta el final del turno»
  for (const p of s.players) {
    for (const perm of [...p.battlefield]) {
      if (perm.returnTo == null) continue;
      const back = player(s, perm.returnTo);
      p.battlefield = p.battlefield.filter((x) => x !== perm);
      perm.ownerId = perm.returnTo;
      delete perm.returnTo;
      if (back) back.battlefield.push(perm);
    }
  }
  s.combat = emptyCombat();
}

function enterStep(s, step) {
  s.step = step;
  refreshStatics(s);
  // El maná que no se usa se pierde al cambiar de paso (regla 500.4).
  for (const p of s.players) p.manaPool = [];
  const pl = activePlayer(s);
  if (step === 'untap') {
    for (const perm of pl.battlefield) {
      // «no se endereza durante el paso de enderezar» (aura o la propia carta)
      if (perm.tapped && (noUntap(perm) || perm.frozen)) pushEvent(s, 'info', `${displayName(perm.card)} no se endereza (su efecto se lo impide).`, { uid: perm.uid });
      else perm.tapped = false;
      perm.frozen = false;
      perm.sick = false;
    }
    pl.landsPlayed = 0;
    pl.extraLands = 0;
  } else if (step === 'draw') {
    // 103.8a: en partidas de dos jugadores, quien empieza no roba en su primer turno.
    // 103.8c: en el resto de multijugador, todos roban.
    const skip = pl.battlefield.some((x) => staticsOf(x.card).some((st) => st.kind === 'skipDraw'));
    if (skip) pushEvent(s, 'info', `${pl.name} se salta el paso de robar.`);
    else if (s.turn > 1 || s.players.length > 2) {
      if (pl.isBot && pl.library.length) drawCard(s, pl);
      else if (pl.isBot && !pl.library.length) eliminate(s, pl, 'tiene que robar y no le quedan cartas');
      if (!pl.isBot) { pl.handCount += 1; pushEvent(s, 'draw', 'Paso de robar: roba una carta de tu mazo.', { to: pl.id, amount: 1 }); }
    }
    fireTriggers(s, 'drawstep', { player: pl });
  } else if (step === 'upkeep') {
    runDelayed(s, 'upkeep');
    upkeepKeywords(s, pl);
    fireTriggers(s, 'upkeep', { player: pl });
    fireTriggers(s, 'oppUpkeep', { player: pl });
    fireTriggers(s, 'anyUpkeep', { player: pl });
  } else if (step === 'main1') {
    fireTriggers(s, 'main1', { player: pl });
  } else if (step === 'begincombat') {
    fireTriggers(s, 'begincombat', { player: pl });
    fireTriggers(s, 'anyCombat', { player: pl });
  } else if (step === 'main2') {
    fireTriggers(s, 'main2', { player: pl });
  } else if (step === 'end') {
    runDelayed(s, 'end');
    fireTriggers(s, 'endstep', { player: pl });
    fireTriggers(s, 'oppEndstep', { player: pl });
    fireTriggers(s, 'anyEndstep', { player: pl });
  } else if (step === 'block') {
    s.combat.confirmed = [];
    s.combat.ready = [];
  } else if (step === 'firststrike') {
    resolveCombat(s, 'first');
  } else if (step === 'damage') {
    resolveCombat(s, 'regular');
  } else if (step === 'endcombat') {
    if (s.combat.result) s.lastCombat = { turn: s.turn, result: s.combat.result };
    s.combat = emptyCombat();
  } else if (step === 'cleanup') {
    // Recordatorio sólo al principio (luego ya se sabe).
    if (!pl.isBot && s.turn <= 4) pushEvent(s, 'info', 'Limpieza: si tienes más de 7 cartas en la mano, descarta hasta quedarte con 7.', { to: pl.id });
  }
  autoAdvance(s);
  return s;
}

// ---------------------------------------------------------------- combate

function dealDamageToPerm(s, perm, amount, src, srcCard = null) {
  if (amount <= 0) return;
  if (perm.prevent) { const k = Math.min(perm.prevent, amount); perm.prevent -= k; amount -= k; if (amount <= 0) return; }
  const card = src ? src.card : srcCard;
  // Protección: se previene el daño de fuentes de ese color (regla 702.16e).
  if (card && protectedFrom(perm, card.colors || [], card.isCreature)) return;
  if (isPlaneswalker(perm) && !perm.card.isCreature) {
    perm.loyalty = (perm.loyalty || 0) - amount;
  } else if (src && (has(src, 'infect') || has(src, 'wither'))) {
    perm.counters -= amount; // infectar/marchitar: contadores -1/-1 (702.90, 702.80)
  } else {
    perm.damage += amount;
    if (src && has(src, 'deathtouch')) perm.deathtouched = true;
  }
  if (src && has(src, 'lifelink')) {
    const ctrl = player(s, src.ownerId);
    ctrl.life += amount;
  }
}

/** Daño de combate. phase: 'first' (dañar primero) o 'regular' (regla 510.4). */
function resolveCombat(s, phase) {
  if (s.fog) {
    if (phase !== 'first' || !s.combat.firstDone) pushEvent(s, 'info', 'Se previene todo el daño de combate de este turno.');
    if (phase === 'first') s.combat.firstDone = true;
    return;
  }
  const results = s.combat.result || [];
  const deals = (perm) => (phase === 'first' ? firstStriker(perm) : !has(perm, 'first strike') || has(perm, 'double strike') || !s.combat.firstDone);
  const lethalTo = (src, perm) => (has(src, 'deathtouch') ? 1 : Math.max(0, toughness(perm) - perm.damage));
  const dealt = [];
  const toPlayer = [];

  for (const [uidStr, targetId] of Object.entries(s.combat.attackers)) {
    const uid = +uidStr;
    const af = findPerm(s, uid);
    if (!af) continue;
    const att = af.perm;
    const blockers = (s.combat.blocks[uid] || []).map((b) => findPerm(s, b)).filter(Boolean).map((f) => f.perm);
    const wasBlocked = (s.combat.blocks[uid] || []).length > 0;
    // los bloqueadores golpean al atacante
    for (const b of blockers) if (deals(b) && power(b) > 0) dealt.push([att, power(b), b]);
    if (!deals(att)) continue;
    let pow = power(att);
    if (pow <= 0) continue;
    if (!wasBlocked) {
      toPlayer.push([targetId, pow, att]);
      results.push(`${displayName(att.card)} no es bloqueada y hace ${pow} de daño.`);
      continue;
    }
    if (!blockers.length) {
      // bloqueada, pero sus bloqueadores ya no están: sólo con arrollar pasa el daño
      if (has(att, 'trample')) toPlayer.push([targetId, pow, att]);
      continue;
    }
    for (const b of blockers) {
      const amt = Math.min(pow, lethalTo(att, b));
      if (amt > 0) dealt.push([b, amt, att]);
      pow -= amt;
    }
    if (pow > 0) {
      if (has(att, 'trample')) {
        toPlayer.push([targetId, pow, att]);
        results.push(`${displayName(att.card)} arrolla y hace ${pow} de daño al jugador.`);
      } else dealt.push([blockers[0], pow, att]);
    }
    results.push(`${displayName(att.card)} es bloqueada por ${blockers.map((b) => displayName(b.card)).join(' y ')}.`);
  }

  for (const [perm, amt, src] of dealt) dealDamageToPerm(s, perm, amt, src);
  const combatHits = [];
  for (const [target, amt, src] of toPlayer) {
    // Atacando a un planeswalker: el daño le quita lealtad.
    if (typeof target === 'string' && target.startsWith('pw:')) {
      const f = findPerm(s, +target.slice(3));
      if (f) {
        dealDamageToPerm(s, f.perm, amt, src);
        pushEvent(s, 'hit', `${displayName(src.card)} hace ${amt} de daño a ${displayName(f.perm.card)} (lealtad ${f.perm.loyalty}).`, { uid: f.perm.uid });
      }
      continue;
    }
    const t = player(s, target);
    if (!t || t.eliminated) continue;
    if (has(src, 'infect')) {
      t.poison += amt;
      pushEvent(s, 'life', `${t.name} recibe ${amt} contador${amt > 1 ? 'es' : ''} de veneno de ${displayName(src.card)} (${t.poison}/10).`, { target: t.id, delta: 0, uid: src.uid });
    } else {
      t.life -= amt;
      pushEvent(s, 'life', `${t.name} recibe ${amt} de daño de ${displayName(src.card)} (${t.life}).`, { target: t.id, delta: -amt, uid: src.uid });
    }
    if (src.isCommander) t.cmdDamage[src.ownerId] = (t.cmdDamage[src.ownerId] || 0) + amt;
    if (has(src, 'lifelink')) player(s, src.ownerId).life += amt;
    const tox = keywordsOf(src.card).map((k) => k.match(/^toxic (\d+)/)).find(Boolean);
    if (tox && amt > 0) { t.poison += +tox[1]; pushEvent(s, 'life', `${t.name} recibe ${tox[1]} contador${+tox[1] > 1 ? 'es' : ''} de veneno (tóxico) (${t.poison}/10).`, { target: t.id, delta: 0 }); }
    if (amt > 0) { combatHits.push([src, t]); t.damagedTurn = s.turn; }
    const ren = keywordsOf(src.card).map((k) => k.match(/^renown (\d+)/)).find(Boolean);
    if (ren && amt > 0 && !src.renowned) { src.renowned = true; src.counters += +ren[1]; pushEvent(s, 'pump', `${displayName(src.card)} gana renombre (+${ren[1]} contadores +1/+1).`, { uid: src.uid }); }
  }
  for (const [src, t] of combatHits) {
    fireTriggers(s, 'combatDamagePlayer', { perm: src, player: t });
    fireTriggers(s, 'creatureCombatDamageMine', { perm: src, player: t });
    fireTriggers(s, 'hostCombatDamagePlayer', { perm: src, player: t });
  }
  if (phase === 'first') s.combat.firstDone = true;
  s.combat.result = results;
  // Golpes para la animación: quién golpea a quién y cuánto.
  const hits = [
    ...dealt.map(([perm, amt, src]) => ({ src: src.uid, to: perm.uid, amt })),
    ...toPlayer.map(([target, amt, src]) => (typeof target === 'string' && target.startsWith('pw:')
      ? { src: src.uid, to: +target.slice(3), amt }
      : { src: src.uid, player: target, amt })),
  ];
  if (dealt.length || toPlayer.length) pushEvent(s, 'combat', (phase === 'first' ? 'Dañar primero: ' : '') + results.join(' '), { uids: Object.keys(s.combat.attackers).map(Number), hits });
  stateBased(s);
}

// ------------------------------------------------------------- efectos

/**
 * Aplica las habilidades de una carta. targets: [{ uid } | { player } | { stack }]
 * en el orden en que la carta los pide. Si falta un objetivo, avisa para hacerlo a mano.
 */
function resolveEffects(s, pl, card, fx, targets, source, info = null) {
  const name = displayName(card);
  const since = s.eventSeq;
  try {
    resolveEffectsInner(s, pl, card, fx, targets, name, source, info);
  } finally {
    // Los efectos llevan el color de la carta: la mesa dibuja el hechizo (rayo, fuego, agua…).
    const spell = { colors: card.colors.length ? card.colors.slice(0, 3) : ['C'], by: pl.id, src: source ? source.uid : null };
    for (const ev of s.events) if (ev.id > since && !ev.spell) ev.spell = spell;
  }
  stateBased(s);
}

function resolveEffectsInner(s, pl, card, fx, targets, name, source = null, info = null) {
  let ti = 0;
  const ctx = { chosen: null, that: info && info.player ? info.player : null, paid: card._paid ?? null, tokens: [] };
  for (let fi = 0; fi < fx.length; fi++) {
    let e = fx[fi];
    if (e.kicked && !card.kicked) continue;
    if (e.ifPaid && ctx.paid === false) continue;
    if (e.ifNotPaid && ctx.paid !== false) continue;
    if (e.kind === 'mayPay') {
      const rest = fx.slice(fi + 1);
      const can = e.life ? pl.life > e.life : !!planPayment(pl, e.cost || '');
      if (pl.isBot || !can) {
        ctx.paid = can && (pl.isBot ? rest.some((x) => x.ifPaid) : false);
        if (ctx.paid) payCost(s, pl, e);
        continue;
      }
      // humano: pregunta y sigue después
      pl.pendingChoices = [...(pl.pendingChoices || []), { type: 'mayPay', uid: source ? source.uid : -1, cost: e.cost, life: e.life, name, card: stripCard(card), rest, targets: targets.slice(ti) }];
      pushEvent(s, 'choice', `${name}: ¿pagas ${e.life ? e.life + ' vidas' : e.cost}?`, { to: pl.id });
      return;
    }
    if (s.winner) return;
    if (card.xValue != null) e = substX(e, card.xValue);
    let tgt = null;
    if (needsTarget(e)) {
      tgt = targets[ti++];
      if (!tgt || !targetStillLegal(s, pl.id, tgt)) {
        if (!pl.isBot && !tgt) pushEvent(s, 'manual', `${name} ${describeEffect(e)}: aplícalo a mano tocando el objetivo.`, { to: pl.id });
        continue;
      }
    }
    const perm = tgt && tgt.uid != null ? findPerm(s, tgt.uid) : null;
    const target = tgt && tgt.player ? player(s, tgt.player) : (e.target === 'that' ? ctx.that || opponents(s, pl.id)[0] : null);
    if (perm) ctx.last = perm;
    switch (e.kind) {
      case 'damage':
        if (e.target === 'opponents') {
          for (const o of opponents(s, pl.id)) hurtPlayer(s, o, e.amount, name);
        } else if (e.target === 'allPlayers') {
          for (const o of alivePlayers(s)) hurtPlayer(s, o, e.amount, name);
        } else if (e.target === 'self') {
          hurtPlayer(s, pl, e.amount, name);
        } else if (e.target === 'all') {
          for (const p2 of s.players) {
            for (const c of [...p2.battlefield]) {
              if (!c.card.isCreature && !(e.players && isPlaneswalker(c))) continue;
              if (e.opp && p2.id === pl.id) continue;
              if (e.other && source && c.uid === source.uid) continue;
              if (e.flying === true && !has(c, 'flying')) continue;
              if (e.flying === false && has(c, 'flying')) continue;
              if (e.combat === 'attacking' && s.combat.attackers[c.uid] == null) continue;
              dealDamageToPerm(s, c, e.amount, null, card);
            }
            if (e.players && !(e.opp && p2.id === pl.id) && !p2.eliminated) hurtPlayer(s, p2, e.amount, name);
          }
          pushEvent(s, 'hit', `${name} hace ${e.amount} de daño a ${e.opp ? 'cada criatura rival' : 'cada criatura'}${e.players ? ' y a cada jugador' : ''}.`, { by: pl.id });
        } else if (perm) {
          dealDamageToPerm(s, perm.perm, e.amount, null, card);
          pushEvent(s, 'hit', `${name} hace ${e.amount} de daño a ${displayName(perm.perm.card)}.`, { uid: perm.perm.uid });
        } else if (target) hurtPlayer(s, target, e.amount, name);
        break;
      case 'destroy':
        if (perm) {
          if (has(perm.perm, 'indestructible')) pushEvent(s, 'info', `${displayName(perm.perm.card)} es indestructible y no se destruye.`);
          else leaveBattlefield(s, perm.owner, perm.perm, 'graveyard', 'es destruida');
        }
        break;
      case 'pump': {
        const tp = e.self ? source : e.host ? hostOf(s, source) : perm && perm.perm;
        if (tp) pumpPerm(s, tp, e.p === 'X' ? 0 : e.p, e.t === 'X' ? 0 : e.t, e.kw || []);
        break;
      }
      case 'bounce':
        if (perm) leaveBattlefield(s, perm.owner, perm.perm, 'hand', 'vuelve a la mano');
        break;
      case 'exile':
        if (perm) {
          leaveBattlefield(s, perm.owner, perm.perm, 'exile', 'es exiliada');
          if (e.untilLeaves && source && findPerm(s, source.uid)) source.holding = [...(source.holding || []), { card: perm.perm.card, owner: perm.owner.id }];
        }
        break;
      case 'counter': {
        const tp = e.self ? source : e.host ? hostOf(s, source) : perm && perm.perm;
        const n = e.amount == null ? 1 : e.amount === 'X' ? 1 : e.amount;
        if (tp && findPerm(s, tp.uid)) {
          tp.counters += n;
          pushEvent(s, 'pump', `${displayName(tp.card)} recibe ${Math.abs(n)} contador${Math.abs(n) > 1 ? 'es' : ''} ${n > 0 ? '+1/+1' : '-1/-1'}.`, { uid: tp.uid });
        }
        break;
      }
      case 'counterspell': {
        const idx = s.stack.findIndex((x) => x.id === tgt.stack);
        if (idx >= 0 && e.unless) {
          // «salvo que su controlador pague {N}»: se paga solo si llega el maná
          const it = s.stack[idx];
          const ctl = player(s, it.by);
          const cost = e.unless === 'X' ? '{' + (card.xValue || 0) + '}' : e.unless;
          const plan = ctl && planPayment(ctl, cost);
          if (plan) { tapForPayment(ctl, plan); pushEvent(s, 'info', `${ctl.name} paga ${cost} y ${displayName(it.card)} no se contrarresta.`); break; }
        }
        if (idx >= 0) {
          const [it] = s.stack.splice(idx, 1);
          const owner = player(s, it.by);
          if (it.commander) owner.commanderInZone = true;
          else owner.graveyard.push(it.card);
          pushEvent(s, 'fizzle', `${name} contrarresta ${displayName(it.card)}.`, { by: pl.id });
        }
        break;
      }
      case 'drain':
        for (const o of (e.who && !/each opponent/.test(e.who) && target ? [target] : e.who && /^(target|that|defending)/.test(e.who) ? opponents(s, pl.id).slice(0, 1) : opponents(s, pl.id))) {
          o.life -= e.amount;
          pushEvent(s, 'life', `${o.name} pierde ${e.amount} vidas (${o.life}).`, { target: o.id, delta: -e.amount });
        }
        break;
      case 'gain':
        if (e.amount === 'X') { if (!pl.isBot) pushEvent(s, 'manual', `${name}: ganas X vidas (súmalas con el botón +).`, { to: pl.id }); break; }
        gainLife(s, pl, e.amount);
        break;
      case 'lose':
        pl.life -= e.amount;
        pushEvent(s, 'life', `${pl.name} pierde ${e.amount} vidas (${pl.life}).`, { target: pl.id, delta: -e.amount });
        break;
      case 'draw':
        if (pl.isBot) for (let i = 0; i < e.amount; i++) drawCard(s, pl);
        else pl.handCount += e.amount;
        pushEvent(s, 'draw', pl.isBot ? `${pl.name} roba ${e.amount} carta${e.amount > 1 ? 's' : ''}.` : `${name}: roba ${e.amount} carta${e.amount > 1 ? 's' : ''} de tu mazo.`, { to: pl.id, amount: e.amount });
        break;
      case 'token':
        for (let i = 0; i < e.amount; i++) {
          const perm2 = makePerm(s, tokenCard(e), pl.id);
          if (e.tapped) perm2.tapped = true;
          pl.battlefield.push(perm2);
          pushEvent(s, 'play', `${name} crea una ${perm2.card.printedName.toLowerCase()} ${e.power}/${e.toughness}.`, { uid: perm2.uid, by: pl.id, color: e.colors[0] || 'C', token: true });
          ctx.lastToken = perm2;
          ctx.tokens.push(perm2);
          fireEnterTriggers(s, pl, perm2);
        }
        break;
      case 'impulse': {
        const until = e.until === 'next' ? nextOwnTurn(s, pl.id) : s.turn;
        if (pl.isBot) {
          for (let i = 0; i < e.amount && pl.library.length; i++) {
            const c = pl.library.shift();
            pl.exile.push({ ...stripCard(c), playable: { until, cast: e.play === 'cast' } });
            pushEvent(s, 'info', `${pl.name} exilia ${displayName(c)} de su biblioteca y puede ${e.play === 'cast' ? 'lanzarla' : 'jugarla'}.`);
          }
        } else {
          pl.pendingExile = pl.pendingExile || [];
          for (let i = 0; i < e.amount; i++) pl.pendingExile.push({ until, cast: e.play === 'cast', src: name });
          pushEvent(s, 'impulse', `${name}: coge ${e.amount === 1 ? 'la primera carta' : 'las ' + e.amount + ' primeras cartas'} de tu biblioteca y ${e.amount === 1 ? 'escanéala' : 'escanéalas'} en el círculo: ${e.amount === 1 ? 'irá' : 'irán'} al exilio.`, { to: pl.id, amount: e.amount, until: e.until, play: e.play });
        }
        break;
      }
      case 'tokenAttach': {
        // la ficha entra y el equipo se le une (Job select, Living weapon, For Mirrodin!)
        const tk = makePerm(s, tokenCard({ ...e, subtype: e.subtype.split(' ').pop() }), pl.id);
        if (e.subtype.includes(' ')) { tk.card.typeLine = `Token Creature — ${e.subtype}`; }
        pl.battlefield.push(tk);
        pushEvent(s, 'play', `${name} crea una ${tk.card.printedName.toLowerCase()} ${e.power}/${e.toughness}.`, { uid: tk.uid, by: pl.id, color: e.colors[0] || 'C', token: true });
        if (source) {
          source.attachedTo = tk.uid;
          refreshStatics(s);
          const what = describeAttach(attachOf(source.card));
          pushEvent(s, 'pump', `${name} se equipa a la ficha${what ? ' (' + what + ')' : ''}.`, { uid: tk.uid, by: pl.id });
        }
        break;
      }
      case 'attachTo':
        if (perm && source && perm.perm.card.isCreature) {
          source.attachedTo = perm.perm.uid;
          refreshStatics(s);
          pushEvent(s, 'pump', `${name} se equipa a ${displayName(perm.perm.card)}.`, { uid: perm.perm.uid, by: pl.id });
        }
        break;
      case 'tapHost': {
        const host = source && source.attachedTo != null ? findPerm(s, source.attachedTo) : null;
        if (host) {
          host.perm.tapped = true;
          pushEvent(s, 'pump', `${name} gira a ${displayName(host.perm.card)}.`, { uid: host.perm.uid });
        } else if (!pl.isBot) pushEvent(s, 'manual', `${name} gira la criatura encantada: gírala a mano.`, { to: pl.id });
        break;
      }
      case 'tap':
      case 'untap':
        if (perm) {
          perm.perm.tapped = e.kind === 'tap';
          pushEvent(s, 'pump', `${name} ${e.kind === 'tap' ? 'gira' : 'endereza'} a ${displayName(perm.perm.card)}.`, { uid: perm.perm.uid });
        }
        break;
      case 'extraLand':
        pl.extraLands = (pl.extraLands || 0) + e.amount;
        pushEvent(s, 'info', `${pl.name} puede jugar ${e.amount === 1 ? 'una tierra adicional' : e.amount + ' tierras adicionales'} este turno.`, { to: pl.id });
        break;
      case 'regrow': {
        const okType = (c) => cardIsType(c, e.type || 'creature');
        const idx = pl.graveyard.map((c, i) => [c, i]).filter(([c]) => okType(c)).sort((x, y) => y[0].cmc - x[0].cmc)[0];
        if (idx) {
          const [c, i] = idx;
          pl.graveyard.splice(i, 1);
          if (pl.isBot) pl.hand.push({ ...c, uid: s.nextId++ });
          else pl.handCount += 1;
          pushEvent(s, 'info', pl.isBot ? `${pl.name} recupera ${displayName(c)} de su cementerio.` : `${name}: coge ${displayName(c)} de tu cementerio y ponla en tu mano.`, { to: pl.id });
        }
        break;
      }
      default:
        execMore(s, pl, card, e, { perm, target, tgt, name, source, ctx });
    }
  }
}

function hurtPlayer(s, t, amount, srcName) {
  if (t.prevent) { const k = Math.min(t.prevent, amount); t.prevent -= k; amount -= k; if (amount <= 0) return; }
  t.life -= amount;
  t.damagedTurn = s.turn;
  pushEvent(s, 'life', `${srcName} hace ${amount} de daño a ${t.name} (${t.life}).`, { target: t.id, delta: -amount });
}

// ---------------------------------------------- acciones basadas en estado

/** Regla 704: criaturas con daño letal, planeswalkers sin lealtad, leyendas, vidas... */
function stateBased(s) {
  for (const p of s.players) {
    for (const perm of [...p.battlefield]) {
      if (perm.card.isCreature) {
        const lethal = perm.damage >= toughness(perm) || (perm.deathtouched && perm.damage > 0);
        if (toughness(perm) <= 0) leaveBattlefield(s, p, perm, 'graveyard', 'muere');
        else if (lethal && !has(perm, 'indestructible')) leaveBattlefield(s, p, perm, 'graveyard', 'muere');
      } else if (isPlaneswalker(perm) && perm.loyalty != null && perm.loyalty <= 0) {
        leaveBattlefield(s, p, perm, 'graveyard', 'se queda sin lealtad');
      }
    }
    for (const perm of [...p.battlefield]) {
      const su = staticsOf(perm.card).find((x) => x.kind === 'sacUnless');
      if (!su) continue;
      const w = su.what.toLowerCase().replace(/s$/, '');
      const has2 = p.battlefield.some((x) => x !== perm && (w === 'artifact' ? /Artifact/.test(x.card.typeLine) : w === 'other creature' ? x.card.isCreature : new RegExp('\\b' + w + '\\b', 'i').test(x.card.typeLine)));
      if (!has2) leaveBattlefield(s, p, perm, 'graveyard', 'se sacrifica (ya no controlas lo que necesita)');
    }
    // Regla de leyendas: si controlas dos legendarios con el mismo nombre, te quedas uno.
    const seen = new Map();
    for (const perm of [...p.battlefield].reverse()) {
      if (!perm.card.isLegendary) continue;
      if (seen.has(perm.card.name)) {
        leaveBattlefield(s, p, perm, 'graveyard', 'va al cementerio por la regla de leyendas');
      } else seen.set(perm.card.name, perm);
    }
  }
  checkDeaths(s);
}

/** Habilidades «cuando muera…»: se aplican solas (las que piden objetivo, a mano). */
function fireDies(s, owner, perm) {
  const fx = perm.card.effects?.dies || [];
  if (!fx.length || owner.eliminated) return;
  const name = displayName(perm.card);
  pushEvent(s, 'info', `Al morir, se dispara la habilidad de ${name}.`, { to: owner.id });
  resolveEffects(s, owner, perm.card, fx, [], null);
}

function leaveBattlefield(s, owner, perm, to, verb) {
  if (!owner.battlefield.some((x) => x.uid === perm.uid)) return;
  leaveBattlefieldInner(s, owner, perm, to, verb);
  if (to === 'graveyard' && perm.card.isCreature) diesTriggers(s, owner, perm);
  if (to !== 'battlefield') fireTriggers(s, 'leaves', { perm });
}

function leaveBattlefieldInner(s, owner, perm, to, verb) {
  owner.battlefield = owner.battlefield.filter((x) => x.uid !== perm.uid);
  delete s.combat.attackers[perm.uid];
  delete s.combat.blocks[perm.uid];
  for (const k of Object.keys(s.combat.blocks)) s.combat.blocks[k] = s.combat.blocks[k].filter((u) => u !== perm.uid);
  const name = displayName(perm.card);
  if (perm.isCommander && (to === 'graveyard' || to === 'exile' || to === 'hand' || to === 'library')) {
    owner.commanderInZone = true;
    pushEvent(s, 'death', `${name} ${verb || 'deja el campo'} y vuelve a la zona de mando.`, { uid: perm.uid });
    if (to === 'graveyard') fireDies(s, owner, perm);
    return;
  }
  if (perm.card.isToken) {
    pushEvent(s, 'death', `${name} desaparece (las fichas dejan de existir fuera del campo de batalla).`, { uid: perm.uid });
    return;
  }
  if (to === 'graveyard') owner.graveyard.push(perm.card);
  else if (to === 'exile') owner.exile.push(perm.card);
  else if (to === 'hand' && owner.isBot) owner.hand.push({ ...perm.card, uid: perm.uid });
  else if (to === 'hand' && !perm.card.isToken) owner.handCount = (owner.handCount || 0) + 1;
  else if (to === 'library' && owner.isBot) owner.library.unshift({ ...perm.card, uid: perm.uid });
  const where = { graveyard: 'al cementerio', exile: 'al exilio', hand: 'a la mano', library: 'a la biblioteca' }[to];
  pushEvent(s, 'death', `${name} ${verb ? verb + ' y va' : 'va'} ${where}.`, { uid: perm.uid, to });
  if (to === 'graveyard') fireDies(s, owner, perm);
}

function checkDeaths(s) {
  for (const p of s.players) {
    if (p.eliminated) continue;
    if (p.life <= 0) eliminate(s, p, 'se queda sin vidas');
    else if (p.poison >= 10) eliminate(s, p, 'tiene 10 contadores de veneno');
    else if (Object.values(p.cmdDamage).some((d) => d >= 21)) eliminate(s, p, 'recibe 21 de daño de un mismo comandante');
  }
}

function eliminate(s, p, why) {
  if (p.eliminated) return;
  p.eliminated = true;
  p.battlefield = [];
  pushEvent(s, 'out', `${p.name} ${why} y queda eliminado.`, { player: p.id });
  for (const k of Object.keys(s.combat.attackers)) if (defenderOf(s, s.combat.attackers[k]) === p.id || defenderOf(s, s.combat.attackers[k]) == null) delete s.combat.attackers[k];
  for (const it of s.stack) it.waiting = it.waiting.filter((id) => id !== p.id);
  s.stack = s.stack.filter((it) => it.by !== p.id);
  const alive = alivePlayers(s);
  if (alive.length === 1) {
    s.winner = alive[0].id;
    pushEvent(s, 'win', `¡${alive[0].name} gana la partida!`, { player: alive[0].id });
  }
}

// ------------------------------------------------------------------ texto

export function displayName(card) {
  return card.printedName || card.name;
}

const fmt = (n) => (n >= 0 ? '+' + n : String(n));

// ------------------------------------------------- efectos ampliados (abilities.js)

function substX(e, x) {
  const o = { ...e };
  for (const k of ['amount', 'p', 't', 'power', 'toughness']) {
    if (o[k] === 'X') o[k] = x;
    else if (o[k] === '+X') o[k] = x;
    else if (o[k] === '-X') o[k] = -x;
  }
  return o;
}

/** Cuenta para «igual al número de…» / «por cada…». */
export function countFor(s, pl, what, self = null) {
  const bf = pl.battlefield;
  switch (true) {
    case what === 'myLands': return bf.filter((x) => x.card.isLand).length;
    case what === 'myCreatures': return bf.filter((x) => x.card.isCreature).length;
    case what === 'myOtherCreatures': return bf.filter((x) => x.card.isCreature && x !== self).length;
    case what === 'myArtifacts': return bf.filter((x) => /Artifact/.test(x.card.typeLine)).length;
    case what === 'myEnchantments': return bf.filter((x) => /Enchantment/.test(x.card.typeLine)).length;
    case what === 'myHand': return pl.isBot ? pl.hand.length : pl.handCount || 0;
    case what === 'myGrave': return pl.graveyard.length;
    case what === 'myGraveCreatures': return pl.graveyard.filter((c) => c.isCreature).length;
    case what === 'allCreatures': return s.players.reduce((a, p) => a + p.battlefield.filter((x) => x.card.isCreature).length, 0);
    case what === 'opponents': return opponents(s, pl.id).length;
    case what.startsWith('myLandType:'): return bf.filter((x) => new RegExp('\\b' + what.split(':')[1] + '\\b', 'i').test(x.card.typeLine)).length;
    default: return 0;
  }
}

function hostOf(s, source) {
  if (!source || source.attachedTo == null) return null;
  return findPerm(s, source.attachedTo)?.perm || null;
}

/** +X/+X y habilidades hasta el final del turno. */
function pumpPerm(s, perm, p, t, kw = []) {
  perm.pump.p += p;
  perm.pump.t += t;
  if (kw.length) {
    perm.eot = perm.eot || {};
    perm.eot.kw = [...new Set([...(perm.eot.kw || []), ...kw])];
  }
  const parts = [];
  if (p || t) parts.push(`${fmt(p)}/${fmt(t)}`);
  if (kw.length) parts.push(kw.map(kwEs).join(', '));
  pushEvent(s, 'pump', `${displayName(perm.card)} recibe ${parts.join(' y ')} hasta el final del turno.`, { uid: perm.uid });
}

function gainLife(s, pl, n) {
  if (!n) return;
  for (const p of s.players) for (const x of p.battlefield) for (const st of staticsOf(x.card)) {
    if (st.kind === 'noLifeGain' && (st.who === 'all' || p.id !== pl.id)) { pushEvent(s, 'info', `${pl.name} no puede ganar vidas (${displayName(x.card)}).`); return; }
  }
  for (const x of pl.battlefield) for (const st of staticsOf(x.card)) if (st.kind === 'lifeBonus') n = st.twice ? n * 2 : n + st.plus;
  pl.life += n;
  pushEvent(s, 'life', `${pl.name} gana ${n} vida${n === 1 ? '' : 's'} (${pl.life}).`, { target: pl.id, delta: n });
  fireTriggers(s, 'gainLife', { player: pl });
}

/** ¿Es la carta de ese tipo? («creature», «instant or sorcery», «card»…) */
export function cardIsType(c, type) {
  if (!type || type === 'card') return true;
  return type.split(/ or /).some((t) => (t === 'permanent' ? c.isPermanent : t === 'historic' ? /Legendary|Artifact|Saga/.test(c.typeLine) : new RegExp('\\b' + t + '\\b', 'i').test(c.typeLine || '')));
}

/** Permanentes que cumplen un filtro (para «destruye todas las criaturas»…). */
function permsMatching(s, f, casterId) {
  const out = [];
  for (const p of s.players) for (const perm of p.battlefield) if (permMatches(s, f, perm, p.id, casterId)) out.push([p, perm]);
  return out;
}

function destroyPerm(s, owner, perm) {
  if (has(perm, 'indestructible')) { pushEvent(s, 'info', `${displayName(perm.card)} es indestructible y no se destruye.`); return; }
  if (perm.regen) {
    perm.regen = false;
    perm.tapped = true;
    perm.damage = 0;
    delete s.combat.attackers[perm.uid];
    pushEvent(s, 'info', `${displayName(perm.card)} se regenera (se gira y se le quita el daño).`, { uid: perm.uid });
    return;
  }
  leaveBattlefield(s, owner, perm, 'graveyard', 'es destruida');
}

/** Quién es «target player / each opponent / each player…» */
function playersFor(s, pl, who, target) {
  if (!who || who === 'you') return [pl];
  if (/each opponent/.test(who)) return opponents(s, pl.id);
  if (/each player/.test(who)) return alivePlayers(s);
  if (target) return [target];
  return opponents(s, pl.id).slice(0, 1);
}

function botDiscard(s, p, n) {
  for (let i = 0; i < n && p.hand.length; i++) {
    const worst = [...p.hand].sort((a, b) => (a.isLand ? 1 : 0) - (b.isLand ? 1 : 0) || a.cmc - b.cmc)[0];
    p.hand.splice(p.hand.indexOf(worst), 1);
    p.graveyard.push(stripCard(worst));
    pushEvent(s, 'info', `${p.name} descarta ${displayName(worst)}.`);
  }
}

function enterPerm(s, pl, card, { tapped = false, from = null } = {}) {
  const perm = makePerm(s, card, pl.id);
  if (tapped) perm.tapped = true;
  pl.battlefield.push(perm);
  applyEntersStatics(s, pl, perm);
  pushEvent(s, 'play', `${displayName(card)} entra al campo de batalla${from ? ' ' + from : ''}.`, { uid: perm.uid, by: pl.id, color: card.colors?.[0] || card.produces?.[0] || 'C', token: !!card.isToken });
  refreshStatics(s);
  fireEnterTriggers(s, pl, perm);
  return perm;
}

function execMore(s, pl, card, e, { perm, target, tgt, name, source, ctx }) {
  const human = !pl.isBot;
  const tell = (text) => { if (human) pushEvent(s, 'manual', `${name}: ${text}`, { to: pl.id }); };
  switch (e.kind) {
    // --- daño extra
    case 'damageAll':
      break;
    case 'pickMine':
      ctx.chosen = perm ? perm.perm : null;
      break;
    case 'bite':
    case 'fight': {
      const me = e.self ? (source && findPerm(s, source.uid) ? source : null) : ctx.chosen;
      if (!me) { tell(e.kind === 'fight' ? 'elige tus criaturas y haz que peleen a mano.' : 'aplica el daño a mano.'); break; }
      if (perm) {
        dealDamageToPerm(s, perm.perm, power(me), me);
        pushEvent(s, 'hit', `${displayName(me.card)} hace ${power(me)} de daño a ${displayName(perm.perm.card)}.`, { uid: perm.perm.uid });
        if (e.kind === 'fight') {
          dealDamageToPerm(s, me, power(perm.perm), perm.perm);
          pushEvent(s, 'hit', `${displayName(perm.perm.card)} hace ${power(perm.perm)} de daño a ${displayName(me.card)}.`, { uid: me.uid });
        }
      } else if (target) hurtPlayer(s, target, power(me), displayName(me.card));
      else if (e.target === 'opponents') for (const o of opponents(s, pl.id)) hurtPlayer(s, o, power(me), displayName(me.card));
      break;
    }
    // --- en masa
    case 'destroyAll':
      for (const [o, p2] of permsMatching(s, e.filter, pl.id)) destroyPerm(s, o, p2);
      break;
    case 'exileAll':
      for (const [o, p2] of permsMatching(s, e.filter, pl.id)) leaveBattlefield(s, o, p2, 'exile', 'es exiliada');
      break;
    case 'bounceAll':
      for (const [o, p2] of permsMatching(s, e.filter, pl.id)) leaveBattlefield(s, o, p2, 'hand', 'vuelve a la mano');
      break;
    case 'bounceSelf':
      if (source && findPerm(s, source.uid)) leaveBattlefield(s, pl, source, 'hand', 'vuelve a la mano');
      break;
    case 'tuck':
      if (perm) leaveBattlefield(s, perm.owner, perm.perm, 'library', 'se pone en la biblioteca');
      break;
    case 'tapAll':
    case 'untapAll':
      for (const [, p2] of permsMatching(s, e.filter, pl.id)) p2.tapped = e.kind === 'tapAll';
      pushEvent(s, 'info', `${name} ${e.kind === 'tapAll' ? 'gira' : 'endereza'} ${targetEs(e.filter).replace(/^una? /, 'todos los/las ')}.`);
      break;
    case 'untapSelf':
    case 'tapSelf':
      if (source) source.tapped = e.kind === 'tapSelf';
      break;
    case 'freeze':
      if (perm) { perm.perm.frozen = true; pushEvent(s, 'info', `${displayName(perm.perm.card)} no se enderezará en su próximo paso de enderezar.`, { uid: perm.perm.uid }); }
      break;
    case 'pumpAll': {
      const list = e.who === 'mine' ? pl.battlefield : e.who === 'opp' ? opponents(s, pl.id).flatMap((o) => o.battlefield) : s.players.flatMap((p) => p.battlefield);
      for (const p2 of list) if (p2.card.isCreature) {
        p2.pump.p += e.p; p2.pump.t += e.t;
        if (e.kw?.length) { p2.eot = p2.eot || {}; p2.eot.kw = [...new Set([...(p2.eot.kw || []), ...e.kw])]; }
      }
      pushEvent(s, 'pump', `${name}: ${e.who === 'mine' ? 'tus criaturas' : e.who === 'opp' ? 'las criaturas rivales' : 'todas las criaturas'} reciben ${fmt(e.p)}/${fmt(e.t)}${e.kw?.length ? ' y ' + e.kw.map(kwEs).join(', ') : ''} hasta el final del turno.`, { by: pl.id });
      break;
    }
    case 'noBlock':
      if (perm) { perm.perm.eot = { ...(perm.perm.eot || {}), noBlock: true, noAttack: !!e.noAttack }; pushEvent(s, 'info', `${displayName(perm.perm.card)} no puede ${e.noAttack ? 'atacar ni bloquear' : 'bloquear'} este turno.`, { uid: perm.perm.uid }); }
      break;
    case 'noBlockAll':
      for (const o of opponents(s, pl.id)) for (const p2 of o.battlefield) p2.eot = { ...(p2.eot || {}), noBlock: true };
      pushEvent(s, 'info', `${name}: las criaturas rivales no pueden bloquear este turno.`);
      break;
    case 'unblockable': {
      const tp = e.self ? source : perm && perm.perm;
      if (tp) { tp.eot = { ...(tp.eot || {}), unblockable: true }; pushEvent(s, 'info', `${displayName(tp.card)} no puede ser bloqueada este turno.`, { uid: tp.uid }); }
      break;
    }
    case 'counterAll': {
      const list = e.all ? (e.opp ? opponents(s, pl.id).flatMap((o) => o.battlefield) : s.players.flatMap((p) => p.battlefield)) : pl.battlefield;
      for (const p2 of list) if (p2.card.isCreature && !(e.other && source && p2.uid === source.uid)) p2.counters += e.amount;
      pushEvent(s, 'pump', `${name}: ${e.amount > 0 ? '+1/+1' : '-1/-1'} ×${Math.abs(e.amount)} a ${e.all ? 'las criaturas' : 'tus criaturas'}.`, { by: pl.id });
      break;
    }
    case 'proliferate':
      for (const p2 of pl.battlefield) {
        if (p2.counters > 0) p2.counters += 1;
        if (p2.loyalty != null && isPlaneswalker(p2)) p2.loyalty += 1;
      }
      for (const o of opponents(s, pl.id)) {
        for (const p2 of o.battlefield) if (p2.counters < 0) p2.counters -= 1;
        if (o.poison > 0) o.poison += 1;
      }
      pushEvent(s, 'info', `${name}: proliferar (+1 a cada contador que te conviene).`, { by: pl.id });
      break;
    // --- cartas
    case 'drawOther':
      for (const p of playersFor(s, pl, e.who, target)) {
        if (p.isBot) for (let i = 0; i < e.amount; i++) drawCard(s, p);
        else { p.handCount += e.amount; pushEvent(s, 'draw', `${name}: roba ${e.amount} carta${e.amount > 1 ? 's' : ''}.`, { to: p.id, amount: e.amount }); }
      }
      break;
    case 'discard':
      for (const p of playersFor(s, pl, e.who, target)) {
        const n = e.amount === 'all' ? (p.isBot ? p.hand.length : p.handCount) : e.amount;
        if (p.isBot && e.choose) {
          const best = [...p.hand].filter((c) => !c.isLand).sort((x, y) => y.cmc - x.cmc)[0];
          if (best) { p.hand.splice(p.hand.indexOf(best), 1); p.graveyard.push(stripCard(best)); pushEvent(s, 'info', `${p.name} descarta ${displayName(best)} (elegida por ${pl.name}).`); }
        } else if (p.isBot) botDiscard(s, p, n);
        else { p.handCount = Math.max(0, p.handCount - n); pushEvent(s, 'manual', `${name}: descarta ${e.amount === 'all' ? 'toda tu mano' : n === 1 ? 'una carta' : n + ' cartas'}.`, { to: p.id }); }
      }
      break;
    case 'mill':
      for (const p of playersFor(s, pl, e.who, target)) {
        if (p.isBot) { for (let i = 0; i < e.amount && p.library.length; i++) p.graveyard.push(stripCard(p.library.shift())); pushEvent(s, 'info', `${p.name} muele ${e.amount} carta${e.amount > 1 ? 's' : ''}.`); }
        else pushEvent(s, 'manual', `${name}: pon las ${e.amount} primeras cartas de tu biblioteca en tu cementerio (moler ${e.amount}).`, { to: p.id });
      }
      break;
    case 'scry':
      tell(`adivina ${e.amount}: mira las ${e.amount} primeras cartas de tu biblioteca y pon las que quieras debajo, el resto arriba en el orden que quieras.`);
      break;
    case 'surveil':
      if (pl.isBot) { const c = pl.library[0]; if (c && c.isLand && pl.battlefield.filter((x) => x.card.isLand).length >= 5) pl.graveyard.push(stripCard(pl.library.shift())); }
      tell(`vigila ${e.amount}: mira las ${e.amount} primeras cartas de tu biblioteca y pon las que quieras en tu cementerio, el resto arriba en el orden que quieras.`);
      break;
    case 'tutor': {
      const what = (e.what || '').toLowerCase();
      const fits = (c) => (/basic land/.test(what) ? c.isLand && /Basic/.test(c.typeLine) : /^land$/.test(what) ? c.isLand : new RegExp('\\b' + what.replace(/^basic /, '') + '\\b', 'i').test(c.typeLine || '') || c.name.toLowerCase() === what);
      if (pl.isBot) {
        for (let i = 0; i < e.amount; i++) {
          const k = pl.library.findIndex(fits);
          if (k < 0) break;
          const [c] = pl.library.splice(k, 1);
          if (e.toBattlefield) enterPerm(s, pl, c, { tapped: e.tapped });
          else pl.hand.push(c);
        }
        shuffleLib(s, pl);
      } else if (e.toBattlefield) {
        pl.pendingScan = [...(pl.pendingScan || []), ...Array.from({ length: e.amount }, () => ({ dest: 'battlefield', tapped: !!e.tapped, src: name, until: s.turn + 99 }))];
        pushEvent(s, 'impulse', `${name}: busca en tu biblioteca ${e.amount > 1 ? e.amount + ' cartas' : 'una carta'} (${e.what}), escanéala en el círculo para ponerla en el campo de batalla${e.tapped ? ' girada' : ''} y baraja.`, { to: pl.id, amount: e.amount, scan: 'battlefield' });
      } else {
        pl.handCount += e.amount;
        tell(`busca en tu biblioteca ${e.amount > 1 ? e.amount + ' cartas' : 'una carta'} (${e.what}), ponla en tu mano y baraja.`);
      }
      break;
    }
    case 'instruct':
      if (!e.silent) tell(e.text);
      if (e.draw && !human) drawCard(s, pl);
      break;
    case 'explore':
    case 'connive': {
      const me2 = source && findPerm(s, source.uid) ? source : null;
      if (pl.isBot) {
        const top = pl.library[0];
        if (e.kind === 'explore') {
          if (top && top.isLand) { pl.hand.push(pl.library.shift()); pushEvent(s, 'info', `${pl.name} explora: muestra ${displayName(top)} y la pone en su mano.`); }
          else if (me2) { me2.counters += 1; pushEvent(s, 'pump', `${displayName(me2.card)} explora y recibe un contador +1/+1.`, { uid: me2.uid }); }
        } else {
          drawCard(s, pl);
          const worst = [...pl.hand].sort((a, b) => a.cmc - b.cmc)[0];
          if (worst) { botDiscard(s, pl, 1); if (!worst.isLand && me2) me2.counters += 1; }
        }
      } else {
        tell(e.kind === 'explore'
          ? 'explora: muestra la primera carta de tu biblioteca. Si es una tierra, ponla en tu mano. Si no, pon un contador +1/+1 en la criatura (botón «Contador +1/+1») y deja la carta arriba o en el cementerio.'
          : 'conspira: roba una carta y descarta una. Si descartas una carta que no sea tierra, pon un contador +1/+1 en la criatura (botón «Contador +1/+1»).');
      }
      break;
    }
    case 'edict':
      for (const p of playersFor(s, pl, e.who, target)) {
        const cands = p.battlefield.filter((x) => permMatches(s, e.filter, x, p.id, null));
        if (!cands.length) continue;
        if (p.isBot) {
          const worst = [...cands].sort((a, b) => (a.card.isCreature ? power(a) + toughness(a) : a.card.cmc) - (b.card.isCreature ? power(b) + toughness(b) : b.card.cmc))[0];
          leaveBattlefield(s, p, worst, 'graveyard', 'es sacrificada');
        } else {
          p.pendingSacrifice = [...(p.pendingSacrifice || []), { filter: e.filter, src: name }];
          pushEvent(s, 'sacrifice', `${name}: sacrifica ${targetEs(e.filter)}.`, { to: p.id });
        }
      }
      break;
    case 'sacSelf':
      if (source && findPerm(s, source.uid)) leaveBattlefield(s, pl, source, 'graveyard', 'se sacrifica');
      break;
    case 'regen': {
      const tp = perm ? perm.perm : source;
      if (tp) { tp.regen = true; pushEvent(s, 'info', `${displayName(tp.card)} se regenerará la próxima vez que vaya a ser destruida este turno.`, { uid: tp.uid }); }
      break;
    }
    // --- vidas
    case 'loseAll':
      for (const p of alivePlayers(s)) { p.life -= e.amount; pushEvent(s, 'life', `${p.name} pierde ${e.amount} vidas (${p.life}).`, { target: p.id, delta: -e.amount }); }
      break;
    case 'gainAll':
      for (const p of alivePlayers(s)) gainLife(s, p, e.amount);
      break;
    // --- fichas y maná
    case 'artifactToken':
      for (let i = 0; i < e.amount; i++) enterPerm(s, pl, artifactTokenCard(e.subtype), { tapped: !!e.tapped });
      break;
    case 'amass': {
      let army = pl.battlefield.find((x) => /\bArmy\b/.test(x.card.typeLine));
      if (!army) {
        army = enterPerm(s, pl, tokenCard({ subtype: 'Army', power: 0, toughness: 0, colors: ['B'], keywords: [] }));
        army.card.typeLine = `Token Creature — ${e.subtype} Army`;
      }
      army.counters += e.amount;
      pushEvent(s, 'pump', `${name}: amasar ${e.amount} (el Ejército recibe ${e.amount} contador${e.amount > 1 ? 'es' : ''} +1/+1).`, { uid: army.uid });
      break;
    }
    case 'addMana':
      (pl.manaPool ||= []).push(...e.mana.map((m) => [...m]));
      pushEvent(s, 'mana', `${name}: +${e.mana.length} maná en tu reserva.`, { by: pl.id });
      break;
    case 'reanimate': {
      const okType = (c) => cardIsType(c, e.type || 'creature');
      const idx = pl.graveyard.map((c, i) => [c, i]).filter(([c]) => okType(c) && c.isPermanent).sort((x, y) => y[0].cmc - x[0].cmc)[0];
      if (!idx) break;
      if (pl.isBot) { const [c, i] = idx; pl.graveyard.splice(i, 1); enterPerm(s, pl, c, { from: 'desde el cementerio' }); }
      else {
        pl.pendingScan = [...(pl.pendingScan || []), { dest: 'battlefield', fromGrave: true, src: name, until: s.turn + 99 }];
        pushEvent(s, 'impulse', `${name}: elige una carta de tu cementerio (${e.type || 'criatura'}) y escanéala en el círculo: entrará al campo de batalla.`, { to: pl.id, amount: 1, scan: 'battlefield' });
      }
      break;
    }
    case 'selfRecur':
      tell(e.to === 'hand' ? 'devuélvela de tu cementerio a tu mano.' : 'devuélvela de tu cementerio al campo de batalla.');
      break;
    case 'counterspellUnless':
      break;
    default:
      if (execMore2(s, pl, card, e, { perm, target, name, source, ctx })) break;
      if (execMore3(s, pl, card, e, { perm, target, tgt, name, source, ctx })) break;
      if (human) pushEvent(s, 'manual', `${name}: ${describeEffect(e) || 'aplica este efecto a mano'}.`, { to: pl.id });
  }
}

function shuffleLib(s, pl) {
  const r = rng(s.seed + s.turn + s.eventSeq);
  shuffle(pl.library, r);
}

// ------------------------------------------------- habilidades disparadas

const SELF_EVENTS = new Set(['attacks', 'blocks', 'blocked', 'combatDamagePlayer', 'combatDamage', 'tapped', 'leaves']);
let triggerDepth = 0;

/** ¿Le afecta este evento a esta habilidad de `perm` (controlada por `p`)? */
function triggerApplies(ev, p, perm, info) {
  const ip = info.perm;
  const ipOwner = ip ? ip.ownerId : null;
  const isCr = ip && ip.card.isCreature;
  switch (ev) {
    case 'upkeep': case 'endstep': case 'begincombat': case 'main1': case 'drawstep': return info.player && info.player.id === p.id;
    case 'anyUpkeep': case 'anyEndstep': case 'anyCombat': return true;
    case 'main2': return info.player && info.player.id === p.id;
    case 'oppUpkeep': case 'oppEndstep': return info.player && info.player.id !== p.id;
    case 'artifactEtbMine': return ip && ipOwner === p.id && /Artifact/.test(ip.card.typeLine);
    case 'enchantmentEtbMine': return ip && ipOwner === p.id && /Enchantment/.test(ip.card.typeLine);
    case 'castHistoric': return info.player.id === p.id && /Legendary|Artifact|Saga/.test(info.card.typeLine);
    case 'castAuraEquip': return info.player.id === p.id && /Aura|Equipment|Vehicle/.test(info.card.typeLine);
    case 'castFirst': return info.player.id === p.id && info.nth === 1;
    case 'castAnyone': return true;
    case 'otherEtbMine': return ip && ipOwner === p.id && isCr && ip.uid !== perm.uid;
    case 'otherEtbMineNontoken': return ip && ipOwner === p.id && isCr && !ip.card.isToken && ip.uid !== perm.uid;
    case 'creatureEtbMine': return ip && ipOwner === p.id && isCr;
    case 'otherEtbAny': return ip && isCr && ip.uid !== perm.uid;
    case 'creatureEtbOpp': return ip && isCr && ipOwner !== p.id;
    case 'landfall': return ip && ipOwner === p.id && ip.card.isLand;
    case 'otherDiesMine': return ip && ipOwner === p.id && ip.uid !== perm.uid;
    case 'creatureDiesMine': return ip && ipOwner === p.id;
    case 'otherDiesAny': return ip && ip.uid !== perm.uid;
    case 'creatureDiesOpp': return ip && ipOwner !== p.id;
    case 'castNoncreature': return info.player.id === p.id && !info.card.isCreature;
    case 'castInstantSorcery': return info.player.id === p.id && (info.card.isInstant || info.card.isSorcery);
    case 'castCreature': return info.player.id === p.id && info.card.isCreature;
    case 'castAny': return info.player.id === p.id;
    case 'oppCast': return info.player.id !== p.id;
    case 'gainLife': return info.player.id === p.id;
    case 'youAttack': return info.player.id === p.id;
    case 'creatureAttacksMine': return ip && ipOwner === p.id;
    case 'creatureCombatDamageMine': return ip && ipOwner === p.id;
    case 'hostCombatDamagePlayer': case 'hostAttacks': case 'hostDies': return ip && perm.attachedTo === ip.uid;
    default: return SELF_EVENTS.has(ev) && ip && ip.uid === perm.uid;
  }
}

/** Dispara las habilidades de todos los permanentes que escuchan `ev`. */
function fireTriggers(s, ev, info = {}) {
  if (triggerDepth > 6 || s.winner) return;
  triggerDepth++;
  try {
    const seen = [];
    for (const p of s.players) {
      if (p.eliminated) continue;
      for (const perm of [...p.battlefield]) {
        for (const tr of triggersOf(perm.card, ev)) if (triggerApplies(ev, p, perm, info)) seen.push([p, perm, tr]);
      }
    }
    // la propia carta que se va («cuando deje el campo de batalla»)
    if (info.perm && SELF_EVENTS.has(ev) && !findPerm(s, info.perm.uid)) {
      const p = player(s, info.perm.ownerId);
      if (p) for (const tr of triggersOf(info.perm.card, ev)) seen.push([p, info.perm, tr]);
    }
    for (const [p, perm, tr] of seen) runTrigger(s, p, perm, tr, info);
  } finally { triggerDepth--; }
}

function runTrigger(s, p, perm, tr, info) {
  const name = displayName(perm.card);
  const wanted = tr.fx.filter(needsTarget);
  pushEvent(s, 'trigger', `Se dispara ${name}: ${tr.fx.map(describeEffect).filter(Boolean).join(', ')}.`, { uid: perm.uid, by: p.id });
  if (!wanted.length) { resolveEffects(s, p, perm.card, tr.fx, [], perm, info); return; }
  if (p.isBot) { resolveEffects(s, p, perm.card, tr.fx, autoTargets(s, p, wanted, perm), perm, info); return; }
  // humano: elige los objetivos en la mesa
  p.pendingTriggers = [...(p.pendingTriggers || []), { id: s.eventSeq, uid: perm.uid, card: stripCard(perm.card), fx: tr.fx }];
}

/** Objetivos razonables para un bot (o para resolver algo sin objetivos elegidos). */
function autoTargets(s, p, wanted, source) {
  const opps = opponents(s, p.id);
  const value = (x) => (x.card.isCreature ? power(x) * 2 + toughness(x) : x.card.cmc + 1);
  const foes = (w) => opps.flatMap((o) => o.battlefield.filter((x) => (w.target === 'any' ? x.card.isCreature : permMatches(s, w.filter, x, o.id, p.id)) && canTarget(s, p.id, x, o)));
  const mine = (w) => p.battlefield.filter((x) => (w.target === 'any' ? x.card.isCreature : permMatches(s, w.filter, x, p.id, p.id)) && canTarget(s, p.id, x, p));
  const good = (w) => ['pump', 'counter', 'untap', 'pickMine', 'regen', 'unblockable', 'attachTo'].includes(w.kind) && !(w.kind === 'pump' && w.t < 0) && !(w.kind === 'counter' && w.amount < 0);
  return wanted.map((w) => {
    if (w.target === 'spell') return null;
    if (w.target === 'player') return opps[0] ? { player: opps[0].id } : null;
    const pool = good(w) ? mine(w) : foes(w);
    const best = [...pool].sort((a, b) => value(b) - value(a))[0];
    if (best) return { uid: best.uid };
    if (w.target === 'any' && opps[0] && !good(w)) return { player: opps[0].id };
    return null;
  }).filter(Boolean);
}

function fireEnterTriggers(s, pl, perm) {
  fireTriggers(s, 'artifactEtbMine', { perm });
  fireTriggers(s, 'enchantmentEtbMine', { perm });
  // Evolucionar: si entra una criatura tuya más grande, +1/+1
  if (perm.card.isCreature) {
    for (const x of pl.battlefield) {
      if (x.uid === perm.uid || !keywordsOf(x.card).includes('evolve')) continue;
      if (power(perm) > power(x) || toughness(perm) > toughness(x)) { x.counters += 1; pushEvent(s, 'pump', `${displayName(x.card)} evoluciona (+1/+1).`, { uid: x.uid }); }
    }
  }
  fireTriggers(s, 'otherEtbMine', { perm });
  fireTriggers(s, 'otherEtbMineNontoken', { perm });
  fireTriggers(s, 'creatureEtbMine', { perm });
  fireTriggers(s, 'otherEtbAny', { perm });
  fireTriggers(s, 'creatureEtbOpp', { perm });
  fireTriggers(s, 'landfall', { perm });
}

function diesTriggers(s, owner, perm) {
  const kws = keywordsOf(perm.card);
  const mod = kws.map((k) => k.match(/^modular (\d+)/)).find(Boolean);
  if (mod && perm.counters > 0) {
    const to = owner.battlefield.find((x) => x.card.isCreature && /Artifact/.test(x.card.typeLine));
    if (to) { to.counters += perm.counters; pushEvent(s, 'pump', `Modular: ${displayName(to.card)} recibe ${perm.counters} contadores +1/+1.`, { uid: to.uid }); }
  }
  if (!perm.card.isToken && !owner.eliminated && ((kws.includes('persist') && perm.counters >= 0) || (kws.includes('undying') && perm.counters <= 0))) {
    const persist = kws.includes('persist') && perm.counters >= 0;
    const gi = owner.graveyard.findIndex((c) => c.name === perm.card.name);
    if (gi >= 0) owner.graveyard.splice(gi, 1);
    const back = enterPerm(s, owner, perm.card, { from: persist ? '(persistir)' : '(inmortal)' });
    back.counters = persist ? -1 : 1;
  }
  for (const st of staticsOf(perm.card)) {
    if (st.kind === 'afterlife' && !owner.eliminated) {
      for (let i = 0; i < st.amount; i++) {
        const tk = makePerm(s, tokenCard({ subtype: 'Spirit', power: 1, toughness: 1, colors: ['W', 'B'], keywords: ['flying'] }), owner.id);
        owner.battlefield.push(tk);
        pushEvent(s, 'play', `Más allá: ${displayName(perm.card)} deja una ficha de Espíritu 1/1 voladora.`, { uid: tk.uid, by: owner.id, color: 'W', token: true });
      }
    }
  }
  fireTriggers(s, 'otherDiesMine', { perm });
  fireTriggers(s, 'creatureDiesMine', { perm });
  fireTriggers(s, 'otherDiesAny', { perm });
  fireTriggers(s, 'creatureDiesOpp', { perm });
  fireTriggers(s, 'hostDies', { perm });
}

function castTriggers(s, pl, card) {
  s.spellsCast = s.spellsCast && s.spellsCast.turn === s.turn ? s.spellsCast : { turn: s.turn, n: 0, by: {} };
  s.spellsCast.n += 1;
  s.spellsCast.by[pl.id] = (s.spellsCast.by[pl.id] || 0) + 1;
  const info = { player: pl, card, nth: s.spellsCast.by[pl.id] };
  // Extorsionar: por cada extorsión, paga {W/B} y cada rival pierde 1 vida y tú ganas 1
  for (const x of pl.battlefield) {
    if (!keywordsOf(x.card).includes('extort')) continue;
    const plan = planPayment(pl, '{W/B}');
    if (!plan) continue;
    if (pl.isBot || pl.autoExtort !== false) {
      tapForPayment(pl, plan);
      let n = 0;
      for (const o of opponents(s, pl.id)) { o.life -= 1; n++; pushEvent(s, 'life', `Extorsión de ${displayName(x.card)}: ${o.name} pierde 1 vida (${o.life}).`, { target: o.id, delta: -1 }); }
      gainLife(s, pl, n);
    }
  }
  fireTriggers(s, 'castHistoric', info);
  fireTriggers(s, 'castAuraEquip', info);
  fireTriggers(s, 'castFirst', info);
  fireTriggers(s, 'castAnyone', info);
  if (!card.isCreature) {
    // Destreza (prowess): +1/+1 hasta el final del turno
    for (const perm of pl.battlefield) if (keywordsOf(perm.card).includes('prowess') || has(perm, 'prowess')) pumpPerm(s, perm, 1, 1);
    fireTriggers(s, 'castNoncreature', info);
  }
  if (card.isInstant || card.isSorcery) fireTriggers(s, 'castInstantSorcery', info);
  if (card.isCreature) fireTriggers(s, 'castCreature', info);
  fireTriggers(s, 'castAny', info);
  fireTriggers(s, 'oppCast', info);
}

function attackTriggers(s) {
  const pl = activePlayer(s);
  const atts = Object.keys(s.combat.attackers).map((u) => findPerm(s, +u)?.perm).filter(Boolean);
  // Exaltado: si una criatura ataca sola, +1/+1 por cada exaltado
  if (atts.length === 1) {
    const n = pl.battlefield.filter((x) => keywordsOf(x.card).includes('exalted') || has(x, 'exalted')).length;
    if (n) pumpPerm(s, atts[0], n, n);
  }
  fireTriggers(s, 'youAttack', { player: pl });
  for (const a of atts) {
    const fb = keywordsOf(a.card).map((k) => k.match(/^firebending (\d+)/)).find(Boolean);
    if (fb) { (pl.manaPool ||= []).push(...Array.from({ length: +fb[1] }, () => ['R'])); pushEvent(s, 'mana', `Fuego control de ${displayName(a.card)}: +${fb[1]} {R}.`, { by: pl.id }); }
    if (keywordsOf(a.card).includes('mentor')) {
      const pupil = atts.filter((x) => x !== a && power(x) < power(a)).sort((x, y) => power(y) - power(x))[0];
      if (pupil) { pupil.counters += 1; pushEvent(s, 'pump', `${displayName(a.card)} instruye a ${displayName(pupil.card)} (+1/+1).`, { uid: pupil.uid }); }
    }
    fireTriggers(s, 'attacks', { perm: a });
    fireTriggers(s, 'creatureAttacksMine', { perm: a });
    fireTriggers(s, 'hostAttacks', { perm: a });
  }
}

function blockTriggers(s) {
  if (s.combat.blockTriggersDone) return;
  s.combat.blockTriggersDone = true;
  const bush = (x) => { const m = keywordsOf(x.card).map((k) => k.match(/^bushido (\d+)/)).find(Boolean); if (m) pumpPerm(s, x, +m[1], +m[1]); };
  for (const [att, list] of Object.entries(s.combat.blocks)) {
    const a = findPerm(s, +att)?.perm;
    if (a && list.length) {
      bush(a);
      if (keywordsOf(a.card).includes('flanking')) for (const b of list) { const bp = findPerm(s, b)?.perm; if (bp && !keywordsOf(bp.card).includes('flanking')) pumpPerm(s, bp, -1, -1); }
      for (const b of list) { const bp = findPerm(s, b)?.perm; if (bp) bush(bp); }
    }
    if (a && list.length) fireTriggers(s, 'blocked', { perm: a });
    for (const b of list) { const bp = findPerm(s, b)?.perm; if (bp) fireTriggers(s, 'blocks', { perm: bp }); }
  }
}

// ------------------------------------------------- estáticas al entrar

function applyEntersStatics(s, pl, perm) {
  const coe = staticsOf(perm.card).find((x) => x.kind === 'chooseOnEnter');
  if (coe) {
    if (coe.tapped) perm.tapped = true;
    if (pl.isBot) {
      const counts = {};
      if (coe.what === 'color') { for (const x of pl.battlefield) for (const c of x.card.colors || []) counts[c] = (counts[c] || 0) + 1; perm.chosen = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'G'; }
      else if (coe.what === 'creature type') { for (const x of [...pl.battlefield, ...pl.hand.map((c) => ({ card: c }))]) for (const t of ((x.card.typeLine || '').split('—')[1] || '').trim().split(' ').filter(Boolean)) counts[t] = (counts[t] || 0) + 1; perm.chosen = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Human'; }
      else perm.chosen = opponents(s, pl.id)[0]?.id;
    } else {
      pl.pendingChoices = [...(pl.pendingChoices || []), { type: 'chooseOnEnter', uid: perm.uid, what: coe.what, name: displayName(perm.card) }];
      pushEvent(s, 'choice', `${displayName(perm.card)}: elige ${coe.what === 'color' ? 'un color' : coe.what === 'creature type' ? 'un tipo de criatura' : 'un rival'}.`, { to: pl.id });
    }
  }
  for (const k of keywordsOf(perm.card)) {
    let m;
    if ((m = k.match(/^(modular|fabricate) (\d+)/))) perm.counters += +m[2];
    else if ((m = k.match(/^bloodthirst (\d+)/)) && opponents(s, pl.id).some((o) => o.damagedTurn === s.turn)) perm.counters += +m[1];
    else if ((m = k.match(/^(vanishing|fading) (\d+)/))) perm.charge = +m[2];
    else if (/^echo/.test(k)) perm.echoDue = true;
    else if ((m = k.match(/^backup (\d+)/))) {
      const other = pl.battlefield.filter((x) => x.card.isCreature && x.uid !== perm.uid).sort((a, b) => power(b) - power(a))[0];
      (other || perm).counters += +m[1];
      pushEvent(s, 'pump', `Refuerzo ${m[1]}: ${displayName((other || perm).card)} recibe ${m[1]} contador${+m[1] > 1 ? 'es' : ''} +1/+1.`, { uid: (other || perm).uid });
    }
  }
  for (const st of staticsOf(perm.card)) {
    if (st.kind === 'entersCounters' && (!st.kicked || perm.card.kicked)) perm.counters += st.amount;
    if (st.kind !== 'entersTapped') continue;
    const otherLands = pl.battlefield.filter((x) => x.card.isLand && x.uid !== perm.uid);
    let tapped = true;
    if (st.unlessTypes) tapped = !otherLands.some((x) => st.unlessTypes.some((t) => new RegExp('\\b' + t + '\\b', 'i').test(x.card.typeLine)));
    else if (st.unlessFewLands != null) tapped = otherLands.length > st.unlessFewLands;
    else if (st.unlessManyLands != null) tapped = otherLands.length < st.unlessManyLands;
    else if (st.unlessLowLife != null) tapped = !s.players.some((p) => !p.eliminated && p.life <= st.unlessLowLife);
    else if (st.unlessBasics != null) tapped = otherLands.filter((x) => /Basic/.test(x.card.typeLine)).length < st.unlessBasics;
    else if (st.unlessOpps != null) tapped = opponents(s, pl.id).length < st.unlessOpps;
    else if (st.unlessPW) tapped = !pl.battlefield.some((x) => isPlaneswalker(x));
    else if (st.unlessOppLands != null) tapped = opponents(s, pl.id).reduce((acc, o) => acc + o.battlefield.filter((x) => x.card.isLand).length, 0) < st.unlessOppLands;
    else if (st.shock) {
      if (pl.isBot) tapped = pl.life <= 8;
      else {
        pl.pendingChoices = [...(pl.pendingChoices || []), { type: 'shock', uid: perm.uid, name: displayName(perm.card) }];
        pushEvent(s, 'choice', `${displayName(perm.card)}: ¿pagas 2 vidas para que entre enderezada?`, { to: pl.id });
      }
    }
    if (tapped) {
      perm.tapped = true;
      pushEvent(s, 'info', `${displayName(perm.card)} entra girada.`, { uid: perm.uid });
    }
  }
}

// ------------------------------------------------- efectos retrasados

/** «Roba una carta al comienzo del próximo mantenimiento», «sacrifícala al final del turno»… */
function runDelayed(s, at) {
  const list = s.delayed || [];
  const now = list.filter((d) => d.at === at && (at === 'upkeep' ? s.turn > d.from : s.turn >= d.from));
  if (!now.length) return;
  s.delayed = list.filter((d) => !now.includes(d));
  for (const d of now) {
    const pl = player(s, d.pid);
    if (!pl || pl.eliminated) continue;
    if (d.kind === 'draw') {
      if (pl.isBot) for (let i = 0; i < d.n; i++) drawCard(s, pl);
      else { pl.handCount += d.n; pushEvent(s, 'draw', `${d.src}: roba ${d.n === 1 ? 'una carta' : d.n + ' cartas'}.`, { to: pl.id, amount: d.n }); }
    } else if (d.kind === 'rebound') {
      const fx = effectFx(d.card);
      const i = pl.exile.findIndex((c) => c.name === d.card.name);
      if (i >= 0) pl.exile.splice(i, 1);
      pl.graveyard.push(d.card);
      pushEvent(s, 'trigger', `Rebote: ${displayName(d.card)} se lanza otra vez.`, { by: pl.id });
      const wanted = fx.filter(needsTarget);
      if (!wanted.length) resolveEffects(s, pl, d.card, fx, [], null);
      else if (pl.isBot) resolveEffects(s, pl, d.card, fx, autoTargets(s, pl, wanted, null), null);
      else pl.pendingTriggers = [...(pl.pendingTriggers || []), { id: s.eventSeq, uid: -1, card: d.card, fx }];
    } else if (d.kind === 'return') {
      const k = pl.exile.findIndex((c) => c.name === d.card.name);
      if (k >= 0) pl.exile.splice(k, 1);
      const np = enterPerm(s, pl, d.card, { from: '(vuelve al final del turno)' });
      resolveEtbOf(s, pl, np);
    } else if (d.kind === 'hand') {
      const f = findPerm(s, d.uid);
      if (f) leaveBattlefield(s, f.owner, f.perm, 'hand', 'vuelve a la mano (arremetida)');
    } else if (d.kind === 'sac') {
      const f = findPerm(s, d.uid);
      if (f) leaveBattlefield(s, f.owner, f.perm, d.exile ? 'exile' : 'graveyard', d.exile ? 'se exilia' : 'se sacrifica');
    }
  }
}

/** Efectos del segundo bloque (energía, prevenir, robar el control…). */
function execMore2(s, pl, card, e, { perm, target, name, source, ctx }) {
  const tell = (text) => { if (!pl.isBot) pushEvent(s, 'manual', `${name}: ${text}`, { to: pl.id }); };
  switch (e.kind) {
    case 'attachToChosen':
      if (source && ctx.lastToken) { source.attachedTo = ctx.lastToken.uid; refreshStatics(s); pushEvent(s, 'pump', `${name} se une a ${displayName(ctx.lastToken.card)}.`, { uid: ctx.lastToken.uid }); }
      return true;
    case 'selfToHand': {
      const i = pl.graveyard.findIndex((c) => c.name === card.name);
      if (i >= 0) pl.graveyard.splice(i, 1);
      if (pl.isBot) pl.hand.push({ ...stripCard(card), uid: s.nextId++ });
      else { pl.handCount += 1; tell('vuelve a tu mano: coge la carta del cementerio.'); }
      return true;
    }
    case 'exileSelf':
      card.exileOnResolve = true;
      return true;
    case 'energy':
      pl.energy = (pl.energy || 0) + e.amount;
      pushEvent(s, 'info', `${pl.name} obtiene ${e.amount} de energía (tiene ${pl.energy}).`, { to: pl.id });
      return true;
    case 'monstrosity':
      if (source && !source.monstrous) { source.monstrous = true; source.counters += e.amount === 'X' ? 0 : e.amount; pushEvent(s, 'pump', `${displayName(source.card)} se vuelve monstruosa (+${e.amount} contadores +1/+1).`, { uid: source.uid }); }
      return true;
    case 'adapt':
      if (source && source.counters <= 0) { source.counters += e.amount; pushEvent(s, 'pump', `${displayName(source.card)} se adapta (+${e.amount} contadores +1/+1).`, { uid: source.uid }); }
      return true;
    case 'chargeCounter':
      if (source) { source.charge = (source.charge || 0) + 1; pushEvent(s, 'info', `${displayName(source.card)} recibe un contador (${source.charge}).`, { uid: source.uid }); }
      return true;
    case 'prevent': {
      if (e.self && source) source.prevent = (source.prevent || 0) + e.amount;
      else if (e.you) pl.prevent = (pl.prevent || 0) + e.amount;
      else if (perm) perm.perm.prevent = (perm.perm.prevent || 0) + e.amount;
      else if (target) target.prevent = (target.prevent || 0) + e.amount;
      pushEvent(s, 'info', `${name}: se previene${e.amount >= 999 ? ' todo el daño' : ` el próximo ${e.amount} de daño`}.`);
      return true;
    }
    case 'fog':
      s.fog = true;
      pushEvent(s, 'info', `${name}: se previene todo el daño de combate de este turno.`);
      return true;
    case 'threaten':
    case 'steal':
      if (perm && perm.owner.id !== pl.id) {
        const p2 = perm.perm;
        perm.owner.battlefield = perm.owner.battlefield.filter((x) => x !== p2);
        if (e.kind === 'threaten') p2.returnTo = perm.owner.id;
        p2.ownerId = pl.id;
        delete s.combat.attackers[p2.uid];
        pl.battlefield.push(p2);
        pushEvent(s, 'play', `${pl.name} toma el control de ${displayName(p2.card)}${e.kind === 'threaten' ? ' hasta el final del turno' : ''}.`, { uid: p2.uid, by: pl.id });
      }
      return true;
    case 'untapLast':
      if (ctx.last) ctx.last.perm.tapped = false;
      return true;
    case 'hasteLast':
      if (ctx.last) ctx.last.perm.eot = { ...(ctx.last.perm.eot || {}), kw: [...new Set([...(ctx.last.perm.eot?.kw || []), 'haste'])] };
      return true;
    case 'controllerLife':
    case 'controllerLifePower': {
      const who = ctx.last ? player(s, ctx.last.perm.ownerId) || ctx.last.owner : null;
      if (!who) return true;
      const n = e.kind === 'controllerLifePower' ? power(ctx.last.perm) : e.amount;
      if (n >= 0) gainLife(s, who, n);
      else { who.life += n; pushEvent(s, 'life', `${who.name} pierde ${-n} vidas (${who.life}).`, { target: who.id, delta: n }); }
      return true;
    }
    case 'delayedDraw':
      (s.delayed ||= []).push({ at: 'upkeep', from: s.turn, pid: pl.id, kind: 'draw', n: e.amount, src: name });
      pushEvent(s, 'info', `${name}: robarás ${e.amount === 1 ? 'una carta' : e.amount + ' cartas'} al comienzo del próximo mantenimiento.`, { to: pl.id });
      return true;
    case 'delayedSac': {
      const tgt2 = ctx.lastToken || (ctx.last && ctx.last.perm) || source;
      if (tgt2) (s.delayed ||= []).push({ at: 'end', from: s.turn, pid: pl.id, kind: 'sac', uid: tgt2.uid, exile: !!e.exile });
      return true;
    }
    case 'extraTurn':
      (s.extraTurns ||= []).push(pl.id);
      pushEvent(s, 'info', `${name}: ${pl.name} jugará un turno extra después de este.`);
      return true;
    case 'freezeLast':
      if (ctx.last) ctx.last.perm.frozen = true;
      return true;
    case 'returnExiled': {
      const holder = source;
      for (const h2 of (holder && holder.holding) || []) {
        const o = player(s, h2.owner);
        if (!o) continue;
        const k = o.exile.findIndex((c) => c.name === h2.card.name);
        if (k >= 0) o.exile.splice(k, 1);
        if (e.toHand) { if (o.isBot) o.hand.push({ ...h2.card, uid: s.nextId++ }); else o.handCount += 1; pushEvent(s, 'info', `${displayName(h2.card)} vuelve a la mano de ${o.name}.`); }
        else enterPerm(s, o, h2.card, { from: 'desde el exilio' });
      }
      if (holder) holder.holding = [];
      return true;
    }
    case 'switchPT':
      if (source) { const d = toughness(source) - power(source); source.pump.p += d; source.pump.t -= d; pushEvent(s, 'pump', `${displayName(source.card)} intercambia su fuerza y su resistencia.`, { uid: source.uid }); }
      return true;
    case 'canAttackDefender':
      if (source) source.eot = { ...(source.eot || {}), canAttackDefender: true };
      return true;
    case 'putLand':
      if (pl.isBot) { const i = pl.hand.findIndex((c) => c.isLand); if (i >= 0) { const [c] = pl.hand.splice(i, 1); enterPerm(s, pl, c, { tapped: e.tapped }); } }
      else {
        pl.pendingScan = [...(pl.pendingScan || []), { dest: 'battlefield', fromHand: true, tapped: !!e.tapped, src: name, until: s.turn + 99 }];
        pushEvent(s, 'impulse', `${name}: escanea una tierra de tu mano y entrará al campo de batalla${e.tapped ? ' girada' : ''}.`, { to: pl.id, amount: 1, scan: 'battlefield' });
      }
      return true;
    case 'exileGraveCard': {
      const opps = opponents(s, pl.id).filter((o) => o.graveyard.length).sort((a, b) => b.graveyard.length - a.graveyard.length);
      const o = opps[0];
      if (!o) return true;
      const i = o.graveyard.map((c, k) => [c, k]).sort((x, y) => (y[0].isCreature ? 5 : 0) + y[0].cmc - (x[0].isCreature ? 5 : 0) - x[0].cmc)[0][1];
      const [c] = o.graveyard.splice(i, 1);
      o.exile.push(c);
      pushEvent(s, 'info', `${name} exilia ${displayName(c)} del cementerio de ${o.name}.`);
      return true;
    }
    case 'exileGraveyard':
      for (const o of e.all ? opponents(s, pl.id) : opponents(s, pl.id).slice(0, 1)) { o.exile.push(...o.graveyard); o.graveyard = []; pushEvent(s, 'info', `${name} exilia el cementerio de ${o.name}.`); }
      return true;
    case 'damageEach':
      for (const o of opponents(s, pl.id)) for (const c of [...o.battlefield]) if (c.card.isCreature) dealDamageToPerm(s, c, e.amount, null, card);
      return true;
    case 'support':
    case 'bolster': {
      const mine = pl.battlefield.filter((x) => x.card.isCreature && (!source || x.uid !== source.uid));
      if (!mine.length) return true;
      if (e.kind === 'bolster') { const low = [...mine].sort((a, b) => toughness(a) - toughness(b))[0]; low.counters += e.amount; pushEvent(s, 'pump', `${name}: reforzar ${e.amount} sobre ${displayName(low.card)}.`, { uid: low.uid }); }
      else for (const x of mine.slice(0, e.amount)) { x.counters += 1; pushEvent(s, 'pump', `${name}: apoyo a ${displayName(x.card)} (+1/+1).`, { uid: x.uid }); }
      return true;
    }
    default:
      return false;
  }
}

/** Carta boca abajo: criatura 2/2 sin nombre (con resguardo {2} si es disfraz). */
function faceDownCard(card, kind, cost) {
  return {
    id: 'facedown:' + card.id, name: 'Face-down creature', printedName: 'Criatura boca abajo', image: null, manaCost: '{3}', cmc: 0,
    typeLine: 'Creature', printedType: 'Criatura boca abajo', oracle: kind === 'disguise' ? 'Ward {2}' : '', printedText: kind === 'disguise' ? 'Resguardo {2}.' : '',
    power: 2, toughness: 2, colors: [], keywords: [], isLand: false, isCreature: true, isInstant: false, isSorcery: false, isLegendary: false,
    isPermanent: true, produces: [], effects: { etb: [], spell: [], dies: [] },
    faceDown: true, hidden: stripCard(card), morphCost: cost, morphKind: kind,
  };
}

// ------------------------------------------------- mantenimiento: eco, desvanecerse, acumulativo

function upkeepKeywords(s, pl) {
  for (const perm of [...pl.battlefield]) {
    const kws = keywordsOf(perm.card);
    for (const k of kws) {
      let m;
      if ((m = k.match(/^(vanishing|fading)/)) && perm.charge != null) {
        if (m[1] === 'fading' && perm.charge <= 0) { leaveBattlefield(s, pl, perm, 'graveyard', 'se desvanece'); break; }
        perm.charge -= 1;
        if (m[1] === 'vanishing' && perm.charge <= 0) { leaveBattlefield(s, pl, perm, 'graveyard', 'se desvanece'); break; }
      }
    }
    const cu = abilitiesOf(perm.card).find((a) => a.kind === 'keyword' && /^cumulative upkeep/i.test(a.text));
    const ec = perm.echoDue ? abilitiesOf(perm.card).find((a) => a.kind === 'keyword' && /^echo/i.test(a.text)) : null;
    for (const [ab, what] of [[cu, 'cumulative'], [ec, 'echo']]) {
      if (!ab || !findPerm(s, perm.uid)) continue;
      const one = (ab.text.match(/((?:\{[^}]+\})+)/) || [])[1];
      if (!one) { if (!pl.isBot) pushEvent(s, 'manual', `${displayName(perm.card)}: paga su coste de ${what === 'echo' ? 'eco' : 'mantenimiento acumulativo'} (${ab.text}) o sacrifícala.`, { to: pl.id }); continue; }
      if (what === 'cumulative') perm.age = (perm.age || 0) + 1;
      if (what === 'echo') perm.echoDue = false;
      const cost = what === 'cumulative' ? one.repeat(perm.age) : one;
      if (pl.isBot) {
        const plan = planPayment(pl, cost);
        if (plan && (what === 'echo' || perm.age <= 3)) { tapForPayment(pl, plan); pushEvent(s, 'info', `${pl.name} paga ${cost} por ${displayName(perm.card)}.`); }
        else leaveBattlefield(s, pl, perm, 'graveyard', 'se sacrifica (no paga su coste)');
      } else {
        pl.pendingChoices = [...(pl.pendingChoices || []), { type: 'upkeep', uid: perm.uid, cost, name: displayName(perm.card), what }];
        pushEvent(s, 'choice', `${displayName(perm.card)}: paga ${cost} o sacrifícala.`, { to: pl.id });
      }
    }
  }
}

function payCost(s, pl, e) {
  if (e.life) { pl.life -= e.life; pushEvent(s, 'life', `${pl.name} paga ${e.life} vidas (${pl.life}).`, { target: pl.id, delta: -e.life }); return; }
  const en = (e.cost.match(/\{E\}/g) || []).length;
  const mana = e.cost.replace(/\{E\}/g, '');
  if (en) pl.energy = (pl.energy || 0) - en;
  if (mana) { const plan = planPayment(pl, mana); if (plan) tapForPayment(pl, plan); }
  pushEvent(s, 'info', `${pl.name} paga ${e.cost}.`, { to: pl.id });
}

/** Tercer bloque de efectos (copias, parpadeo, descubrir, incubar…). */
function execMore3(s, pl, card, e, { perm, target, tgt, name, source, ctx }) {
  const tell = (text) => { if (!pl.isBot) pushEvent(s, 'manual', `${name}: ${text}`, { to: pl.id }); };
  switch (e.kind) {
    case 'copySpell': {
      const it = tgt && tgt.stack ? s.stack.find((x) => x.id === tgt.stack) : null;
      if (!it) return true;
      const fx2 = effectFx(it.card);
      pushEvent(s, 'info', `${name} copia ${displayName(it.card)}.`);
      resolveEffects(s, pl, it.card, fx2, fx2.some(needsTarget) ? (pl.isBot ? autoTargets(s, pl, fx2.filter(needsTarget), null) : it.targets || []) : [], null);
      return true;
    }
    case 'hasteLast': {
      const list = ctx.tokens.length ? ctx.tokens : ctx.last ? [ctx.last.perm] : source ? [source] : [];
      for (const x of list) x.eot = { ...(x.eot || {}), kw: [...new Set([...(x.eot?.kw || []), 'haste'])] };
      return true;
    }
    case 'flicker':
      if (perm) {
        const c = perm.perm.card;
        const owner = perm.owner;
        leaveBattlefield(s, owner, perm.perm, 'exile', 'se exilia');
        const k = owner.exile.findIndex((x) => x.name === c.name);
        if (k >= 0) owner.exile.splice(k, 1);
        if (!c.isToken) { const np = enterPerm(s, owner, c, { from: '(vuelve del exilio)' }); resolveEtbOf(s, owner, np); }
      }
      return true;
    case 'flickerBack': {
      const last = ctx.last;
      if (!last) return true;
      const c = last.perm.card;
      const owner = player(s, last.perm.ownerId) || last.owner;
      const back = () => {
        const k = owner.exile.findIndex((x) => x.name === c.name);
        if (k >= 0) owner.exile.splice(k, 1);
        const np = enterPerm(s, owner, c, { from: '(vuelve del exilio)' });
        resolveEtbOf(s, owner, np);
      };
      if (e.delayed) (s.delayed ||= []).push({ at: 'end', from: s.turn, pid: owner.id, kind: 'return', card: c });
      else if (!findPerm(s, last.perm.uid)) back();
      return true;
    }
    case 'reanimateAny': {
      const all = s.players.flatMap((p) => p.graveyard.map((c, i) => [p, c, i])).filter(([, c]) => c.isCreature).sort((a, b) => b[1].cmc - a[1].cmc);
      if (!all.length) return true;
      if (pl.isBot || all[0][0].isBot) {
        const [p, c, i] = all.find(([p]) => p.isBot) || all[0];
        p.graveyard.splice(i, 1);
        enterPerm(s, pl, c, { from: `desde el cementerio de ${p.name}` });
      } else {
        pl.pendingScan = [...(pl.pendingScan || []), { dest: 'battlefield', fromGrave: true, src: name, until: s.turn + 99 }];
        pushEvent(s, 'impulse', `${name}: elige una criatura de un cementerio y escanéala: entrará bajo tu control.`, { to: pl.id, amount: 1, scan: 'battlefield' });
      }
      return true;
    }
    case 'copyToken': {
      const base = e.self ? source : perm && perm.perm;
      if (!base) return true;
      const c = { ...stripCard(base.card), isToken: true, id: 'tokencopy:' + base.card.id, printedName: (base.card.printedName || base.card.name) + ' (ficha)' };
      const tk = enterPerm(s, pl, c, { from: '(ficha copia)' });
      ctx.tokens.push(tk);
      ctx.lastToken = tk;
      return true;
    }
    case 'returnLand': {
      const lands = pl.battlefield.filter((x) => x.card.isLand && (!source || x.uid !== source.uid || pl.battlefield.filter((y) => y.card.isLand).length === 1));
      const pick = [...lands].sort((a, b) => (b.tapped ? 1 : 0) - (a.tapped ? 1 : 0) || (/Basic/.test(b.card.typeLine) ? 1 : 0) - (/Basic/.test(a.card.typeLine) ? 1 : 0))[0];
      if (pick) leaveBattlefield(s, pl, pick, 'hand', 'vuelve a la mano');
      return true;
    }
    case 'discover':
      if (pl.isBot) {
        const k = pl.library.findIndex((c) => !c.isLand && c.cmc <= e.amount);
        if (k >= 0) {
          const [c] = pl.library.splice(k, 1);
          pushEvent(s, 'info', `${pl.name} descubre ${displayName(c)} y la lanza gratis.`);
          if (c.isPermanent) enterPerm(s, pl, c);
          else { const fx2 = effectFx(c); resolveEffects(s, pl, c, fx2, autoTargets(s, pl, fx2.filter(needsTarget), null), null); pl.graveyard.push(stripCard(c)); }
        }
      } else tell(`descubre ${e.amount}: exilia cartas de arriba de tu biblioteca hasta una que no sea tierra con valor de maná ${e.amount} o menos. Puedes lanzarla gratis (pásala por el círculo) o ponerla en tu mano; el resto, debajo en orden aleatorio.`);
      return true;
    case 'incubate': {
      const tk = enterPerm(s, pl, { ...artifactTokenCard('Incubator'), printedName: 'Ficha de Incubadora', oracle: '{2}: Transform this artifact.', printedText: '{2}: transforma este artefacto (se convierte en una criatura artefacto Pirexiana 0/0 con sus contadores).' }, { from: '(incubar)' });
      tk.counters = e.amount === 'X' ? 0 : e.amount;
      return true;
    }
    case 'manifest': {
      if (pl.isBot && pl.library.length) {
        const c = pl.library.shift();
        const fd = { id: 'facedown:m', name: 'Face-down creature', printedName: 'Criatura boca abajo', image: null, manaCost: '', cmc: 0, typeLine: 'Creature', oracle: '', power: 2, toughness: 2, colors: [], keywords: [], isCreature: true, isPermanent: true, produces: [], effects: { etb: [], spell: [], dies: [] } };
        const np = enterPerm(s, pl, fd, { from: '(manifestada)' });
        np.faceDown = true; np.hidden = stripCard(c); np.morphCost = c.isCreature ? c.manaCost : null;
      } else if (!pl.isBot) {
        const fd = { id: 'facedown:m', name: 'Face-down creature', printedName: 'Criatura boca abajo', image: null, manaCost: '', cmc: 0, typeLine: 'Creature', oracle: '', power: 2, toughness: 2, colors: [], keywords: [], isCreature: true, isPermanent: true, produces: [], effects: { etb: [], spell: [], dies: [] } };
        const np = enterPerm(s, pl, fd, { from: '(manifestada)' });
        np.faceDown = true;
        tell(e.dread ? 'manifiesta el pavor: mira las 2 primeras cartas de tu biblioteca, pon una boca abajo en la mesa (ya está registrada como criatura 2/2) y la otra en tu cementerio.' : 'pon la primera carta de tu biblioteca boca abajo en la mesa (registrada como criatura 2/2).');
      }
      return true;
    }
    case 'earthbend':
      if (perm && perm.perm.card.isLand) {
        const l = perm.perm;
        l.card = { ...l.card, isCreature: true, power: 0, toughness: 0, typeLine: l.card.typeLine.replace(/^/, 'Creature ') };
        l.counters += e.amount === 'X' ? 0 : e.amount;
        l.eot = { ...(l.eot || {}), kw: ['haste'] };
        pushEvent(s, 'pump', `${name}: ${displayName(l.card)} se convierte en una criatura 0/0 con ${e.amount} contador${e.amount === 1 ? '' : 'es'} +1/+1 y prisa.`, { uid: l.uid });
      }
      return true;
    case 'regenHost': {
      const host = hostOf(s, source);
      if (host) { host.regen = true; pushEvent(s, 'info', `${displayName(host.card)} se regenerará la próxima vez que vaya a ser destruida.`, { uid: host.uid }); }
      return true;
    }
    case 'payOrSac':
      if (!source || !findPerm(s, source.uid)) return true;
      if (pl.isBot) {
        const plan = planPayment(pl, e.cost);
        if (plan) tapForPayment(pl, plan); else leaveBattlefield(s, pl, source, 'graveyard', 'se sacrifica (no paga)');
      } else {
        pl.pendingChoices = [...(pl.pendingChoices || []), { type: 'upkeep', uid: source.uid, cost: e.cost, name, what: 'pay' }];
      }
      return true;
    case 'addChosen': {
      const c = source && source.chosen && 'WUBRG'.includes(source.chosen) ? source.chosen : null;
      (pl.manaPool ||= []).push(...Array.from({ length: e.amount }, () => (c ? [c] : ['W', 'U', 'B', 'R', 'G'])));
      return true;
    }
    case 'win':
      pushEvent(s, 'info', `${name}: ¡${pl.name} gana la partida!`);
      for (const o of opponents(s, pl.id)) eliminate(s, o, `pierde por ${name}`);
      return true;
    default:
      return false;
  }
}

/** Vuelve a aplicar la habilidad «al entrar» de un permanente que reaparece (parpadeo). */
function resolveEtbOf(s, pl, perm) {
  const fx = perm.card.effects?.etb || [];
  if (!fx.length) return;
  const wanted = fx.filter(needsTarget);
  if (!wanted.length) resolveEffects(s, pl, perm.card, fx, [], perm);
  else if (pl.isBot) resolveEffects(s, pl, perm.card, fx, autoTargets(s, pl, wanted, perm), perm);
  else pl.pendingTriggers = [...(pl.pendingTriggers || []), { id: s.eventSeq + 1, uid: perm.uid, card: stripCard(perm.card), fx }];
}
