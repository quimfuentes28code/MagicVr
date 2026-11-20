import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, apply, findPerm, planPayment } from '../src/engine/game.js';
import { nextBotAction } from '../src/engine/bot.js';
import { buildBotDeck, localCard, BASICS, BOT_DECKS } from '../src/engine/cards.js';

function runBots(s, max = 5000) {
  let n = 0;
  while (!s.winner && n++ < max) {
    const a = nextBotAction(s);
    if (!a) break;
    s = apply(s, a);
  }
  return s;
}

test('dos bots juegan una partida 1v1 hasta el final', () => {
  let s = createGame({ mode: '1v1', seed: 42, players: [
    { id: 'a', name: 'Bot A', isBot: true, deck: buildBotDeck('G', 40) },
    { id: 'b', name: 'Bot B', isBot: true, deck: buildBotDeck('R', 40) },
  ] });
  s = runBots(s);
  assert.ok(s.winner, 'debe haber ganador. Paso: ' + s.step + ' turno ' + s.turn);
});

test('commander con 4 bots termina', () => {
  const cols = ['G', 'R', 'W', 'B'];
  let s = createGame({ mode: 'commander', seed: 7, players: cols.map((c, i) => ({
    id: 'p' + i, name: 'Bot ' + c, isBot: true, deck: buildBotDeck(c, 99), commander: localCard(BOT_DECKS[c].commander),
  })) });
  assert.equal(s.players[0].life, 40);
  s = runBots(s, 20000);
  assert.ok(s.winner, 'ganador en commander, turno ' + s.turn);
});

test('jugador humano: tierra, criatura, mareo y combate', () => {
  let s = createGame({ mode: '1v1', seed: 1, players: [
    { id: 'h', name: 'Yo' },
    { id: 'b', name: 'Bot', isBot: true, deck: buildBotDeck('W', 40) },
  ] });
  s = apply(s, { t: 'play', by: 'h', card: BASICS.G });
  s = apply(s, { t: 'play', by: 'h', card: BASICS.G });
  assert.equal(s.events.at(-1).kind, 'illegal');
  s = apply(s, { t: 'play', by: 'h', card: localCard('Grizzly Bears') });
  assert.equal(s.events.at(-1).kind, 'illegal'); // falta maná
  s = apply(s, { t: 'play', by: 'h', card: localCard('Llanowar Elves') });
  assert.equal(s.players[0].battlefield.length, 2);
  assert.equal(s.players[0].battlefield[0].tapped, true);
  const elf = s.players[0].battlefield[1].uid;
  s = apply(s, { t: 'next', by: 'h' }); // attack
  s = apply(s, { t: 'attack', by: 'h', uid: elf });
  assert.equal(s.events.at(-1).kind, 'illegal'); // mareada
  assert.ok(planPayment(s.players[0], '{G}') === null);
});

test('pagar maná prefiere tierras antes que criaturas', () => {
  let s = createGame({ mode: '1v1', seed: 1, players: [{ id: 'h', name: 'Yo' }, { id: 'b', name: 'Bot', isBot: true, deck: buildBotDeck('W', 40) }] });
  s = apply(s, { t: 'play', by: 'h', card: localCard('Llanowar Elves'), force: true });
  s.players[0].battlefield[0].sick = false;
  s = apply(s, { t: 'play', by: 'h', card: BASICS.G });
  s = apply(s, { t: 'play', by: 'h', card: localCard('Giant Growth') });
  const [elf, forest] = s.players[0].battlefield;
  assert.equal(elf.tapped, false);
  assert.equal(forest.tapped, true);
});

test('habilidades automáticas: Rayo, Asesinato, Dar la alarma, Desfigurar, Adivinación', () => {
  let s = createGame({ mode: '1v1', seed: 3, players: [{ id: 'h', name: 'Yo' }, { id: 'b', name: 'Bot', isBot: true, deck: buildBotDeck('G') }] });
  const bot = () => s.players[1];
  // ponemos unas criaturas al bot
  s = apply(s, { t: 'play', by: 'b', card: localCard('Grizzly Bears'), force: true });
  s = apply(s, { t: 'play', by: 'b', card: localCard('Rumbling Baloth'), force: true });
  const [bears, baloth] = bot().battlefield;
  s = apply(s, { t: 'play', by: 'h', card: localCard('Lightning Bolt'), targets: [{ uid: bears.uid }], force: true });
  assert.equal(bot().battlefield.length, 1, 'Rayo mata a los Osos');
  s = apply(s, { t: 'play', by: 'h', card: localCard('Lightning Bolt'), targets: [{ player: 'b' }], force: true });
  assert.equal(bot().life, 17);
  s = apply(s, { t: 'play', by: 'h', card: localCard('Murder'), targets: [{ uid: baloth.uid }], force: true });
  assert.equal(bot().battlefield.length, 0, 'Asesinato destruye');
  s = apply(s, { t: 'play', by: 'h', card: localCard('Raise the Alarm'), force: true });
  assert.equal(s.players[0].battlefield.filter((p) => p.card.isToken).length, 2, 'dos fichas');
  const tok = s.players[0].battlefield[0];
  s = apply(s, { t: 'play', by: 'h', card: localCard('Disfigure'), targets: [{ uid: tok.uid }], force: true });
  assert.equal(s.players[0].battlefield.length, 1, 'Desfigurar mata la ficha y no va al cementerio');
  assert.equal(s.players[0].graveyard.some((c) => c.isToken), false);
  const hand = bot().hand.length;
  s = apply(s, { t: 'play', by: 'b', card: localCard('Divination'), force: true });
  assert.equal(bot().hand.length, hand + 2, 'el bot roba 2');
  s = apply(s, { t: 'play', by: 'h', card: localCard('Angel\'s Mercy'), force: true });
  assert.equal(s.players[0].life, 27);
});

test('torneo: todos los mazos oficiales se enfrentan entre sí', () => {
  const cols = Object.keys(BOT_DECKS);
  const wins = Object.fromEntries(cols.map((c) => [c, 0]));
  for (const a of cols) for (const b of cols) {
    if (a === b) continue;
    let s = createGame({ mode: '1v1', seed: a.charCodeAt(0) * 7 + b.charCodeAt(0), players: [
      { id: a, name: a, isBot: true, deck: buildBotDeck(a) }, { id: b + '2', name: b, isBot: true, deck: buildBotDeck(b) }] });
    s = runBots(s, 8000);
    assert.ok(s.winner, `${a} contra ${b} termina`);
    wins[s.winner[0]]++;
  }
  console.log('victorias', JSON.stringify(wins));
});
