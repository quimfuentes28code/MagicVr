// Motor de reglas de Magic.
// Es un "reducer" puro: apply(state, action) -> nuevo estado. Así el mismo
// código sirve para jugar en local, contra bots y en red (el anfitrión manda).
//
// Sigue la estructura oficial del turno (reglas 500-514), la pila y la
// prioridad (405, 117), el combate con dañar primero (510) y las acciones
// basadas en estado más comunes (704). Las habilidades se leen del texto
// oficial (effects.js); lo que no se reconoce se aplica a mano.

import { pips } from './cards.js';
import { tokenCard, describeEffect, needsTarget, parseAttach, describeAttach } from './effects.js';

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
  return perm.card.keywords.includes(kw) || !!(perm.bonus && perm.bonus.kw.includes(kw));
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
      const b = (f.perm.bonus ||= { p: 0, t: 0, kw: [], types: [], from: [] });
      b.from.push(perm.uid);
      for (const m of att?.mods || []) {
        if (m.myTurn && active !== p.id) continue;
        b.p += m.p; b.t += m.t;
        for (const k of m.kw) if (!b.kw.includes(k)) b.kw.push(k);
        for (const t of m.types) if (!b.types.includes(t)) b.types.push(t);
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

export function canAttack(s, perm) {
  if (!perm.card.isCreature || perm.tapped) return false;
  if (has(perm, 'defender') || /can.t attack/i.test(perm.card.oracle)) return false;
  if (perm.sick && !has(perm, 'haste')) return false;
  return true;
}

export function canBlock(perm, attacker) {
  if (!perm.card.isCreature || perm.tapped) return false;
  if (/can.t block/i.test(perm.card.oracle)) return false;
  if (has(attacker, 'flying') && !has(perm, 'flying') && !has(perm, 'reach')) return false;
  if (unblockable(attacker)) return false;
  if (protectedFrom(attacker, perm.card.colors, true)) return false;
  return true;
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

/** Fuentes de maná enderezadas de un jugador. */
export function manaSources(pl) {
  return pl.battlefield.filter(
    (p) => !p.tapped && p.card.produces.length > 0 && (p.card.isLand || !p.card.isCreature || !p.sick),
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
export function planPayment(pl, cost, extraGeneric = 0) {
  // Primero el maná que ya está en la reserva (tierras giradas a mano); luego
  // tierras enderezadas, y las criaturas de maná en último lugar.
  const sources = [
    ...(pl.manaPool || []).map((colors, i) => ({ uid: 'pool:' + i, colors, w: -10 + colors.length })),
    ...manaSources(pl).map((p) => ({ uid: p.uid, colors: p.card.produces, w: (p.card.isCreature ? 10 : 0) + p.card.produces.length })),
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
  // ¿Siguen siendo legales sus objetivos? (regla 608.2b)
  const fx = card.isPermanent ? card.effects?.etb || [] : card.effects?.spell || [];
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
        pushEvent(s, 'pump', `${name} encanta a ${displayName(tf.perm.card)}${describeAttach(attachOf(card)) ? ': ' + describeAttach(attachOf(card)) : ''}.`, { uid: tf.perm.uid });
      }
    }
    refreshStatics(s);
    stateBased(s);
    if (fx.length) resolveEffects(s, pl, card, fx, (item.targets || []).filter((t) => !t.attach), perm);
  } else {
    pushEvent(s, 'resolve', `${name} se resuelve.`, { by: pl.id, card: stripCard(card), color: card.colors[0] || 'C' });
    if (fx.length) resolveEffects(s, pl, card, fx, item.targets || [], null);
    if (card.adventureOf) {
      // Aventura (regla 715.4): se exilia y luego se puede lanzar la criatura desde el exilio.
      pl.exile.push({ ...stripCard(card.adventureOf), onAdventure: true });
      pushEvent(s, 'info', `${displayName(card.adventureOf)} se va de aventura: queda exiliada y más adelante puedes lanzar la criatura desde el exilio (pon la carta en el círculo y elige la criatura).`, { to: pl.id });
    } else pl.graveyard.push(stripCard(card));
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
    const myTurn = activePlayer(s).id === pl.id;
    const stackEmpty = s.stack.length === 0;

    if (!a.force) {
      if (card.isLand) {
        if (!myTurn || !isMain(s) || !stackEmpty) return illegal(s, pl.id, 'Las tierras sólo se juegan en tu propio turno, en una fase principal y con la pila vacía.', a);
        if (pl.landsPlayed >= 1) return illegal(s, pl.id, 'Sólo puedes jugar UNA tierra por turno.', a);
      } else if (!speedOK(card) && (!myTurn || !isMain(s) || !stackEmpty)) {
        return illegal(s, pl.id,
          `${displayName(card)} es ${card.isSorcery ? 'un conjuro' : 'un permanente'}: sólo se lanza en tu turno, en una fase principal y con la pila vacía. Sólo los instantáneos (o cartas con destello) se pueden lanzar en cualquier momento, también en respuesta.`,
          a);
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
    if (!card.isLand) {
      const plan = planPayment(pl, card.manaCost);
      if (plan) tapForPayment(pl, plan);
      else if (!a.force) {
        const m = manaAvailable(pl);
        return illegal(s, pl.id, `No te llega el maná para ${displayName(card)}: cuesta ${card.manaCost || '0'} (${card.cmc} en total) y tienes ${m.total} disponible${m.total === 1 ? '' : 's'} (${m.pool} en la reserva + ${m.total - m.pool} en tierras sin girar)${m.total >= card.cmc ? ', pero no del color necesario' : ''}. Recuerda: la app gira tus tierras sola al pagar; si las giras tú a mano, su maná va a tu reserva hasta que cambie la fase.`, a);
      }
    }
    if (fromHand >= 0) pl.hand.splice(fromHand, 1);
    else if (card.fromAdventure) {
      // lanzada desde el exilio tras su aventura: sale del exilio (no de la mano)
      const i = pl.exile.findIndex((c) => c.onAdventure && c.id === card.id);
      if (i >= 0) pl.exile.splice(i, 1);
    } else if (!pl.isBot && !a.fromCommand && pl.handCount > 0) pl.handCount -= 1;

    // Las tierras no usan la pila (regla 305.1).
    if (card.isLand) {
      pl.landsPlayed += 1;
      const perm = makePerm(s, card, pl.id);
      pl.battlefield.push(perm);
      pushEvent(s, 'play', `${pl.name} juega ${displayName(card)}.`, { uid: perm.uid, by: pl.id, color: card.produces[0] || 'C' });
      stateBased(s);
      return s;
    }
    pushStack(s, { by: pl.id, card: stripCard(card), targets: a.targets || [] });
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
    if (!canBlock(bf.perm, af.perm)) {
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
    return enterStep(s, 'block');
  }
  if (step === 'block') {
    if (pendingDefenders(s).length) return s;
    const anyFirst = Object.keys(s.combat.attackers).some((u) => { const f = findPerm(s, +u); return f && firstStriker(f.perm); })
      || Object.values(s.combat.blocks).flat().some((u) => { const f = findPerm(s, u); return f && firstStriker(f.perm); });
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
  do i = (i + 1) % s.players.length;
  while (s.players[i].eliminated);
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
  for (const p of s.players) {
    for (const perm of p.battlefield) {
      perm.damage = 0;
      perm.deathtouched = false;
      perm.pump = { p: 0, t: 0 };
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
      perm.tapped = false;
      perm.sick = false;
    }
    pl.landsPlayed = 0;
  } else if (step === 'draw') {
    // 103.8a: en partidas de dos jugadores, quien empieza no roba en su primer turno.
    // 103.8c: en el resto de multijugador, todos roban.
    if (s.turn > 1 || s.players.length > 2) {
      if (pl.isBot && pl.library.length) drawCard(s, pl);
      else if (pl.isBot && !pl.library.length) eliminate(s, pl, 'tiene que robar y no le quedan cartas');
      if (!pl.isBot) { pl.handCount += 1; pushEvent(s, 'draw', 'Paso de robar: roba una carta de tu mazo.', { to: pl.id, amount: 1 }); }
    }
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
function resolveEffects(s, pl, card, fx, targets, source) {
  const name = displayName(card);
  const since = s.eventSeq;
  try {
    resolveEffectsInner(s, pl, card, fx, targets, name);
  } finally {
    // Los efectos llevan el color de la carta: la mesa dibuja el hechizo (rayo, fuego, agua…).
    const spell = { colors: card.colors.length ? card.colors.slice(0, 3) : ['C'], by: pl.id, src: source ? source.uid : null };
    for (const ev of s.events) if (ev.id > since && !ev.spell) ev.spell = spell;
  }
  stateBased(s);
}

function resolveEffectsInner(s, pl, card, fx, targets, name) {
  let ti = 0;
  for (const e of fx) {
    let tgt = null;
    if (needsTarget(e)) {
      tgt = targets[ti++];
      if (!tgt || !targetStillLegal(s, pl.id, tgt)) {
        if (!pl.isBot && !tgt) pushEvent(s, 'manual', `${name} ${describeEffect(e)}: aplícalo a mano tocando el objetivo.`, { to: pl.id });
        continue;
      }
    }
    const perm = tgt && tgt.uid != null ? findPerm(s, tgt.uid) : null;
    const target = tgt && tgt.player ? player(s, tgt.player) : null;
    switch (e.kind) {
      case 'damage':
        if (e.target === 'opponents') {
          for (const o of opponents(s, pl.id)) hurtPlayer(s, o, e.amount, name);
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
      case 'pump':
        if (perm) {
          perm.perm.pump.p += e.p;
          perm.perm.pump.t += e.t;
          pushEvent(s, 'pump', `${displayName(perm.perm.card)} recibe ${fmt(e.p)}/${fmt(e.t)} hasta el final del turno.`, { uid: perm.perm.uid });
        }
        break;
      case 'bounce':
        if (perm) leaveBattlefield(s, perm.owner, perm.perm, 'hand', 'vuelve a la mano');
        break;
      case 'counter':
        if (perm) {
          perm.perm.counters += 1;
          pushEvent(s, 'pump', `${displayName(perm.perm.card)} recibe un contador +1/+1.`, { uid: perm.perm.uid });
        }
        break;
      case 'counterspell': {
        const idx = s.stack.findIndex((x) => x.id === tgt.stack);
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
        for (const o of opponents(s, pl.id)) {
          o.life -= e.amount;
          pushEvent(s, 'life', `${o.name} pierde ${e.amount} vidas (${o.life}).`, { target: o.id, delta: -e.amount });
        }
        break;
      case 'gain':
        pl.life += e.amount;
        pushEvent(s, 'life', `${pl.name} gana ${e.amount} vidas (${pl.life}).`, { target: pl.id, delta: e.amount });
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
          pl.battlefield.push(perm2);
          pushEvent(s, 'play', `${name} crea una ${perm2.card.printedName.toLowerCase()} ${e.power}/${e.toughness}.`, { uid: perm2.uid, by: pl.id, color: e.colors[0] || 'C', token: true });
        }
        break;
      case 'regrow': {
        const idx = pl.graveyard.map((c, i) => [c, i]).filter(([c]) => c.isCreature).sort((x, y) => y[0].cmc - x[0].cmc)[0];
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
    }
  }
}

function hurtPlayer(s, t, amount, srcName) {
  t.life -= amount;
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
