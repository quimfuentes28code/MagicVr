import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, apply, findPerm, planPayment, stackTop, power } from '../src/engine/game.js';
import { nextBotAction } from '../src/engine/bot.js';
import { buildBotDeck, localCard, BASICS, BOT_DECKS } from '../src/engine/cards.js';
import * as await_effects from '../src/engine/effects.js';

/** Todos los rivales pasan: lo que hay en la pila se resuelve. */
function resolve(s) {
  let n = 0;
  while (stackTop(s) && n++ < 50) s = apply(s, { t: 'pass', by: stackTop(s).waiting[0] });
  return s;
}
const act = (s, a) => resolve(apply(s, a));

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
  let s = createGame({ mode: '1v1', seed: 1, first: 0, players: [
    { id: 'h', name: 'Yo' },
    { id: 'b', name: 'Bot', isBot: true, deck: buildBotDeck('W', 40) },
  ] });
  s = apply(s, { t: 'play', by: 'h', card: BASICS.G });
  s = apply(s, { t: 'play', by: 'h', card: BASICS.G });
  assert.equal(s.events.at(-1).kind, 'illegal');
  s = apply(s, { t: 'play', by: 'h', card: localCard('Grizzly Bears') });
  assert.equal(s.events.at(-1).kind, 'illegal'); // falta maná
  s = act(s, { t: 'play', by: 'h', card: localCard('Llanowar Elves') });
  assert.equal(s.players[0].battlefield.length, 2);
  assert.equal(s.players[0].battlefield[0].tapped, true);
  const elf = s.players[0].battlefield[1].uid;
  s.step = 'attack'; // forzamos el paso de declarar atacantes
  s = apply(s, { t: 'attack', by: 'h', uid: elf });
  assert.equal(s.events.at(-1).kind, 'illegal'); // mareada
  assert.ok(planPayment(s.players[0], '{G}') === null);
});

test('pagar maná prefiere tierras antes que criaturas', () => {
  let s = createGame({ mode: '1v1', seed: 1, first: 0, players: [{ id: 'h', name: 'Yo' }, { id: 'b', name: 'Bot', isBot: true, deck: buildBotDeck('W', 40) }] });
  s = act(s, { t: 'play', by: 'h', card: localCard('Llanowar Elves'), force: true });
  s.players[0].battlefield[0].sick = false;
  s = act(s, { t: 'play', by: 'h', card: BASICS.G });
  s = act(s, { t: 'play', by: 'h', card: localCard('Giant Growth') });
  const [elf, forest] = s.players[0].battlefield;
  assert.equal(elf.tapped, false);
  assert.equal(forest.tapped, true);
});

test('habilidades automáticas: Rayo, Asesinato, Dar la alarma, Desfigurar, Adivinación', () => {
  let s = createGame({ mode: '1v1', seed: 3, first: 0, players: [{ id: 'h', name: 'Yo' }, { id: 'b', name: 'Bot', isBot: true, deck: buildBotDeck('G') }] });
  const bot = () => s.players[1];
  // ponemos unas criaturas al bot
  s = act(s, { t: 'play', by: 'b', card: localCard('Grizzly Bears'), force: true });
  s = act(s, { t: 'play', by: 'b', card: localCard('Rumbling Baloth'), force: true });
  const [bears, baloth] = bot().battlefield;
  s = act(s, { t: 'play', by: 'h', card: localCard('Lightning Bolt'), targets: [{ uid: bears.uid }], force: true });
  assert.equal(bot().battlefield.length, 1, 'Rayo mata a los Osos');
  s = act(s, { t: 'play', by: 'h', card: localCard('Lightning Bolt'), targets: [{ player: 'b' }], force: true });
  assert.equal(bot().life, 17);
  s = act(s, { t: 'play', by: 'h', card: localCard('Murder'), targets: [{ uid: baloth.uid }], force: true });
  assert.equal(bot().battlefield.length, 0, 'Asesinato destruye');
  s = act(s, { t: 'play', by: 'h', card: localCard('Raise the Alarm'), force: true });
  assert.equal(s.players[0].battlefield.filter((p) => p.card.isToken).length, 2, 'dos fichas');
  const tok = s.players[0].battlefield[0];
  s = act(s, { t: 'play', by: 'h', card: localCard('Disfigure'), targets: [{ uid: tok.uid }], force: true });
  assert.equal(s.players[0].battlefield.length, 1, 'Desfigurar mata la ficha y no va al cementerio');
  assert.equal(s.players[0].graveyard.some((c) => c.isToken), false);
  const hand = bot().hand.length;
  s = act(s, { t: 'play', by: 'b', card: localCard('Divination'), force: true });
  assert.equal(bot().hand.length, hand + 2, 'el bot roba 2');
  s = act(s, { t: 'play', by: 'h', card: localCard('Angel\'s Mercy'), force: true });
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

test('la pila: responder a un Rayo con Crecimiento gigante salva a la criatura', () => {
  let s = createGame({ mode: '1v1', seed: 5, first: 0, players: [{ id: 'h', name: 'Yo' }, { id: 'b', name: 'Bot', isBot: true, deck: buildBotDeck('G') }] });
  s = act(s, { t: 'play', by: 'b', card: localCard('Grizzly Bears'), force: true });
  const bears = s.players[1].battlefield[0];
  s = apply(s, { t: 'play', by: 'h', card: localCard('Lightning Bolt'), targets: [{ uid: bears.uid }], force: true });
  assert.equal(s.stack.length, 1, 'el Rayo espera en la pila');
  assert.deepEqual(stackTop(s).waiting, ['b'], 'el bot puede responder');
  // el bot responde con Crecimiento gigante (sobre la pila, se resuelve primero)
  s = apply(s, { t: 'play', by: 'b', card: localCard('Giant Growth'), targets: [{ uid: bears.uid }], force: true });
  assert.equal(s.stack.length, 2);
  s = resolve(s);
  assert.equal(s.stack.length, 0);
  const b2 = s.players[1].battlefield.find((p) => p.uid === bears.uid);
  assert.ok(b2, 'los Osos sobreviven (5/5 con 3 de daño)');
  assert.equal(b2.damage, 3);
});

test('contrahechizo y hechizo que pierde su objetivo', () => {
  let s = createGame({ mode: '1v1', seed: 6, first: 0, players: [{ id: 'h', name: 'Yo' }, { id: 'b', name: 'Bot', isBot: true, deck: buildBotDeck('U') }] });
  s = apply(s, { t: 'play', by: 'h', card: localCard('Shock'), targets: [{ player: 'b' }], force: true });
  const cs = { ...localCard('Opt'), name: 'Cancel', manaCost: '{1}{U}{U}', oracle: 'Counter target spell.' };
  const { parseEffects } = await_effects;
  cs.effects = parseEffects(cs);
  s = apply(s, { t: 'play', by: 'b', card: cs, targets: [{ stack: stackTop(s).id }], force: true });
  s = resolve(s);
  assert.equal(s.players[1].life, 20, 'el Choque fue contrarrestado');
  // objetivo ilegal al resolverse
  s = act(s, { t: 'play', by: 'b', card: localCard('Grizzly Bears'), force: true });
  const bears = s.players[1].battlefield[0];
  s = apply(s, { t: 'play', by: 'h', card: localCard('Shock'), targets: [{ uid: bears.uid }], force: true });
  s = apply(s, { t: 'play', by: 'b', card: localCard('Unsummon'), targets: [{ uid: bears.uid }], force: true });
  s = resolve(s);
  assert.ok(s.events.some((e) => e.kind === 'fizzle'), 'el Choque se contrarresta por falta de objetivo');
});

test('combate: dañar primero, amenaza, indestructible, regla de leyendas y antimaleficio', () => {
  let s = createGame({ mode: '1v1', seed: 7, first: 0, players: [{ id: 'h', name: 'Yo' }, { id: 'b', name: 'Bot', isBot: true, deck: buildBotDeck('R') }] });
  const mk = (name, p, t, kws = [], extra = {}) => ({ ...localCard('Grizzly Bears'), name, printedName: null, power: p, toughness: t, keywords: kws, ...extra });
  s = act(s, { t: 'play', by: 'h', card: mk('Caballero', 2, 2, ['first strike']), force: true });
  s = act(s, { t: 'play', by: 'b', card: mk('Ogro', 2, 2), force: true });
  const [knight] = s.players[0].battlefield;
  const [ogre] = s.players[1].battlefield;
  knight.sick = false;
  s.step = 'attack';
  s = apply(s, { t: 'attack', by: 'h', uid: knight.uid });
  s = apply(s, { t: 'next', by: 'h' });
  assert.equal(s.step, 'block');
  s = apply(s, { t: 'block', by: 'b', uid: ogre.uid, attacker: knight.uid });
  s = apply(s, { t: 'confirmBlocks', by: 'b' });
  s = apply(s, { t: 'next', by: 'h' });
  assert.ok(s.players[0].battlefield.some((p) => p.uid === knight.uid), 'dañar primero: el caballero sobrevive');
  assert.ok(!s.players[1].battlefield.some((p) => p.uid === ogre.uid), 'el ogro muere antes de golpear');
  assert.equal(s.step, 'main2', 'tras el combate, fase principal 2');

  // indestructible ante Asesinato
  s = act(s, { t: 'play', by: 'b', card: mk('Muro', 0, 4, ['indestructible']), force: true });
  const wall = s.players[1].battlefield.at(-1);
  s = act(s, { t: 'play', by: 'h', card: localCard('Murder'), targets: [{ uid: wall.uid }], force: true });
  assert.ok(s.players[1].battlefield.some((p) => p.uid === wall.uid), 'indestructible no se destruye');

  // antimaleficio: no se puede hacer objetivo
  s = act(s, { t: 'play', by: 'b', card: mk('Sombra', 1, 1, ['hexproof']), force: true });
  const shade = s.players[1].battlefield.at(-1);
  s = apply(s, { t: 'play', by: 'h', card: localCard('Shock'), targets: [{ uid: shade.uid }] });
  assert.equal(s.events.at(-1).kind, 'illegal');

  // regla de leyendas
  const legend = mk('Héroe único', 3, 3, [], { isLegendary: true, typeLine: 'Legendary Creature — Human' });
  s = act(s, { t: 'play', by: 'h', card: legend, force: true });
  s = act(s, { t: 'play', by: 'h', card: legend, force: true });
  assert.equal(s.players[0].battlefield.filter((p) => p.card.name === 'Héroe único').length, 1);

  // amenaza: un solo bloqueador no vale
  s.step = 'main1'; s.turn = 3;
  s = act(s, { t: 'play', by: 'h', card: mk('Matón', 3, 3, ['menace']), force: true });
  const thug = s.players[0].battlefield.at(-1);
  thug.sick = false;
  s.step = 'attack';
  s.combat = { attackers: {}, blocks: {}, confirmed: [], ready: [], result: null, firstDone: false };
  s = apply(s, { t: 'attack', by: 'h', uid: thug.uid });
  s = apply(s, { t: 'next', by: 'h' });
  s = apply(s, { t: 'block', by: 'b', uid: wall.uid, attacker: thug.uid });
  s = apply(s, { t: 'confirmBlocks', by: 'b' });
  assert.equal(s.events.at(-1).kind, 'illegal', 'amenaza necesita dos bloqueadores');
});
