// Motor de partida simplificado de Magic.
// Es un "reducer" puro: apply(state, action) -> nuevo estado. Así el mismo
// código sirve para jugar en local, contra bots y en red (el anfitrión manda).

import { pips } from './cards.js';
import { tokenCard, describeEffect, needsTarget } from './effects.js';

export const STEPS = ['untap', 'upkeep', 'draw', 'main1', 'attack', 'block', 'damage', 'main2', 'end'];

export const STEP_INFO = {
  untap: { name: 'Enderezar', group: 'Inicio', help: 'Endereza (pon en vertical) todas tus cartas giradas. Ya puedes volver a usar tus tierras y criaturas.' },
  upkeep: { name: 'Mantenimiento', group: 'Inicio', help: 'Se resuelven efectos de "al comienzo de tu mantenimiento". Normalmente no pasa nada: sigue.' },
  draw: { name: 'Robar', group: 'Inicio', help: 'Roba una carta de tu biblioteca (el jugador que empieza no roba en su primer turno).' },
  main1: { name: 'Fase principal 1', group: 'Principal', help: 'Puedes jugar UNA tierra por turno y lanzar criaturas, artefactos, encantamientos y conjuros pagando su coste de maná (gira tus tierras).' },
  attack: { name: 'Declarar atacantes', group: 'Combate', help: 'Toca las criaturas con las que quieres atacar. Se giran al atacar. Las que entraron este turno están "mareadas" y no pueden atacar (salvo con prisa).' },
  block: { name: 'Declarar bloqueadores', group: 'Combate', help: 'El defensor elige qué criaturas enderezadas bloquean a cada atacante. Una criatura sólo puede bloquear a un atacante.' },
  damage: { name: 'Daño de combate', group: 'Combate', help: 'Cada criatura hace daño igual a su fuerza. Si una criatura recibe daño igual o mayor a su resistencia, muere. El daño no bloqueado va al jugador.' },
  main2: { name: 'Fase principal 2', group: 'Principal', help: 'Otra fase principal: si no jugaste tierra, aún puedes. También puedes lanzar hechizos después de ver cómo fue el combate.' },
  end: { name: 'Final del turno', group: 'Final', help: 'Los efectos "hasta el final del turno" terminan y el daño a las criaturas se cura. Pasa el turno.' },
};

const MAX_EVENTS = 40;

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
 * players: [{ id, name, isBot, deck?: Card[], commander?: Card }]
 */
export function createGame({ mode = '1v1', players, seed = Date.now() }) {
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
    events: [],
    eventSeq: 0,
    log: [],
    winner: null,
  };
  s.players = players.map((p) => ({
    id: p.id,
    name: p.name,
    isBot: !!p.isBot,
    deckLabel: p.deckLabel || null,
    life: s.startingLife,
    poison: 0,
    cmdDamage: {},
    battlefield: [],
    graveyard: [],
    exile: [],
    hand: [],
    library: [],
    commander: null,
    commanderTax: 0,
    commanderInZone: false,
    landsPlayed: 0,
    eliminated: false,
  }));
  s.players.forEach((pl, i) => {
    const src = players[i];
    if (src.deck) {
      pl.library = shuffle(src.deck.map((c) => ({ ...c, uid: s.nextId++ })), rnd);
      for (let k = 0; k < 7; k++) drawCard(s, pl);
    }
    if (commander && src.commander) setCommander(s, pl, src.commander);
  });
  pushEvent(s, 'info', `¡Empieza la partida! Turno de ${s.players[0].name}.`);
  return s;
}

function emptyCombat() {
  return { attackers: {}, blocks: {}, confirmed: [], result: null };
}

// ---------------------------------------------------------------- utilidades

export const player = (s, id) => s.players.find((p) => p.id === id);
export const activePlayer = (s) => s.players[s.active];
export const alivePlayers = (s) => s.players.filter((p) => !p.eliminated);
export const opponents = (s, id) => s.players.filter((p) => p.id !== id && !p.eliminated);

export function findPerm(s, uid) {
  for (const p of s.players) {
    const perm = p.battlefield.find((x) => x.uid === uid);
    if (perm) return { perm, owner: p };
  }
  return null;
}

export function has(perm, kw) {
  return perm.card.keywords.includes(kw);
}

export function power(perm) {
  return (perm.card.power || 0) + perm.counters + perm.pump.p;
}
export function toughness(perm) {
  return (perm.card.toughness || 0) + perm.counters + perm.pump.t;
}

export function canAttack(s, perm) {
  if (!perm.card.isCreature || perm.tapped) return false;
  if (has(perm, 'defender')) return false;
  if (perm.sick && !has(perm, 'haste')) return false;
  return true;
}

export function canBlock(perm, attacker) {
  if (!perm.card.isCreature || perm.tapped) return false;
  if (/can.t block/i.test(perm.card.oracle)) return false;
  if (has(attacker, 'flying') && !has(perm, 'flying') && !has(perm, 'reach')) return false;
  return true;
}

function pushEvent(s, kind, text, extra = {}) {
  s.eventSeq += 1;
  s.events.push({ id: s.eventSeq, kind, text, ...extra });
  if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
  if (kind !== 'illegal') {
    s.log.push(text);
    if (s.log.length > 200) s.log.shift();
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
    pump: { p: 0, t: 0 },
    isCommander: false,
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

/**
 * Intenta pagar un coste girando fuentes. Devuelve la lista de uids a girar
 * o null si no alcanza. Simplificación: cada fuente produce 1 maná.
 */
export function planPayment(pl, cost, extraGeneric = 0) {
  // Preferimos girar tierras antes que criaturas (que podrían atacar).
  const sources = manaSources(pl).map((p) => ({ uid: p.uid, colors: p.card.produces, w: (p.card.isCreature ? 10 : 0) + p.card.produces.length }));
  const byCost = (a, b) => a.w - b.w;
  const used = new Set();
  let generic = extraGeneric;
  const colored = [];
  for (const p of pips(cost)) {
    if (/^\d+$/.test(p)) generic += parseInt(p, 10);
    else if (p === 'X') continue;
    else colored.push(p.split('/').filter((c) => 'WUBRGC'.includes(c)));
  }
  // Primero los colores más restringidos.
  colored.sort((a, b) => a.length - b.length);
  for (const opts of colored) {
    if (opts.length === 0) { generic += 1; continue; }
    const cand = sources
      .filter((src) => !used.has(src.uid) && src.colors.some((c) => opts.includes(c)))
      .sort(byCost)[0];
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
}

const isMain = (s) => s.step === 'main1' || s.step === 'main2';

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
  return out;
}

const HANDLERS = {
  /** Jugar una carta (física registrada, o de la mano del bot si trae uid). */
  play(s, a, pl) {
    let card = a.card;
    let fromHand = -1;
    if (a.handUid) {
      fromHand = pl.hand.findIndex((c) => c.uid === a.handUid);
      if (fromHand < 0) return s;
      card = pl.hand[fromHand];
    }
    if (!card) return s;
    const myTurn = s.players[s.active].id === pl.id;
    const sorcerySpeed = !card.isInstant && !/flash/i.test(card.keywords.join(' '));

    if (!a.force) {
      if (card.isLand) {
        if (!myTurn || !isMain(s)) return illegal(s, pl.id, 'Las tierras sólo se juegan en tu propio turno, durante una fase principal.', a);
        if (pl.landsPlayed >= 1) return illegal(s, pl.id, 'Sólo puedes jugar UNA tierra por turno.', a);
      } else if (sorcerySpeed && (!myTurn || !isMain(s))) {
        return illegal(
          s, pl.id,
          `${displayName(card)} es ${card.isSorcery ? 'un conjuro' : 'un permanente'}: sólo se lanza en tu turno, en una fase principal. Sólo los instantáneos (o cartas con destello) se pueden lanzar en cualquier momento.`,
          a,
        );
      }
    }
    if (!card.isLand) {
      const plan = planPayment(pl, card.manaCost);
      if (plan) tapForPayment(pl, plan);
      else if (!a.force) {
        return illegal(s, pl.id, `No tienes suficiente maná enderezado para pagar ${card.manaCost || '0'} (${card.cmc} en total). Gira tierras que produzcan el color correcto.`, a);
      }
    }
    if (fromHand >= 0) pl.hand.splice(fromHand, 1);

    if (card.isLand) pl.landsPlayed += 1;
    const verb = card.isLand ? 'juega' : 'lanza';
    let source = null;
    if (card.isPermanent) {
      const perm = makePerm(s, card, pl.id);
      pl.battlefield.push(perm);
      source = perm;
      pushEvent(s, 'play', `${pl.name} ${verb} ${displayName(card)}.`, { uid: perm.uid, by: pl.id, color: card.colors[0] || (card.produces[0]) || 'C' });
    } else {
      pl.graveyard.push(stripCard(card));
      pushEvent(s, 'spell', `${pl.name} lanza ${displayName(card)}. Al resolverse, va al cementerio.`, { by: pl.id, card: stripCard(card), color: card.colors[0] || 'C' });
    }
    const fx = card.isPermanent ? card.effects?.etb : card.effects?.spell;
    if (fx && fx.length) resolveEffects(s, pl, card, fx, a.targets || [], source);
    return s;
  },

  setCommander(s, a, pl) {
    setCommander(s, pl, a.card);
    pushEvent(s, 'info', `${pl.name} elige como comandante a ${displayName(a.card)}.`);
  },

  castCommander(s, a, pl) {
    if (!pl.commander || !pl.commanderInZone) return s;
    const myTurn = s.players[s.active].id === pl.id;
    if (!a.force && (!myTurn || !isMain(s))) return illegal(s, pl.id, 'El comandante es una criatura: se lanza en tu turno, en una fase principal.', a);
    const plan = planPayment(pl, pl.commander.manaCost, pl.commanderTax);
    if (plan) tapForPayment(pl, plan);
    else if (!a.force) return illegal(s, pl.id, `No tienes maná suficiente. Tu comandante cuesta ${pl.commander.manaCost}${pl.commanderTax ? ` + ${pl.commanderTax} de impuesto` : ''}.`, a);
    const perm = makePerm(s, pl.commander, pl.id);
    perm.isCommander = true;
    pl.battlefield.push(perm);
    pl.commanderInZone = false;
    pl.commanderTax += 2;
    pushEvent(s, 'play', `${pl.name} lanza a su comandante ${displayName(pl.commander)} desde la zona de mando.`, { uid: perm.uid, by: pl.id, color: pl.commander.colors[0] || 'C' });
  },

  tap(s, a) {
    const f = findPerm(s, a.uid);
    if (f) f.perm.tapped = a.value ?? !f.perm.tapped;
  },

  move(s, a, pl) {
    const f = findPerm(s, a.uid);
    if (!f) return s;
    leaveBattlefield(s, f.owner, f.perm, a.to);
  },

  life(s, a) {
    const t = player(s, a.target);
    if (!t) return s;
    t.life += a.delta;
    pushEvent(s, 'life', `${t.name} ${a.delta >= 0 ? 'gana' : 'pierde'} ${Math.abs(a.delta)} vida${Math.abs(a.delta) === 1 ? '' : 's'} (${t.life}).`, { target: t.id, delta: a.delta });
    checkDeaths(s);
  },

  poison(s, a) {
    const t = player(s, a.target);
    if (!t) return s;
    t.poison = Math.max(0, t.poison + a.delta);
    checkDeaths(s);
  },

  cmdDamage(s, a) {
    const t = player(s, a.target);
    if (!t) return s;
    t.cmdDamage[a.from] = Math.max(0, (t.cmdDamage[a.from] || 0) + a.delta);
    checkDeaths(s);
  },

  counter(s, a) {
    const f = findPerm(s, a.uid);
    if (!f) return s;
    f.perm.counters += a.delta;
    checkCreatureDeaths(s);
  },

  pump(s, a) {
    const f = findPerm(s, a.uid);
    if (!f) return s;
    f.perm.pump.p += a.p;
    f.perm.pump.t += a.t;
    pushEvent(s, 'pump', `${displayName(f.perm.card)} recibe ${fmt(a.p)}/${fmt(a.t)} hasta el final del turno.`, { uid: f.perm.uid });
    checkCreatureDeaths(s);
  },

  damage(s, a) {
    const f = findPerm(s, a.uid);
    if (!f) return s;
    f.perm.damage += a.amount;
    pushEvent(s, 'hit', `${displayName(f.perm.card)} recibe ${a.amount} de daño.`, { uid: f.perm.uid });
    checkCreatureDeaths(s);
  },

  draw(s, a, pl) {
    drawCard(s, pl);
  },

  attack(s, a, pl) {
    if (s.step !== 'attack' || activePlayer(s).id !== pl.id) return s;
    const f = findPerm(s, a.uid);
    if (!f || f.owner.id !== pl.id) return s;
    if (s.combat.attackers[a.uid]) {
      delete s.combat.attackers[a.uid];
      return s;
    }
    if (!canAttack(s, f.perm)) {
      const why = f.perm.tapped ? 'está girada' : f.perm.sick ? 'acaba de entrar y está mareada (necesita prisa para atacar este turno)' : 'no puede atacar';
      return illegal(s, pl.id, `${displayName(f.perm.card)} no puede atacar: ${why}.`);
    }
    const target = a.target && player(s, a.target) && !player(s, a.target).eliminated ? a.target : opponents(s, pl.id)[0]?.id;
    s.combat.attackers[a.uid] = target;
  },

  block(s, a, pl) {
    if (s.step !== 'block') return s;
    const bf = findPerm(s, a.uid);
    if (!bf || bf.owner.id !== pl.id) return s;
    if (s.combat.confirmed.includes(pl.id)) return s;
    // quitar bloqueo previo de esta criatura
    for (const k of Object.keys(s.combat.blocks)) {
      s.combat.blocks[k] = s.combat.blocks[k].filter((u) => u !== a.uid);
      if (!s.combat.blocks[k].length) delete s.combat.blocks[k];
    }
    if (a.attacker == null) return s;
    const af = findPerm(s, a.attacker);
    if (!af || s.combat.attackers[a.attacker] !== pl.id) return s;
    if (!canBlock(bf.perm, af.perm)) {
      const why = bf.perm.tapped ? 'está girada' : has(af.perm, 'flying') ? 'el atacante tiene vuela (sólo lo bloquean criaturas con vuela o alcance)' : 'no puede bloquear';
      return illegal(s, pl.id, `${displayName(bf.perm.card)} no puede bloquear: ${why}.`);
    }
    (s.combat.blocks[a.attacker] ||= []).push(a.uid);
  },

  confirmBlocks(s, a, pl) {
    if (s.step !== 'block') return s;
    if (!s.combat.confirmed.includes(pl.id)) s.combat.confirmed.push(pl.id);
    if (pendingDefenders(s).length === 0) enterStep(s, 'damage');
  },

  next(s, a, pl) {
    if (activePlayer(s).id !== pl.id && !a.force) return s;
    advance(s);
  },

  concede(s, a, pl) {
    eliminate(s, pl, 'se rinde');
  },
};

export function pendingDefenders(s) {
  const defenders = [...new Set(Object.values(s.combat.attackers))];
  return defenders.filter((id) => !s.combat.confirmed.includes(id) && !player(s, id).eliminated);
}

// ----------------------------------------------------------------- fases

function advance(s) {
  const step = s.step;
  if (step === 'attack') {
    if (Object.keys(s.combat.attackers).length === 0) return enterStep(s, 'main2');
    // girar atacantes
    for (const uid of Object.keys(s.combat.attackers)) {
      const f = findPerm(s, +uid);
      if (f && !has(f.perm, 'vigilance')) f.perm.tapped = true;
    }
    const n = Object.keys(s.combat.attackers).length;
    pushEvent(s, 'attack', `${activePlayer(s).name} ataca con ${n} criatura${n > 1 ? 's' : ''}.`, { uids: Object.keys(s.combat.attackers).map(Number) });
    return enterStep(s, 'block');
  }
  if (step === 'block') {
    if (pendingDefenders(s).length) return s;
    return enterStep(s, 'damage');
  }
  if (step === 'end') return passTurn(s);
  enterStep(s, STEPS[STEPS.indexOf(step) + 1]);
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
  for (const p of s.players) {
    for (const perm of p.battlefield) {
      perm.damage = 0;
      perm.pump = { p: 0, t: 0 };
    }
  }
  s.combat = emptyCombat();
}

function enterStep(s, step) {
  s.step = step;
  const pl = activePlayer(s);
  if (step === 'untap') {
    for (const perm of pl.battlefield) {
      perm.tapped = false;
      perm.sick = false;
    }
    pl.landsPlayed = 0;
  } else if (step === 'draw') {
    if (s.turn > 1 && pl.library.length) drawCard(s, pl);
  } else if (step === 'block') {
    s.combat.confirmed = [];
  } else if (step === 'damage') {
    resolveCombat(s);
  } else if (step === 'main2') {
    s.combat = emptyCombat();
  }
  return s;
}

// ---------------------------------------------------------------- combate

function resolveCombat(s) {
  const results = [];
  const lethalTo = (src, perm) => (has(src, 'deathtouch') ? 1 : Math.max(0, toughness(perm) - perm.damage));
  const dealt = []; // [perm, amount, sourcePerm]
  const toPlayer = []; // [playerId, amount, sourcePerm]

  for (const [uidStr, targetId] of Object.entries(s.combat.attackers)) {
    const uid = +uidStr;
    const af = findPerm(s, uid);
    if (!af) continue;
    const att = af.perm;
    const blockers = (s.combat.blocks[uid] || []).map((b) => findPerm(s, b)).filter(Boolean).map((f) => f.perm);
    let pow = power(att);
    if (blockers.length === 0) {
      toPlayer.push([targetId, pow, att]);
      results.push(`${displayName(att.card)} no es bloqueada y hace ${pow} de daño.`);
      continue;
    }
    for (const b of blockers) {
      const need = lethalTo(att, b);
      const amt = Math.min(pow, need);
      if (amt > 0) dealt.push([b, amt, att]);
      pow -= amt;
      dealt.push([att, power(b), b]);
    }
    if (pow > 0) {
      if (has(att, 'trample')) {
        toPlayer.push([targetId, pow, att]);
        results.push(`${displayName(att.card)} arrolla y hace ${pow} de daño al jugador.`);
      } else if (blockers.length) {
        dealt.push([blockers[0], pow, att]);
      }
    }
    results.push(`${displayName(att.card)} es bloqueada por ${blockers.map((b) => displayName(b.card)).join(' y ')}.`);
  }

  for (const [perm, amt, src] of dealt) {
    if (amt <= 0) continue;
    perm.damage += amt;
    if (has(src, 'deathtouch')) perm.deathtouched = true;
    if (has(src, 'lifelink')) player(s, src.ownerId).life += amt;
  }
  for (const [pid, amt, src] of toPlayer) {
    if (amt <= 0) continue;
    const t = player(s, pid);
    t.life -= amt;
    if (src.isCommander) t.cmdDamage[src.ownerId] = (t.cmdDamage[src.ownerId] || 0) + amt;
    if (has(src, 'lifelink')) player(s, src.ownerId).life += amt;
    pushEvent(s, 'life', `${t.name} recibe ${amt} de daño (${t.life}).`, { target: pid, delta: -amt });
  }
  s.combat.result = results;
  pushEvent(s, 'combat', results.join(' '));
  checkCreatureDeaths(s);
  checkDeaths(s);
}

// ------------------------------------------------------------- efectos

/**
 * Aplica las habilidades de una carta. targets: [{ uid } | { player }] en el
 * orden en que la carta los pide. Si falta un objetivo, avisa para hacerlo a mano.
 */
function resolveEffects(s, pl, card, fx, targets, source) {
  const name = displayName(card);
  let ti = 0;
  for (const e of fx) {
    let tgt = null;
    if (needsTarget(e)) {
      tgt = targets[ti++];
      if (!tgt) {
        if (pl.isBot) continue;
        pushEvent(s, 'manual', `${name} ${describeEffect(e)}: aplícalo a mano tocando el objetivo.`, { to: pl.id });
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
          perm.perm.damage += e.amount;
          pushEvent(s, 'hit', `${name} hace ${e.amount} de daño a ${displayName(perm.perm.card)}.`, { uid: perm.perm.uid });
        } else if (target) hurtPlayer(s, target, e.amount, name);
        break;
      case 'destroy':
        if (perm) leaveBattlefield(s, perm.owner, perm.perm, 'graveyard', 'es destruida');
        break;
      case 'pump':
        if (perm) {
          perm.perm.pump.p += e.p;
          perm.perm.pump.t += e.t;
          pushEvent(s, 'pump', `${displayName(perm.perm.card)} recibe ${e.p >= 0 ? '+' : ''}${e.p}/${e.t >= 0 ? '+' : ''}${e.t} hasta el final del turno.`, { uid: perm.perm.uid });
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
        pushEvent(s, 'draw', pl.isBot ? `${pl.name} roba ${e.amount} carta${e.amount > 1 ? 's' : ''}.` : `${name}: roba ${e.amount} carta${e.amount > 1 ? 's' : ''} de tu mazo.`, { to: pl.id, amount: e.amount });
        break;
      case 'token':
        for (let i = 0; i < e.amount; i++) {
          const perm2 = makePerm(s, tokenCard(e), pl.id);
          pl.battlefield.push(perm2);
          pushEvent(s, 'play', `${name} crea una ficha de ${e.subtype} ${e.power}/${e.toughness}.`, { uid: perm2.uid, by: pl.id, color: e.colors[0] || 'C' });
        }
        break;
      case 'regrow': {
        const idx = pl.graveyard.map((c, i) => [c, i]).filter(([c]) => c.isCreature).sort((x, y) => y[0].cmc - x[0].cmc)[0];
        if (idx) {
          const [c, i] = idx;
          pl.graveyard.splice(i, 1);
          if (pl.isBot) pl.hand.push({ ...c, uid: s.nextId++ });
          pushEvent(s, 'info', pl.isBot ? `${pl.name} recupera ${displayName(c)} de su cementerio.` : `${name}: coge ${displayName(c)} de tu cementerio y ponla en tu mano.`, { to: pl.id });
        }
        break;
      }
      default:
    }
  }
  checkCreatureDeaths(s);
  checkDeaths(s);
}

function hurtPlayer(s, t, amount, srcName) {
  t.life -= amount;
  pushEvent(s, 'life', `${srcName} hace ${amount} de daño a ${t.name} (${t.life}).`, { target: t.id, delta: -amount });
}

function checkCreatureDeaths(s) {
  for (const p of s.players) {
    for (const perm of [...p.battlefield]) {
      if (!perm.card.isCreature) continue;
      if (toughness(perm) <= 0 || perm.damage >= toughness(perm) || (perm.deathtouched && perm.damage > 0)) {
        leaveBattlefield(s, p, perm, 'graveyard', 'muere');
      }
    }
  }
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
    return;
  }
  if (perm.card.isToken) {
    pushEvent(s, 'death', `${name} desaparece (las fichas dejan de existir fuera del campo de batalla).`, { uid: perm.uid });
    return;
  }
  if (to === 'graveyard') owner.graveyard.push(perm.card);
  else if (to === 'exile') owner.exile.push(perm.card);
  else if (to === 'hand' && owner.isBot) owner.hand.push({ ...perm.card, uid: perm.uid });
  else if (to === 'library' && owner.isBot) owner.library.unshift({ ...perm.card, uid: perm.uid });
  const where = { graveyard: 'al cementerio', exile: 'al exilio', hand: 'a la mano', library: 'a la biblioteca' }[to];
  pushEvent(s, 'death', `${name} ${verb ? verb + ' y va' : 'va'} ${where}.`, { uid: perm.uid, to });
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
  for (const k of Object.keys(s.combat.attackers)) if (s.combat.attackers[k] === p.id) delete s.combat.attackers[k];
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
