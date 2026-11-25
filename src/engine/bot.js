// IA sencilla para los bots. Dado un estado, devuelve LA siguiente acción que
// debería hacer algún bot (o null). El controlador la ejecuta con un pequeño
// retardo para que se vea lo que pasa en la mesa.

import { targetsFor, effectFx } from './effects.js';
import {
  activePlayer, canAttack, canBlock, canTarget, combatReadyPending, defenderOf, findPerm, has, opponents,
  pendingDefenders, planPayment, player, power, stackTop, toughness, permMatches, landLimit,
} from './game.js';

const smart = (pl) => pl.level !== 'easy';

export function nextBotAction(s) {
  if (s.winner) return null;

  // 0) La pila: el bot al que le toca responder decide (responder o pasar).
  const top = stackTop(s);
  if (top) {
    const id = top.waiting[0];
    const pl = id && player(s, id);
    if (!pl || !pl.isBot) return null; // le toca a un humano
    return respond(s, pl, top) || { t: 'pass', by: pl.id };
  }

  // 1) Bots que tienen que bloquear
  if (s.step === 'block') {
    for (const id of pendingDefenders(s)) {
      const pl = player(s, id);
      if (!pl.isBot) continue;
      const blocks = chooseBlocks(s, pl);
      const current = currentBlocks(s, pl.id);
      for (const [blocker, attacker] of blocks) {
        if (current.get(blocker) !== attacker) return { t: 'block', by: pl.id, uid: blocker, attacker };
      }
      return { t: 'confirmBlocks', by: pl.id };
    }
    // Trucos de combate tras los bloqueos (cualquier bot implicado).
    if (!pendingDefenders(s).length) {
      for (const pl of s.players) {
        if (!pl.isBot || pl.eliminated || !smart(pl)) continue;
        const trick = combatTrick(s, pl);
        if (trick) return trick;
      }
    }
  }

  const me = activePlayer(s);
  if (!me.isBot) return null;

  switch (s.step) {
    case 'main1':
    case 'main2': {
      const fromExile = me.exile.filter((c) => c.playable);
      if (me.landsPlayed < landLimit(me)) {
        // primero la tierra exiliada que caduca; luego la de la mano
        const exLand = fromExile.find((c) => c.isLand && !c.playable.cast);
        if (exLand) return { t: 'play', by: me.id, card: { ...exLand, fromExile: true } };
        const land = me.hand.find((c) => c.isLand);
        if (land) return { t: 'play', by: me.id, handUid: land.uid };
      }
      // Hechizos útiles (eliminar, quemar, robar...) y criaturas, de mayor a menor coste.
      const options = [];
      for (const c0 of me.hand) {
        if (c0.isLand || !planPayment(me, c0.manaCost)) continue;
        // modos: los primeros que tengan objetivos buenos
        let c = c0;
        let modes = null;
        if (c0.effects?.modes) {
          const k = Math.abs(c0.effects.choose || 1);
          modes = c0.effects.modes.map((m, i) => [m, i]).filter(([m]) => m.fx.length && !chooseTargets(s, me, m.fx.filter((e) => ['any', 'creature', 'permanent', 'player', 'spell'].includes(e.target))).includes(null)).slice(0, k).map(([, i]) => i);
          if (!modes.length) continue;
          c = { ...c0, chosenModes: modes };
        }
        const wanted = targetsFor(c);
        const targets = chooseTargets(s, me, wanted);
        if (!c.isPermanent && (!usefulSpell(c) || targets.includes(null))) continue;
        options.push({ c, modes, targets: targets.filter(Boolean), score: c.cmc + (c.isPermanent ? 0 : 3) });
      }
      for (const c of fromExile) {
        if (c.isLand || !planPayment(me, c.manaCost)) continue;
        const targets = chooseTargets(s, me, targetsFor(c));
        if (!c.isPermanent && (!usefulSpell(c) || targets.includes(null))) continue;
        options.push({ c, ex: true, targets: targets.filter(Boolean), score: c.cmc + (c.isPermanent ? 0 : 3) + 2 });
      }
      options.sort((a, b) => b.score - a.score);
      // Equipar un equipo suelto a la mejor criatura (si no hay nada mejor que lanzar)
      if (!options[0]) {
        const crs = me.battlefield.filter((p) => p.card.isCreature).sort((a, b) => power(b) + toughness(b) - power(a) - toughness(a));
        const eq = me.battlefield.find((p) => p.card.attach?.equip && (p.attachedTo == null || !crs.some((c) => c.uid === p.attachedTo)) && planPayment(me, p.card.attach.equip));
        if (eq && crs[0]) return { t: 'equip', by: me.id, uid: eq.uid, target: crs[0].uid };
      }
      const cmdCost = me.commander && me.commanderInZone && planPayment(me, me.commander.manaCost, me.commanderTax);
      if (cmdCost && (!options[0] || me.commander.cmc + me.commanderTax >= options[0].c.cmc)) {
        return { t: 'castCommander', by: me.id };
      }
      if (options[0]?.ex) return { t: 'play', by: me.id, card: { ...options[0].c, fromExile: true }, targets: options[0].targets };
      if (options[0]) {
        const c = options[0].c;
        let x;
        if (/\{X\}/.test(c.manaCost || '')) {
          // X = todo el maná que sobra
          let lo = 0;
          for (let v = 1; v <= 12; v++) if (planPayment(me, c.manaCost, v)) lo = v;
          x = lo;
        }
        return { t: 'play', by: me.id, handUid: c.uid, targets: options[0].targets, ...(options[0].modes ? { modes: options[0].modes } : {}), ...(x != null ? { x } : {}) };
      }
      return { t: 'next', by: me.id };
    }
    case 'attack': {
      const chosen = chooseAttackers(s, me);
      for (const [uid, target] of chosen) {
        if (s.combat.attackers[uid] !== target) return { t: 'attack', by: me.id, uid, target };
      }
      return { t: 'next', by: me.id };
    }
    case 'block':
      // Espera a que los defensores humanos digan si usan trucos de combate.
      return pendingDefenders(s).length || combatReadyPending(s).length ? null : { t: 'next', by: me.id };
    default:
      return { t: 'next', by: me.id };
  }
}

function currentBlocks(s, defenderId) {
  const m = new Map();
  for (const [att, list] of Object.entries(s.combat.blocks)) {
    for (const b of list) {
      const f = findPerm(s, b);
      if (f && f.owner.id === defenderId) m.set(b, +att);
    }
  }
  return m;
}

function chooseAttackers(s, me) {
  const opps = opponents(s, me.id);
  if (!opps.length) return [];
  // objetivo: el rival con menos vida
  const target = [...opps].sort((a, b) => a.life - b.life)[0];
  const blockers = target.battlefield.filter((p) => p.card.isCreature && !p.tapped);
  const mine = me.battlefield.filter((p) => canAttack(s, p));
  const out = [];

  // ¿Ataque total letal? (suponiendo que sus bloqueadores paran a los más fuertes)
  const powers = mine.map(power).sort((a, b) => b - a);
  const unblockedDamage = powers.slice(blockers.length).reduce((a, b) => a + b, 0);
  if (mine.length && unblockedDamage >= target.life) return mine.map((p) => [p.uid, target.id]);

  for (const att of mine) {
    const able = blockers.filter((b) => canBlock(b, att, s));
    const killers = able.filter((b) => power(b) >= toughness(att) || has(b, 'deathtouch'));
    const safe = killers.length === 0;
    // intercambio favorable: muere pero se lleva algo igual o mejor
    const goodTrade = killers.every((b) => power(att) >= toughness(b) && b.card.cmc >= att.card.cmc);
    if (power(att) > 0 && (safe || (goodTrade && killers.length === 1))) out.push([att.uid, target.id]);
  }
  return out;
}

function chooseBlocks(s, me) {
  const attackers = Object.entries(s.combat.attackers)
    .filter(([, t]) => defenderOf(s, t) === me.id)
    .map(([u]) => findPerm(s, +u)?.perm)
    .filter(Boolean)
    .sort((a, b) => power(b) - power(a));
  const available = me.battlefield.filter((p) => p.card.isCreature && !p.tapped);
  const used = new Set();
  const out = [];
  let incoming = attackers.reduce((a, p) => a + power(p), 0);

  for (const att of attackers) {
    const cands = available.filter((b) => !used.has(b.uid) && canBlock(b, att, s));
    if (!cands.length) continue;
    const kills = (b) => power(b) >= toughness(att) || has(b, 'deathtouch');
    const survives = (b) => power(att) < toughness(b) && !has(att, 'deathtouch');
    let pick =
      cands.find((b) => kills(b) && survives(b)) ||
      cands.find((b) => survives(b)) ||
      cands.find((b) => kills(b) && b.card.cmc <= att.card.cmc);
    // bloqueo desesperado si el daño entrante es letal
    if (!pick && incoming >= me.life) pick = [...cands].sort((a, b) => a.card.cmc - b.card.cmc)[0];
    if (pick && has(att, 'menace')) {
      // Amenaza: hacen falta dos bloqueadores; si no hay segundo, no se bloquea.
      const second = cands.find((b) => b !== pick && !used.has(b.uid));
      if (!second) continue;
      used.add(second.uid);
      out.push([second.uid, att.uid]);
    }
    if (pick) {
      used.add(pick.uid);
      out.push([pick.uid, att.uid]);
      if (!has(att, 'trample')) incoming -= power(att);
    }
  }
  return out;
}

// ------------------------------------------------------------ objetivos

/** ¿Merece la pena lanzar este hechizo ahora? (los trucos de combate se guardan) */
function usefulSpell(card) {
  const fx = effectFx(card);
  return fx.length > 0 && !fx.some((e) => (e.kind === 'pump' && e.t >= 0) || e.kind === 'counterspell');
}

const affordable = (pl, c) => !c.isLand && planPayment(pl, c.manaCost);
const instants = (pl) => pl.hand.filter((c) => (c.isInstant || c.keywords.includes('flash')) && affordable(pl, c));

/** ¿Responde el bot a lo que hay en la pila? */
function respond(s, pl, top) {
  if (!smart(pl) || top.by === pl.id) return null;
  const card = top.card;
  const hand = instants(pl);
  // a) Contrahechizo contra algo que merezca la pena
  const counter = hand.find((c) => (c.effects?.spell || []).some((e) => e.kind === 'counterspell'));
  const threatens = (top.targets || []).some((t) => t.player === pl.id || (t.uid != null && findPerm(s, t.uid)?.owner.id === pl.id));
  if (counter && pl.level === 'hard' && (card.cmc >= 3 || threatens)) return { t: 'play', by: pl.id, handUid: counter.uid, targets: [{ stack: top.id }] };
  // b) Salvar a una criatura propia con un +X/+X si el daño la iba a matar
  const dmg = (card.effects?.spell || []).find((e) => e.kind === 'damage');
  const t0 = (top.targets || [])[0];
  if (dmg && t0 && t0.uid != null) {
    const f = findPerm(s, t0.uid);
    if (f && f.owner.id === pl.id) {
      const pump = !has(f.perm, 'shroud') && hand.find((c) => (c.effects?.spell || []).some((e) => e.kind === 'pump' && e.t > 0 && toughness(f.perm) - f.perm.damage + e.t > dmg.amount));
      if (pump) return { t: 'play', by: pl.id, handUid: pump.uid, targets: [{ uid: f.perm.uid }] };
    }
  }
  return null;
}

/** Truco de combate: un +X/+X que cambia el resultado de un combate en el que está el bot. */
function combatTrick(s, pl) {
  const pumps = instants(pl).filter((c) => (c.effects?.spell || []).some((e) => e.kind === 'pump' && e.t > 0));
  if (!pumps.length) return null;
  for (const [attUid, list] of Object.entries(s.combat.blocks)) {
    const att = findPerm(s, +attUid)?.perm;
    if (!att) continue;
    const blockers = list.map((u) => findPerm(s, u)?.perm).filter(Boolean);
    const mine = att.ownerId === pl.id ? [att] : blockers.filter((b) => b.ownerId === pl.id);
    const foes = att.ownerId === pl.id ? blockers : [att];
    for (const c of mine) {
      const incoming = foes.reduce((a, f) => a + power(f), 0);
      const dies = incoming >= toughness(c) - c.damage || foes.some((f) => has(f, 'deathtouch'));
      if (!dies) continue;
      if (has(c, 'shroud')) continue; // velo: ni sus propios hechizos pueden apuntarla
      for (const card of pumps) {
        const e = card.effects.spell.find((x) => x.kind === 'pump');
        if (incoming < toughness(c) - c.damage + e.t && !foes.some((f) => has(f, 'deathtouch'))) {
          return { t: 'play', by: pl.id, handUid: card.uid, targets: [{ uid: c.uid }] };
        }
      }
    }
  }
  return null;
}

/** Elige objetivos para cada efecto que lo pide; null si no hay uno bueno. */
export function chooseTargets(s, me, wanted) {
  const opps = opponents(s, me.id);
  const foeCreatures = opps.flatMap((o) => o.battlefield.filter((p) => p.card.isCreature && canTarget(s, me.id, p, o)));
  const weakest = [...opps].sort((a, b) => a.life - b.life)[0];
  const value = (p) => power(p) * 2 + toughness(p) + p.card.cmc + (p.isCommander ? 5 : 0);
  return wanted.map((e) => {
    if (e.kind === 'damage') {
      const killable = foeCreatures.filter((p) => (!e.filter || permMatches(s, e.filter, p, p.ownerId, me.id)) && toughness(p) - p.damage <= e.amount && !p.card.keywords.includes('indestructible'));
      const best = killable.sort((a, b) => value(b) - value(a))[0];
      if (e.target === 'player') return weakest ? { player: weakest.id } : null;
      if (best && (e.target === 'creature' || value(best) >= 6 || (weakest && weakest.life > e.amount))) return { uid: best.uid };
      if (e.target === 'any' && weakest) return { player: weakest.id };
      return null;
    }
    if (e.kind === 'destroy' || e.kind === 'bounce' || e.kind === 'exile') {
      const pool = opps.flatMap((o) => o.battlefield.filter((p) => permMatches(s, e.filter, p, o.id, me.id) && canTarget(s, me.id, p, o)));
      const val = (p) => (p.card.isCreature ? value(p) : p.card.cmc + 2);
      const best = [...pool].sort((a, b) => val(b) - val(a))[0];
      return best ? { uid: best.uid } : null;
    }
    if (e.kind === 'pump' && e.t < 0) {
      const killable = foeCreatures.filter((p) => toughness(p) + e.t <= p.damage).sort((a, b) => value(b) - value(a));
      return killable[0] ? { uid: killable[0].uid } : null;
    }
    if (e.kind === 'tap' || e.kind === 'untap') {
      const own = e.kind === 'untap';
      const pool = own ? me.battlefield.filter((p) => p.tapped && permMatches(s, e.filter, p, me.id, me.id) && canTarget(s, me.id, p, me))
        : opps.flatMap((o) => o.battlefield.filter((p) => !p.tapped && permMatches(s, e.filter, p, o.id, me.id) && canTarget(s, me.id, p, o)));
      const best = [...pool].sort((a, b) => (b.card.isCreature ? value(b) : 0) - (a.card.isCreature ? value(a) : 0))[0];
      return best ? { uid: best.uid } : null;
    }
    if (e.kind === 'aura') {
      // aura que perjudica (p. ej. −X/−X o «no puede atacar») → a una criatura rival
      const bad = /can.t (attack|block)|gets -|doesn.t untap|tap enchanted/i.test(e.oracle || '');
      const pool = bad ? foeCreatures : me.battlefield.filter((p) => p.card.isCreature && !has(p, 'shroud'));
      const best = [...pool].sort((a, b) => value(b) - value(a))[0];
      return best ? { uid: best.uid, attach: true } : null;
    }
    if (e.kind === 'counter') {
      const mine = me.battlefield.filter((p) => p.card.isCreature && !has(p, 'shroud')).sort((a, b) => power(b) - power(a))[0];
      return mine ? { uid: mine.uid } : null;
    }
    return null;
  });
}
