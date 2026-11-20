// IA sencilla para los bots. Dado un estado, devuelve LA siguiente acción que
// debería hacer algún bot (o null). El controlador la ejecuta con un pequeño
// retardo para que se vea lo que pasa en la mesa.

import {
  activePlayer, canAttack, canBlock, findPerm, has, opponents, pendingDefenders,
  planPayment, player, power, toughness,
} from './game.js';

export function nextBotAction(s) {
  if (s.winner) return null;

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
  }

  const me = activePlayer(s);
  if (!me.isBot) return null;

  switch (s.step) {
    case 'main1':
    case 'main2': {
      if (me.landsPlayed === 0) {
        const land = me.hand.find((c) => c.isLand);
        if (land) return { t: 'play', by: me.id, handUid: land.uid };
      }
      if (s.step === 'main1' || true) {
        const options = me.hand
          .filter((c) => !c.isLand && c.isPermanent && planPayment(me, c.manaCost))
          .sort((a, b) => b.cmc - a.cmc);
        const cmdCost = me.commander && me.commanderInZone && planPayment(me, me.commander.manaCost, me.commanderTax);
        if (cmdCost && (!options[0] || me.commander.cmc + me.commanderTax >= options[0].cmc)) {
          return { t: 'castCommander', by: me.id };
        }
        if (options[0]) return { t: 'play', by: me.id, handUid: options[0].uid };
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
      return pendingDefenders(s).length ? null : { t: 'next', by: me.id };
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
    const able = blockers.filter((b) => canBlock(b, att));
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
    .filter(([, t]) => t === me.id)
    .map(([u]) => findPerm(s, +u)?.perm)
    .filter(Boolean)
    .sort((a, b) => power(b) - power(a));
  const available = me.battlefield.filter((p) => p.card.isCreature && !p.tapped);
  const used = new Set();
  const out = [];
  let incoming = attackers.reduce((a, p) => a + power(p), 0);

  for (const att of attackers) {
    const cands = available.filter((b) => !used.has(b.uid) && canBlock(b, att));
    if (!cands.length) continue;
    const kills = (b) => power(b) >= toughness(att) || has(b, 'deathtouch');
    const survives = (b) => power(att) < toughness(b) && !has(att, 'deathtouch');
    let pick =
      cands.find((b) => kills(b) && survives(b)) ||
      cands.find((b) => survives(b)) ||
      cands.find((b) => kills(b) && b.card.cmc <= att.card.cmc);
    // bloqueo desesperado si el daño entrante es letal
    if (!pick && incoming >= me.life) pick = [...cands].sort((a, b) => a.card.cmc - b.card.cmc)[0];
    if (pick) {
      used.add(pick.uid);
      out.push([pick.uid, att.uid]);
      if (!has(att, 'trample')) incoming -= power(att);
    }
  }
  return out;
}
