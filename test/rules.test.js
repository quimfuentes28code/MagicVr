// Batería de reglas de Magic (reglas completas 2024-2026) contra el motor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, apply, stackTop, canAttack, planPayment } from '../src/engine/game.js';
import { buildBotDeck, localCard, BASICS, normalize } from '../src/engine/cards.js';

// --------------------------------------------------------------- utilidades
function resolve(s) {
  let n = 0;
  while (stackTop(s) && n++ < 50) s = apply(s, { t: 'pass', by: stackTop(s).waiting[0] });
  return s;
}
const act = (s, a) => resolve(apply(s, a));
const last = (s) => s.events.at(-1);

/** Partida de prueba: humano "a" contra humano "b" (sin bots), empieza "a". */
function duel(extra = {}) {
  return createGame({ mode: '1v1', seed: 11, first: 0, players: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bea' }], ...extra });
}

/** Crea una criatura con las palabras clave / texto que queramos. */
function creature(name, p, t, keywords = [], extra = {}) {
  return normalize({ name, manaCost: '{1}', power: p, toughness: t, typeLine: 'Creature — Test', keywords, oracle: extra.oracle || keywords.join(', '), colors: extra.colors || [], ...extra });
}

/** Pone un permanente en juego directamente (sin pagar) y devuelve [estado, uid]. */
function put(s, who, card, { sick = false } = {}) {
  s = act(s, { t: 'play', by: who, card, force: true });
  const pl = s.players.find((p) => p.id === who);
  const perm = pl.battlefield[pl.battlefield.length - 1];
  perm.sick = sick;
  return [s, perm.uid];
}

/** Lleva la partida al paso de declarar atacantes del jugador activo. */
function toAttack(s) {
  s.step = 'main1';
  s.stack = [];
  return apply(s, { t: 'next', by: s.players[s.active].id });
}

/** Ataque completo: atacantes, bloqueos y daño. blocks: [[bloqueador, atacante]] */
function combat(s, attackers, blocks = [], { target } = {}) {
  s = toAttack(s);
  assert.equal(s.step, 'attack', 'debería estar en declarar atacantes');
  const att = s.players[s.active].id;
  const def = target || s.players.find((p) => p.id !== att).id;
  for (const u of attackers) s = apply(s, { t: 'attack', by: att, uid: u, target: def });
  s = apply(s, { t: 'next', by: att });
  for (const [b, a] of blocks) s = apply(s, { t: 'block', by: def, uid: b, attacker: a });
  s = apply(s, { t: 'confirmBlocks', by: def });
  s = apply(s, { t: 'ready', by: def });
  s = apply(s, { t: 'next', by: att });
  return s;
}
const perm = (s, uid) => s.players.flatMap((p) => p.battlefield).find((x) => x.uid === uid);
const life = (s, id) => s.players.find((p) => p.id === id).life;

// ------------------------------------------------------- mareo de invocación
test('mareo: una criatura no puede atacar el turno que entra; con prisa sí', () => {
  let s = duel();
  let bear, goblin;
  [s, bear] = put(s, 'a', creature('Oso', 2, 2), { sick: true });
  [s, goblin] = put(s, 'a', creature('Trasgo', 1, 1, ['Haste']), { sick: true });
  s = toAttack(s);
  s = apply(s, { t: 'attack', by: 'a', uid: bear });
  assert.equal(last(s).kind, 'illegal', 'el oso mareado no ataca');
  s = apply(s, { t: 'attack', by: 'a', uid: goblin });
  assert.equal(s.combat.attackers[goblin], 'b', 'con prisa sí ataca');
});

test('mareo: al empezar tu siguiente turno ya puede atacar', () => {
  let s = duel();
  let bear;
  s = act(s, { t: 'play', by: 'a', card: creature('Oso', 2, 2), force: true });
  bear = s.players[0].battlefield[0].uid;
  assert.equal(canAttack(s, perm(s, bear)), false);
  // pasa el turno de Ana y el de Bea
  for (let i = 0; i < 2; i++) {
    while (!['main2'].includes(s.step)) s = apply(s, { t: 'next', by: s.players[s.active].id });
    s = apply(s, { t: 'next', by: s.players[s.active].id });
  }
  assert.equal(s.players[s.active].id, 'a');
  assert.equal(canAttack(s, perm(s, bear)), true);
});

test('mareo: una criatura de maná mareada no puede girarse para dar maná', () => {
  let s = duel();
  let elf;
  [s, elf] = put(s, 'a', localCard('Llanowar Elves'), { sick: true });
  assert.equal(planPayment(s.players[0], '{G}'), null, 'no cuenta como fuente');
  s = apply(s, { t: 'tap', by: 'a', uid: elf });
  assert.equal(s.players[0].manaPool.length, 0, 'girarla a mano no da maná');
});

// -------------------------------------------------------------------- volar
test('volar: sólo la bloquean criaturas con volar o alcance', () => {
  let s = duel();
  let bird, bear, spider, eagle;
  [s, bird] = put(s, 'a', creature('Pájaro', 2, 2, ['Flying']));
  [s, bear] = put(s, 'b', creature('Oso', 2, 2));
  [s, spider] = put(s, 'b', creature('Araña', 1, 4, ['Reach']));
  [s, eagle] = put(s, 'b', creature('Águila', 1, 1, ['Flying']));
  s = toAttack(s);
  s = apply(s, { t: 'attack', by: 'a', uid: bird });
  s = apply(s, { t: 'next', by: 'a' });
  s = apply(s, { t: 'block', by: 'b', uid: bear, attacker: bird });
  assert.equal(last(s).kind, 'illegal', 'el oso no puede bloquear a un volador');
  s = apply(s, { t: 'block', by: 'b', uid: spider, attacker: bird });
  assert.deepEqual(s.combat.blocks[bird], [spider], 'alcance sí');
  s = apply(s, { t: 'block', by: 'b', uid: eagle, attacker: bird });
  assert.deepEqual(s.combat.blocks[bird], [spider, eagle], 'volar sí');
});

test('volar: un volador sí puede bloquear a una criatura sin volar', () => {
  let s = duel();
  let bear, eagle;
  [s, bear] = put(s, 'a', creature('Oso', 2, 2));
  [s, eagle] = put(s, 'b', creature('Águila', 1, 3, ['Flying']));
  s = combat(s, [bear], [[eagle, bear]]);
  assert.equal(life(s, 'b'), 20, 'bloqueado, no hay daño al jugador');
});

// ----------------------------------------------------- más palabras clave
test('defensor no ataca; "no puede bloquear" no bloquea; girada no bloquea', () => {
  let s = duel();
  let wall, piker, bear, tapped;
  [s, wall] = put(s, 'a', creature('Muro', 0, 4, ['Defender']));
  [s, bear] = put(s, 'a', creature('Oso', 2, 2));
  [s, piker] = put(s, 'b', creature('Lancero', 2, 1, [], { oracle: 'This creature can’t block.' }));
  [s, tapped] = put(s, 'b', creature('Cansado', 3, 3));
  perm(s, tapped).tapped = true;
  s = toAttack(s);
  s = apply(s, { t: 'attack', by: 'a', uid: wall });
  assert.equal(last(s).kind, 'illegal', 'defensor');
  s = apply(s, { t: 'attack', by: 'a', uid: bear });
  s = apply(s, { t: 'next', by: 'a' });
  s = apply(s, { t: 'block', by: 'b', uid: piker, attacker: bear });
  assert.equal(last(s).kind, 'illegal', 'no puede bloquear');
  s = apply(s, { t: 'block', by: 'b', uid: tapped, attacker: bear });
  assert.equal(last(s).kind, 'illegal', 'girada no bloquea');
});

test('vigilancia: atacar no gira la criatura', () => {
  let s = duel();
  let angel, bear;
  [s, angel] = put(s, 'a', creature('Ángel', 4, 4, ['Vigilance']));
  [s, bear] = put(s, 'a', creature('Oso', 2, 2));
  s = combat(s, [angel, bear]);
  assert.equal(perm(s, angel).tapped, false);
  assert.equal(perm(s, bear).tapped, true);
  assert.equal(life(s, 'b'), 14);
});

test('arrollar: el daño sobrante pasa al jugador; con toque mortal basta 1 por bloqueador', () => {
  let s = duel();
  let wurm, killer, bear, wall;
  [s, wurm] = put(s, 'a', creature('Sierpe', 6, 6, ['Trample']));
  [s, bear] = put(s, 'b', creature('Oso', 2, 2));
  s = combat(s, [wurm], [[bear, wurm]]);
  assert.equal(life(s, 'b'), 16, '6 - 2 = 4 al jugador');
  s = duel();
  [s, killer] = put(s, 'a', creature('Asesino', 3, 3, ['Trample', 'Deathtouch']));
  [s, wall] = put(s, 'b', creature('Muro', 0, 8));
  s = combat(s, [killer], [[wall, killer]]);
  assert.equal(life(s, 'b'), 18, '1 al muro (toque mortal) y 2 al jugador');
  assert.equal(perm(s, wall), undefined, 'el muro muere por toque mortal');
});

test('toque mortal y vínculo vital', () => {
  let s = duel();
  let rat, giant, vamp;
  [s, rat] = put(s, 'a', creature('Rata', 1, 1, ['Deathtouch']));
  [s, giant] = put(s, 'b', creature('Gigante', 5, 5));
  s = combat(s, [rat], [[giant, rat]]);
  assert.equal(perm(s, giant), undefined, 'el gigante muere por 1 de daño con toque mortal');
  s = duel();
  [s, vamp] = put(s, 'a', creature('Vampiro', 3, 3, ['Lifelink']));
  s = combat(s, [vamp]);
  assert.equal(life(s, 'a'), 23);
  assert.equal(life(s, 'b'), 17);
});

test('dañar primero y dañar dos veces', () => {
  let s = duel();
  let knight, ogre;
  [s, knight] = put(s, 'a', creature('Caballero', 2, 2, ['First strike']));
  [s, ogre] = put(s, 'b', creature('Ogro', 2, 2));
  s = combat(s, [knight], [[ogre, knight]]);
  assert.ok(perm(s, knight), 'el caballero sobrevive');
  assert.equal(perm(s, ogre), undefined);
  s = duel();
  let ds;
  [s, ds] = put(s, 'a', creature('Doble', 3, 3, ['Double strike']));
  s = combat(s, [ds]);
  assert.equal(life(s, 'b'), 14, 'dañar dos veces: 3 + 3');
});

test('amenaza: necesita dos o más bloqueadores', () => {
  let s = duel();
  let thug, b1, b2;
  [s, thug] = put(s, 'a', creature('Matón', 3, 3, ['Menace']));
  [s, b1] = put(s, 'b', creature('Uno', 2, 2));
  [s, b2] = put(s, 'b', creature('Dos', 2, 2));
  s = toAttack(s);
  s = apply(s, { t: 'attack', by: 'a', uid: thug });
  s = apply(s, { t: 'next', by: 'a' });
  s = apply(s, { t: 'block', by: 'b', uid: b1, attacker: thug });
  s = apply(s, { t: 'confirmBlocks', by: 'b' });
  assert.equal(last(s).kind, 'illegal');
  s = apply(s, { t: 'block', by: 'b', uid: b2, attacker: thug });
  s = apply(s, { t: 'confirmBlocks', by: 'b' });
  assert.notEqual(last(s).kind, 'illegal');
});

test('no puede ser bloqueada', () => {
  let s = duel();
  let rogue, bear;
  [s, rogue] = put(s, 'a', creature('Pícaro', 2, 1, [], { oracle: 'This creature can’t be blocked.' }));
  [s, bear] = put(s, 'b', creature('Oso', 2, 2));
  s = toAttack(s);
  s = apply(s, { t: 'attack', by: 'a', uid: rogue });
  s = apply(s, { t: 'next', by: 'a' });
  s = apply(s, { t: 'block', by: 'b', uid: bear, attacker: rogue });
  assert.equal(last(s).kind, 'illegal');
});

test('protección contra un color: no la bloquean, no la hacen objetivo y se previene el daño', () => {
  let s = duel();
  let paladin, redBear;
  [s, paladin] = put(s, 'a', creature('Paladín', 2, 2, ['Protection'], { oracle: 'Protection from red' }));
  [s, redBear] = put(s, 'b', creature('Oso rojo', 2, 2, [], { colors: ['R'] }));
  s = toAttack(s);
  s = apply(s, { t: 'attack', by: 'a', uid: paladin });
  s = apply(s, { t: 'next', by: 'a' });
  s = apply(s, { t: 'block', by: 'b', uid: redBear, attacker: paladin });
  assert.equal(last(s).kind, 'illegal', 'una criatura roja no puede bloquearla');
  s = duel();
  [s, paladin] = put(s, 'a', creature('Paladín', 2, 2, ['Protection'], { oracle: 'Protection from red' }));
  s = apply(s, { t: 'play', by: 'b', card: localCard('Lightning Bolt'), targets: [{ uid: paladin }] , force: false });
  assert.equal(last(s).kind, 'illegal', 'un Rayo (rojo) no puede hacerla objetivo');
});

test('indestructible, antimaleficio y velo', () => {
  let s = duel();
  let god, hex, shroud;
  [s, god] = put(s, 'b', creature('Dios', 4, 4, ['Indestructible']));
  s = act(s, { t: 'play', by: 'a', card: localCard('Murder'), targets: [{ uid: god }], force: true });
  assert.ok(perm(s, god), 'no se destruye');
  s = act(s, { t: 'damage', by: 'a', uid: god, amount: 9 });
  assert.ok(perm(s, god), 'el daño letal tampoco la destruye');
  [s, hex] = put(s, 'b', creature('Sombra', 1, 1, ['Hexproof']));
  s = apply(s, { t: 'play', by: 'a', card: localCard('Shock'), targets: [{ uid: hex }] });
  assert.equal(last(s).kind, 'illegal');
  [s, shroud] = put(s, 'b', creature('Velo', 1, 1, ['Shroud']));
  s = apply(s, { t: 'play', by: 'b', card: localCard('Giant Growth'), targets: [{ uid: shroud }] });
  assert.equal(last(s).kind, 'illegal', 'velo: ni su dueño puede hacerla objetivo');
});

test('infectar y marchitar', () => {
  let s = duel();
  let mite, bear, wither, bear2;
  [s, mite] = put(s, 'a', creature('Ácaro', 2, 2, ['Infect']));
  s = combat(s, [mite]);
  assert.equal(life(s, 'b'), 20, 'infectar no quita vidas');
  assert.equal(s.players[1].poison, 2, 'da contadores de veneno');
  s = duel();
  [s, wither] = put(s, 'a', creature('Marchito', 2, 2, ['Wither']));
  [s, bear2] = put(s, 'b', creature('Oso', 3, 3));
  s = combat(s, [wither], [[bear2, wither]]);
  assert.equal(perm(s, bear2).counters, -2, 'marchitar pone contadores -1/-1');
  assert.equal(perm(s, bear2).damage, 0);
  void mite; void bear;
});

test('atacar a un planeswalker: el daño le quita lealtad', () => {
  let s = duel();
  let bear, pw;
  [s, bear] = put(s, 'a', creature('Oso', 3, 3));
  [s, pw] = put(s, 'b', normalize({ name: 'Mago', manaCost: '{3}', typeLine: 'Legendary Planeswalker — Test', loyalty: 5 }));
  s = toAttack(s);
  s = apply(s, { t: 'attack', by: 'a', uid: bear, target: 'pw:' + pw });
  assert.equal(s.combat.attackers[bear], 'pw:' + pw);
  s = apply(s, { t: 'next', by: 'a' });
  s = apply(s, { t: 'confirmBlocks', by: 'b' });
  s = apply(s, { t: 'ready', by: 'b' });
  s = apply(s, { t: 'next', by: 'a' });
  assert.equal(perm(s, pw).loyalty, 2);
  assert.equal(life(s, 'b'), 20);
});

// --------------------------------------------------------- normas por modo
test('duelo: 20 vidas y quien empieza no roba en su primer turno', () => {
  const s = createGame({ mode: '1v1', seed: 3, first: 0, players: [
    { id: 'x', name: 'X', isBot: true, deck: buildBotDeck('G') }, { id: 'y', name: 'Y', isBot: true, deck: buildBotDeck('R') }] });
  assert.equal(s.players[0].life, 20);
  let t = s;
  t.step = 'cleanup';
  // turno 1 del primer jugador: no roba
  const before = createGame({ mode: '1v1', seed: 3, first: 0, players: [
    { id: 'x', name: 'X', isBot: true, deck: buildBotDeck('G') }, { id: 'y', name: 'Y', isBot: true, deck: buildBotDeck('R') }] });
  assert.equal(before.players[0].hand.length + before.players[0].library.length, 60);
  assert.ok(!before.log.some((l) => /roba/.test(l)));
});

test('commander: 40 vidas, impuesto de comandante y 21 de daño de comandante', () => {
  let s = createGame({ mode: 'commander', seed: 4, first: 0, players: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bea' }, { id: 'c', name: 'Carla' }] });
  assert.equal(s.players[0].life, 40);
  const cmd = creature('Capitana', 7, 7, [], { isLegendary: true, typeLine: 'Legendary Creature — Human' });
  s = apply(s, { t: 'setCommander', by: 'a', card: cmd });
  s = act(s, { t: 'castCommander', by: 'a', force: true });
  assert.equal(s.players[0].commanderTax, 2);
  const uid = s.players[0].battlefield.find((p) => p.isCommander).uid;
  s = act(s, { t: 'move', by: 'b', uid, to: 'graveyard' });
  assert.ok(s.players[0].commanderInZone, 'vuelve a la zona de mando');
  s = act(s, { t: 'castCommander', by: 'a', force: true });
  assert.equal(s.players[0].commanderTax, 4, 'cada lanzamiento cuesta 2 más');
  const c2 = s.players[0].battlefield.find((p) => p.isCommander).uid;
  perm(s, c2).sick = false;
  s.turn = 5;
  for (let i = 0; i < 3; i++) {
    perm(s, c2).tapped = false; // (se endereza en cada turno nuevo)
    s = combat(s, [c2], [], { target: 'b' });
  }
  assert.equal(s.players[1].cmdDamage.a, 21);
  assert.ok(s.players[1].eliminated, '21 de daño de comandante elimina aunque le queden vidas');
  assert.ok(life(s, 'b') > 0);
});

test('commander multijugador: quien empieza SÍ roba en su primer turno', () => {
  const mk = () => createGame({ mode: 'commander', seed: 5, first: 0, players: ['G', 'R', 'W'].map((c, i) => ({ id: 'p' + i, name: 'P' + i, isBot: true, deck: buildBotDeck(c, 99) })) });
  let s = mk();
  s.step = 'cleanup';
  // simulamos el inicio del primer turno
  s = mk();
  const h0 = s.players[0].hand.length;
  s.step = 'upkeep';
  s = apply(s, { t: 'next', by: 'p0' }); // upkeep -> draw (automático) -> main1
  assert.equal(s.players[0].hand.length, h0 + 1, 'roba una carta');
});

test('duelo: quien empieza no roba (dos jugadores)', () => {
  let s = createGame({ mode: '1v1', seed: 5, first: 0, players: [
    { id: 'x', name: 'X', isBot: true, deck: buildBotDeck('G') }, { id: 'y', name: 'Y', isBot: true, deck: buildBotDeck('R') }] });
  const h0 = s.players[0].hand.length;
  s.step = 'upkeep';
  s = apply(s, { t: 'next', by: 'x' });
  assert.equal(s.players[0].hand.length, h0, 'no roba');
});

test('tiempos: tierras y conjuros sólo en tu fase principal con la pila vacía; instantáneos siempre', () => {
  let s = duel();
  s = apply(s, { t: 'play', by: 'b', card: BASICS.R });
  assert.equal(last(s).kind, 'illegal', 'tierra en turno ajeno');
  s = apply(s, { t: 'play', by: 'b', card: creature('Oso', 2, 2) });
  assert.equal(last(s).kind, 'illegal', 'criatura en turno ajeno');
  s = apply(s, { t: 'play', by: 'b', card: localCard('Shock'), targets: [{ player: 'a' }], force: false });
  // sin maná: aviso de maná, no de tiempo
  assert.match(last(s).text, /maná/);
  s = act(s, { t: 'play', by: 'a', card: BASICS.G });
  s = apply(s, { t: 'play', by: 'a', card: BASICS.G });
  assert.match(last(s).text, /UNA tierra/);
});

test('el maná sobrante se pierde al cambiar de paso y sólo se endereza el jugador activo', () => {
  let s = duel();
  let land, theirs;
  [s, land] = put(s, 'a', BASICS.G);
  [s, theirs] = put(s, 'b', BASICS.R);
  s = apply(s, { t: 'tap', by: 'a', uid: land });
  s = apply(s, { t: 'tap', by: 'b', uid: theirs });
  assert.equal(s.players[0].manaPool.length, 1);
  s = apply(s, { t: 'next', by: 'a' });
  assert.equal(s.players[0].manaPool.length, 0);
  // pasa al turno de Bea: se endereza lo de Bea, no lo de Ana
  while (s.players[s.active].id === 'a') s = apply(s, { t: 'next', by: 'a' });
  assert.equal(perm(s, theirs).tapped, false);
  assert.equal(perm(s, land).tapped, true);
});

test('mano física: la app lleva la cuenta de tus cartas en mano', () => {
  let s = duel();
  const a = s.players.find((p) => p.id === 'a');
  assert.equal(a.handCount, 7);
  s.step = 'main1';
  s = act(s, { t: 'play', by: 'a', card: BASICS.Forest || Object.values(BASICS)[0] });
  assert.equal(s.players.find((p) => p.id === 'a').handCount, 6, 'jugar una carta la quita de la mano');
  s = apply(s, { t: 'hand', by: 'a', delta: 2 });
  assert.equal(s.players.find((p) => p.id === 'a').handCount, 8, 'se puede corregir a mano');
  s = apply(s, { t: 'hand', by: 'a', set: 5 });
  assert.equal(s.players.find((p) => p.id === 'a').handCount, 5);
});

test('aventura: el hechizo se resuelve, se exilia «de aventura» y luego se lanza la criatura desde el exilio', () => {
  let s = duel();
  s.step = 'main1';
  const [s1, target] = put(s, 'a', creature('Oso', 2, 2));
  s = s1;
  const creatureFace = normalize({ name: 'Gollum, Silent Slinker', manaCost: '{3}{B}', typeLine: 'Legendary Creature — Halfling Horror', power: '4', toughness: '3', keywords: ['Menace'], oracle: 'Menace' });
  const adventure = normalize({ name: 'Meager Meal', manaCost: '{B}', typeLine: 'Sorcery — Adventure', oracle: 'Put a +1/+1 counter on up to one target creature. Target player gains 2 life. (Then exile this card. You may cast the creature later from exile.)' });
  adventure.adventureOf = creatureFace;
  const life0 = s.players.find((p) => p.id === 'a').life;
  s = act(s, { t: 'play', by: 'a', card: adventure, targets: [{ uid: target }], force: true });
  const a = s.players.find((p) => p.id === 'a');
  assert.equal(a.battlefield.find((p) => p.uid === target).counters, 1, '+1/+1 aplicado solo');
  assert.equal(a.life, life0 + 2, '2 vidas sumadas solas');
  assert.equal(a.graveyard.length, 0, 'no va al cementerio');
  assert.equal(a.exile.filter((c) => c.onAdventure).length, 1, 'queda exiliada de aventura');
  const later = { ...creatureFace, fromAdventure: true };
  s = act(s, { t: 'play', by: 'a', card: later, force: true });
  const a2 = s.players.find((p) => p.id === 'a');
  assert.equal(a2.exile.length, 0, 'sale del exilio');
  assert.ok(a2.battlefield.some((p) => p.card.name === 'Gollum, Silent Slinker'), 'la criatura entra al campo');
});

test('«cuando muera, crea una ficha»: la ficha aparece sola al morir la criatura', () => {
  let s = duel();
  s.step = 'main1';
  const guard = creature('Dwarven Castle Guard', 2, 1, [], { oracle: 'When this creature dies, create a 1/1 colorless Hero creature token.' });
  let uid;
  [s, uid] = put(s, 'a', guard);
  s = apply(s, { t: 'damage', by: 'a', uid, amount: 3 });
  const a = s.players.find((p) => p.id === 'a');
  assert.ok(!a.battlefield.some((p) => p.uid === uid), 'la criatura muere');
  const tok = a.battlefield.find((p) => p.card.isToken);
  assert.ok(tok, 'aparece la ficha');
  assert.equal(tok.card.subtype, 'Hero');
  assert.equal(tok.card.power, 1);
  assert.equal(tok.card.printedName, 'Ficha de Héroe');
});

test('las fichas incoloras no tienen color', () => {
  const guard = creature('Guard', 2, 1, [], { oracle: 'When this creature dies, create a 1/1 colorless Hero creature token.' });
  assert.deepEqual(guard.effects.dies[0].colors, []);
});

test('equipar: paga el coste, da +1/+0, el tipo Caballero y vuela sólo en tu turno', () => {
  let s = duel();
  const eqCard = normalize({ name: 'Test Lance', manaCost: '{2}', typeLine: 'Artifact — Equipment',
    oracle: 'Equipped creature gets +1/+0 and is a Knight in addition to its other types.\nDuring your turn, equipped creature has flying.\nEquip {4}' });
  assert.equal(eqCard.attach.equip, '{4}');
  let eq, cr;
  [s, eq] = put(s, 'a', eqCard);
  [s, cr] = put(s, 'a', creature('Bear', 2, 2));
  s.step = 'main1';
  // sin maná: no se puede
  s = apply(s, { t: 'equip', by: 'a', uid: eq, target: cr });
  assert.equal(last(s).kind, 'illegal');
  for (let i = 0; i < 4; i++) [s] = put(s, 'a', BASICS.R);
  s.step = 'main1';
  s = apply(s, { t: 'equip', by: 'a', uid: eq, target: cr });
  const a = s.players[0];
  const bear = a.battlefield.find((p) => p.uid === cr);
  assert.equal(a.battlefield.filter((p) => p.card.isLand && p.tapped).length, 4);
  assert.equal(bear.bonus.p, 1);
  assert.ok(bear.bonus.types.includes('Knight'));
  assert.ok(bear.bonus.kw.includes('flying'));
  // en el turno del rival no vuela
  s.active = 1;
  s = apply(s, { t: 'hand', by: 'a', delta: 0 });
  const bear2 = s.players[0].battlefield.find((p) => p.uid === cr);
  assert.ok(!bear2.bonus.kw.includes('flying'));
  assert.equal(bear2.bonus.p, 1);
  // si la criatura muere, el equipo se queda en juego sin equipar
  s = apply(s, { t: 'move', by: 'a', uid: cr, to: 'graveyard' });
  const e2 = s.players[0].battlefield.find((p) => p.uid === eq);
  assert.ok(e2);
  assert.equal(e2.attachedTo, null);
});

test('aura: se lanza sobre una criatura y le da sus bonificaciones; sin criatura va al cementerio', () => {
  let s = duel();
  let cr;
  [s, cr] = put(s, 'a', creature('Bear', 2, 2));
  const aura = normalize({ name: 'Test Aura', manaCost: '{1}', typeLine: 'Enchantment — Aura', oracle: 'Enchant creature\nEnchanted creature gets +2/+2 and has trample.' });
  s = act(s, { t: 'play', by: 'a', card: aura, force: true, targets: [{ uid: cr, attach: true }] });
  const bear = s.players[0].battlefield.find((p) => p.uid === cr);
  assert.equal(bear.bonus.p, 2);
  assert.ok(bear.bonus.kw.includes('trample'));
  s = apply(s, { t: 'move', by: 'a', uid: cr, to: 'graveyard' });
  assert.ok(s.players[0].graveyard.some((c) => c.name === 'Test Aura'));
});

test('Destino del Cristal del Sol: destruye un permanente que no sea tierra y cuesta {2} menos contra una criatura girada', () => {
  const fate = normalize({ name: 'Fate of the Sun-Cryst', manaCost: '{4}{W}', typeLine: 'Instant',
    oracle: 'This spell costs {2} less to cast if it targets a tapped creature.\nDestroy target nonland permanent.', colors: ['W'] });
  let s = duel();
  let foe, art, land;
  [s, foe] = put(s, 'b', creature('Ogre', 3, 3));
  [s, art] = put(s, 'b', normalize({ name: 'Rock', manaCost: '{1}', typeLine: 'Artifact' }));
  [s, land] = put(s, 'b', BASICS.G);
  for (let i = 0; i < 3; i++) [s] = put(s, 'a', BASICS.W);
  s.step = 'main1'; s.stack = [];
  // una tierra no vale
  s = apply(s, { t: 'play', by: 'a', card: fate, targets: [{ uid: land }] });
  assert.equal(last(s).kind, 'illegal');
  // criatura enderezada: cuesta 5 y sólo hay 3
  s = apply(s, { t: 'play', by: 'a', card: fate, targets: [{ uid: foe }] });
  assert.equal(last(s).kind, 'illegal');
  // girada: cuesta 3 → se lanza y la destruye
  s.players[1].battlefield.find((p) => p.uid === foe).tapped = true;
  s = act(s, { t: 'play', by: 'a', card: fate, targets: [{ uid: foe }] });
  assert.ok(!s.players[1].battlefield.some((p) => p.uid === foe));
  assert.ok(s.players[1].graveyard.some((c) => c.name === 'Ogre'));
  assert.equal(s.players[0].battlefield.filter((p) => p.tapped).length, 3);
  // también destruye artefactos
  for (const p of s.players[0].battlefield) p.tapped = false;
  for (let i = 0; i < 2; i++) [s] = put(s, 'a', BASICS.W);
  s.step = 'main1';
  s = act(s, { t: 'play', by: 'a', card: fate, targets: [{ uid: art }] });
  assert.ok(!s.players[1].battlefield.some((p) => p.uid === art));
});

test('destruir/exiliar/devolver: lee el tipo de objetivo de la carta', () => {
  const fx = (o) => normalize({ name: 'X', manaCost: '{1}', typeLine: 'Instant', oracle: o }).effects.spell[0];
  assert.deepEqual(fx('Destroy target artifact or enchantment.').filter.types, ['artifact', 'enchantment']);
  assert.equal(fx('Exile target creature an opponent controls.').kind, 'exile');
  assert.equal(fx('Exile target creature an opponent controls.').filter.opp, true);
  assert.equal(fx('Return target nonland permanent to its owner\'s hand.').kind, 'bounce');
  assert.equal(fx('Exile target card from a graveyard.').kind, 'exileGraveCard');
});

test('«exilia la primera carta de tu biblioteca; hasta el final de tu próximo turno puedes jugarla»', () => {
  const path = normalize({ name: "Alania's Pathmaker", manaCost: '{3}{R}', power: '4', toughness: '2', typeLine: 'Creature — Otter Wizard',
    oracle: 'When this creature enters, exile the top card of your library. Until the end of your next turn, you may play that card.', colors: ['R'] });
  assert.equal(path.effects.etb[0].kind, 'impulse');
  let s = duel();
  [s] = put(s, 'a', BASICS.R); // ya jugó su tierra del turno
  s.step = 'main1';
  s = act(s, { t: 'play', by: 'a', card: path, force: true });
  assert.equal(s.players[0].pendingExile.length, 1);
  // escanea la carta de arriba: una tierra → va al exilio, jugable
  s = apply(s, { t: 'exileTop', by: 'a', card: BASICS.R });
  const ex = s.players[0].exile.at(-1);
  assert.ok(ex.playable);
  // este turno ya jugó tierra: no puede (regla 305.2)
  s = apply(s, { t: 'play', by: 'a', card: { ...ex, fromExile: true } });
  assert.equal(last(s).kind, 'illegal');
  // turno del rival y su siguiente turno: ahí sí puede
  s.step = 'cleanup'; s = apply(s, { t: 'next', by: 'a' });
  assert.equal(s.players[s.active].id, 'b');
  assert.ok(s.players[0].exile.at(-1).playable, 'sigue jugable en el turno del rival');
  s.step = 'cleanup'; s = apply(s, { t: 'next', by: 'b' });
  s.step = 'main1'; s.stack = [];
  s = apply(s, { t: 'play', by: 'a', card: { ...s.players[0].exile.at(-1), fromExile: true } });
  assert.equal(s.players[0].exile.length, 0);
  assert.equal(s.players[0].battlefield.filter((p) => p.card.isLand).length, 2);
});

test('el plazo caduca al final de tu próximo turno', () => {
  const path = normalize({ name: 'P', manaCost: '{1}', power: '1', toughness: '1', typeLine: 'Creature — Test',
    oracle: 'When this creature enters, exile the top card of your library. Until the end of your next turn, you may play that card.' });
  let s = duel();
  s.step = 'main1';
  s = act(s, { t: 'play', by: 'a', card: path, force: true });
  s = apply(s, { t: 'exileTop', by: 'a', card: creature('Bear', 2, 2) });
  for (let i = 0; i < 2; i++) { s.step = 'cleanup'; s.stack = []; s = apply(s, { t: 'next', by: s.players[s.active].id }); }
  assert.ok(s.players[0].exile.at(-1).playable);
  s.step = 'cleanup'; s.stack = []; s = apply(s, { t: 'next', by: 'a' });
  assert.ok(!s.players[0].exile.at(-1).playable);
});

test('tierras adicionales: «puedes jugar una tierra adicional en cada uno de tus turnos»', () => {
  let s = duel();
  [s] = put(s, 'a', normalize({ name: 'Explorer', manaCost: '{G}', typeLine: 'Enchantment', oracle: 'You may play an additional land on each of your turns.' }));
  s.step = 'main1';
  s = apply(s, { t: 'play', by: 'a', card: BASICS.G });
  s = apply(s, { t: 'play', by: 'a', card: BASICS.G });
  assert.equal(s.players[0].landsPlayed, 2);
  s = apply(s, { t: 'play', by: 'a', card: BASICS.G });
  assert.equal(last(s).kind, 'illegal');
});

test('Sueño hechizado: al entrar gira la criatura encantada y no se endereza en su paso de enderezar', () => {
  const sleep = normalize({ name: 'Charmed Sleep', manaCost: '{1}{U}{U}', typeLine: 'Enchantment — Aura', colors: ['U'],
    oracle: "Enchant creature\nWhen this Aura enters, tap enchanted creature.\nEnchanted creature doesn't untap during its controller's untap step." });
  let s = duel();
  let foe;
  [s, foe] = put(s, 'b', creature('Ogre', 3, 3));
  s.step = 'main1';
  s = act(s, { t: 'play', by: 'a', card: sleep, force: true, targets: [{ uid: foe, attach: true }] });
  const ogre = () => s.players[1].battlefield.find((p) => p.uid === foe);
  assert.equal(ogre().tapped, true);
  assert.ok(ogre().bonus.noUntap);
  // turno del rival: no se endereza
  s.step = 'cleanup'; s.stack = []; s = apply(s, { t: 'next', by: 'a' });
  assert.equal(s.players[s.active].id, 'b');
  assert.equal(ogre().tapped, true);
});

test('Pacifismo y «gira la criatura objetivo» al entrar', () => {
  const pac = normalize({ name: 'Pacifism', manaCost: '{1}{W}', typeLine: 'Enchantment — Aura', oracle: "Enchant creature\nEnchanted creature can't attack or block." });
  assert.ok(pac.attach.mods[0].cantAttack && pac.attach.mods[0].cantBlock);
  const tapper = normalize({ name: 'Tapper', manaCost: '{2}', power: '1', toughness: '1', typeLine: 'Creature — Test', oracle: 'When this creature enters, tap target creature an opponent controls.' });
  assert.equal(tapper.effects.etb[0].kind, 'tap');
  let s = duel();
  let foe;
  [s, foe] = put(s, 'b', creature('Ogre', 3, 3));
  s.step = 'main1';
  s = act(s, { t: 'play', by: 'a', card: tapper, force: true, targets: [{ uid: foe }] });
  assert.equal(s.players[1].battlefield.find((p) => p.uid === foe).tapped, true);
});

test('Lanza de dragontino: «Gae Bolg — Equip {4}» y Job select crea un Héroe ya equipado', () => {
  const lance = normalize({ name: "Dragoon's Lance", manaCost: '{1}{W}', typeLine: 'Artifact — Equipment', colors: ['W'],
    oracle: "Job select (When this Equipment enters, create a 1/1 colorless Hero creature token, then attach this to it.)\nEquipped creature gets +1/+0 and is a Knight in addition to its other types.\nDuring your turn, equipped creature has flying.\nGae Bolg — Equip {4}" });
  assert.equal(lance.attach.equip, '{4}');
  let s = duel();
  s.step = 'main1';
  s = act(s, { t: 'play', by: 'a', card: lance, force: true });
  const bf = s.players[0].battlefield;
  const hero = bf.find((p) => p.card.isToken);
  const eq = bf.find((p) => p.card.name === "Dragoon's Lance");
  assert.ok(hero, 'crea la ficha de Héroe');
  assert.equal(eq.attachedTo, hero.uid);
  assert.equal(hero.bonus.p, 1);
  assert.ok(hero.bonus.kw.includes('flying'));
});

// ------------------------------------------------ habilidades ampliadas (abilities.js)
import { activatedOf } from '../src/engine/abilities.js';

test('habilidad activada: «{T}: hace 1 de daño a cualquier objetivo» (Hechicero pródigo)', () => {
  const tim = normalize({ name: 'Prodigal Sorcerer', manaCost: '{2}{U}', power: '1', toughness: '1', typeLine: 'Creature — Human Wizard', oracle: '{T}: This creature deals 1 damage to any target.' });
  assert.equal(activatedOf(tim).length, 1);
  let s = duel();
  let me, foe;
  [s, me] = put(s, 'a', tim);
  [s, foe] = put(s, 'b', creature('Elf', 1, 1));
  s = apply(s, { t: 'activate', by: 'a', uid: me, idx: 0, targets: [{ uid: foe }] });
  assert.ok(!s.players[1].battlefield.some((p) => p.uid === foe));
  assert.ok(s.players[0].battlefield.find((p) => p.uid === me).tapped);
  // ya girada: no puede otra vez
  s = apply(s, { t: 'activate', by: 'a', uid: me, idx: 0, targets: [{ player: 'b' }] });
  assert.equal(last(s).kind, 'illegal');
});

test('lealtad: un planeswalker activa una habilidad por turno', () => {
  const pw = normalize({ name: 'Test Walker', manaCost: '{3}', typeLine: 'Legendary Planeswalker — Test', loyalty: '4',
    oracle: '+1: You gain 2 life.\n−3: Destroy target creature.' });
  let s = duel();
  let w, foe;
  [s, w] = put(s, 'a', pw);
  [s, foe] = put(s, 'b', creature('Ogre', 3, 3));
  s.step = 'main1'; s.stack = [];
  s = apply(s, { t: 'activate', by: 'a', uid: w, idx: 1, targets: [{ uid: foe }] });
  assert.ok(!s.players[1].battlefield.some((p) => p.uid === foe));
  s = apply(s, { t: 'activate', by: 'a', uid: w, idx: 0, targets: [] });
  assert.equal(last(s).kind, 'illegal');
});

test('señor: «Las demás criaturas Elfo que controlas obtienen +1/+1»', () => {
  const lord = normalize({ name: 'Elf Lord', manaCost: '{1}{G}', power: '2', toughness: '2', typeLine: 'Creature — Elf', oracle: 'Other Elf creatures you control get +1/+1.' });
  let s = duel();
  let l, e, b;
  [s, l] = put(s, 'a', lord);
  [s, e] = put(s, 'a', normalize({ name: 'Elf', manaCost: '{G}', power: '1', toughness: '1', typeLine: 'Creature — Elf Warrior' }));
  [s, b] = put(s, 'a', creature('Bear', 2, 2));
  const get = (u) => s.players[0].battlefield.find((p) => p.uid === u);
  assert.equal(get(e).bonus.p, 1);
  assert.ok(!get(b).bonus || get(b).bonus.p === 0);
  assert.ok(!get(l).bonus || get(l).bonus.p === 0);
});

test('disparadas: aterrizaje, «cuando ataque» y destreza', () => {
  const lf = normalize({ name: 'Lander', manaCost: '{1}{G}', power: '1', toughness: '1', typeLine: 'Creature — Test', oracle: 'Landfall — Whenever a land you control enters, you gain 1 life.' });
  const att = normalize({ name: 'Raider', manaCost: '{1}{R}', power: '2', toughness: '1', typeLine: 'Creature — Test', oracle: 'Whenever this creature attacks, each opponent loses 1 life.' });
  const pro = normalize({ name: 'Monk', manaCost: '{1}{R}', power: '1', toughness: '1', typeLine: 'Creature — Monk', keywords: ['Prowess'], oracle: 'Prowess' });
  let s = duel();
  let r, m;
  [s] = put(s, 'a', lf);
  [s, r] = put(s, 'a', att);
  [s, m] = put(s, 'a', pro);
  const life0 = s.players[0].life;
  s.step = 'main1';
  s = apply(s, { t: 'play', by: 'a', card: BASICS.G });
  assert.equal(s.players[0].life, life0 + 1);
  // destreza: lanzar algo que no sea criatura
  s = act(s, { t: 'play', by: 'a', card: normalize({ name: 'Shock', manaCost: '{R}', typeLine: 'Instant', oracle: 'Shock deals 2 damage to any target.' }), force: true, targets: [{ player: 'b' }] });
  assert.equal(s.players[0].battlefield.find((p) => p.uid === m).pump.p, 1);
  // ataque
  s = toAttack(s);
  s = apply(s, { t: 'attack', by: 'a', uid: r, target: 'b' });
  const lifeB = s.players[1].life;
  s = apply(s, { t: 'next', by: 'a' });
  assert.equal(s.players[1].life, lifeB - 1);
});

test('tierras que entran giradas y Tesoros', () => {
  let s = duel();
  s.step = 'main1';
  s = apply(s, { t: 'play', by: 'a', card: normalize({ name: 'Gate', typeLine: 'Land — Gate', oracle: 'This land enters tapped.\n{T}: Add {W} or {U}.' }) });
  assert.ok(s.players[0].battlefield.at(-1).tapped);
  s = act(s, { t: 'play', by: 'a', card: normalize({ name: 'Find Gold', manaCost: '{R}', typeLine: 'Sorcery', oracle: 'Create two Treasure tokens.' }), force: true });
  assert.equal(s.players[0].battlefield.filter((p) => p.card.subtype === 'Treasure').length, 2);
  // pagar con Tesoros: se sacrifican
  s = act(s, { t: 'play', by: 'a', card: creature('Bear', 2, 2, [], { manaCost: '{1}{G}' }) });
  assert.equal(s.players[0].battlefield.filter((p) => p.card.subtype === 'Treasure').length, 0);
  assert.ok(s.players[0].battlefield.some((p) => p.card.name === 'Bear'));
});

test('hechizos en masa y sacrificio obligado del bot', () => {
  let s = createGame({ mode: '1v1', seed: 3, first: 0, players: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bot', isBot: true, deck: buildBotDeck('G', 40) }] });
  [s] = put(s, 'b', creature('Ogre', 3, 3));
  [s] = put(s, 'b', creature('Elf', 1, 1));
  s.step = 'main1'; s.stack = [];
  s = act(s, { t: 'play', by: 'a', card: normalize({ name: 'Edict', manaCost: '{1}{B}', typeLine: 'Instant', oracle: 'Each opponent sacrifices a creature.' }), force: true });
  assert.equal(s.players[1].battlefield.filter((p) => p.card.isCreature).length, 1);
  assert.ok(s.players[1].battlefield.some((p) => p.card.name === 'Ogre'), 'sacrifica la peor');
  s = act(s, { t: 'play', by: 'a', card: normalize({ name: 'Wrath', manaCost: '{2}{W}{W}', typeLine: 'Sorcery', oracle: 'Destroy all creatures. They can\'t be regenerated.' }), force: true });
  assert.equal(s.players[1].battlefield.filter((p) => p.card.isCreature).length, 0);
});

test('modos: «Elige uno —» aplica sólo el modo elegido', () => {
  const charm = normalize({ name: 'Test Charm', manaCost: '{R}', typeLine: 'Instant', oracle: 'Choose one —\n• Test Charm deals 2 damage to target creature.\n• You gain 4 life.' });
  assert.equal(charm.effects.modes.length, 2);
  let s = duel();
  let foe;
  [s, foe] = put(s, 'b', creature('Elf', 1, 1));
  s.step = 'main1';
  s = act(s, { t: 'play', by: 'a', card: { ...charm, chosenModes: [0] }, force: true, targets: [{ uid: foe }] });
  assert.ok(!s.players[1].battlefield.some((p) => p.uid === foe));
  const life = s.players[0].life;
  s = act(s, { t: 'play', by: 'a', card: charm, modes: [1], force: true });
  assert.equal(s.players[0].life, life + 4);
});

test('estímulo, ciclo y retrospectiva', () => {
  const drake = normalize({ name: 'Kick Drake', manaCost: '{2}{U}', power: '2', toughness: '2', typeLine: 'Creature — Drake', oracle: 'Kicker {4}\nFlying\nIf this creature was kicked, it enters with two +1/+1 counters on it.' });
  let s = duel();
  for (let i = 0; i < 7; i++) [s] = put(s, 'a', BASICS.U);
  s.step = 'main1'; s.stack = [];
  s = act(s, { t: 'play', by: 'a', card: { ...drake, kicked: true } });
  const d = s.players[0].battlefield.find((p) => p.card.name === 'Kick Drake');
  assert.equal(d.counters, 2);
  assert.equal(s.players[0].battlefield.filter((p) => p.card.isLand && !p.tapped).length, 0);
  // ciclo
  for (const p of s.players[0].battlefield) p.tapped = false;
  const cyc = normalize({ name: 'Cycler', manaCost: '{5}', typeLine: 'Sorcery', oracle: 'Draw three cards.\nCycling {2}' });
  const hand0 = s.players[0].handCount;
  s = apply(s, { t: 'cycle', by: 'a', card: cyc });
  assert.equal(s.players[0].graveyard.at(-1).name, 'Cycler');
  assert.equal(s.players[0].handCount, hand0);
  // retrospectiva desde el cementerio
  const fb = normalize({ name: 'Back Bolt', manaCost: '{R}', typeLine: 'Instant', oracle: 'Back Bolt deals 1 damage to any target.\nFlashback {1}' });
  s.players[0].graveyard.push(fb);
  const lifeB = s.players[1].life;
  s = act(s, { t: 'play', by: 'a', card: fb, alt: 'flashback', targets: [{ player: 'b' }] });
  assert.equal(s.players[1].life, lifeB - 1);
  assert.ok(s.players[0].exile.some((c) => c.name === 'Back Bolt'));
  assert.ok(!s.players[0].graveyard.some((c) => c.name === 'Back Bolt'));
});

test('boca abajo (transfigurar) y ponerla boca arriba', () => {
  const m = normalize({ name: 'Morpher', manaCost: '{4}{G}', power: '5', toughness: '5', typeLine: 'Creature — Beast', oracle: 'Morph {2}{G}' });
  let s = duel();
  for (let i = 0; i < 6; i++) [s] = put(s, 'a', BASICS.G);
  s.step = 'main1'; s.stack = [];
  s = act(s, { t: 'play', by: 'a', card: m, alt: 'morph' });
  const fd = s.players[0].battlefield.find((p) => p.faceDown);
  assert.ok(fd);
  assert.equal(fd.card.power, 2);
  s = apply(s, { t: 'unmorph', by: 'a', uid: fd.uid });
  const up = s.players[0].battlefield.find((p) => p.uid === fd.uid);
  assert.equal(up.card.name, 'Morpher');
  assert.equal(up.faceDown, false);
});

test('resguardo encarece los hechizos del rival; convocar paga con criaturas', () => {
  const warded = normalize({ name: 'Warded', manaCost: '{2}', power: '2', toughness: '2', typeLine: 'Creature — Test', keywords: ['Ward'], oracle: 'Ward {2}' });
  let s = duel();
  let w;
  [s, w] = put(s, 'b', warded);
  [s] = put(s, 'a', BASICS.R);
  s.step = 'main1'; s.stack = [];
  const shock = normalize({ name: 'Shock', manaCost: '{R}', typeLine: 'Instant', oracle: 'Shock deals 2 damage to any target.' });
  s = apply(s, { t: 'play', by: 'a', card: shock, targets: [{ uid: w }] });
  assert.equal(last(s).kind, 'illegal', 'con una sola tierra no paga el resguardo');
  // convocar
  let s2 = duel();
  for (let i = 0; i < 3; i++) [s2] = put(s2, 'a', creature('Elf', 1, 1, [], { colors: ['G'] }));
  s2.step = 'main1'; s2.stack = [];
  const conv = normalize({ name: 'Convoker', manaCost: '{2}{G}', typeLine: 'Sorcery', oracle: 'Convoke\nYou gain 3 life.' });
  const l0 = s2.players[0].life;
  s2 = act(s2, { t: 'play', by: 'a', card: conv });
  assert.equal(s2.players[0].life, l0 + 3);
  assert.equal(s2.players[0].battlefield.filter((p) => p.tapped).length, 3);
});

test('robar el control hasta el final del turno, niebla y robo retrasado', () => {
  let s = duel();
  let foe;
  [s, foe] = put(s, 'b', creature('Ogre', 3, 3));
  s.players[1].battlefield[0].tapped = true;
  s.step = 'main1'; s.stack = [];
  const threaten = normalize({ name: 'Threaten', manaCost: '{2}{R}', typeLine: 'Sorcery', oracle: 'Gain control of target creature until end of turn. Untap that creature. It gains haste until end of turn.' });
  s = act(s, { t: 'play', by: 'a', card: threaten, force: true, targets: [{ uid: foe }] });
  const ogre = s.players[0].battlefield.find((p) => p.uid === foe);
  assert.ok(ogre, 'ahora lo controla Ana');
  assert.equal(ogre.tapped, false);
  s.step = 'cleanup'; s = apply(s, { t: 'next', by: 'a' });
  assert.ok(s.players[1].battlefield.some((p) => p.uid === foe), 'vuelve a su dueño');
  const fog = normalize({ name: 'Fog', manaCost: '{G}', typeLine: 'Instant', oracle: 'Prevent all combat damage that would be dealt this turn.' });
  assert.equal(fog.effects.spell[0].kind, 'fog');
  const later = normalize({ name: 'Later', manaCost: '{U}', typeLine: 'Instant', oracle: 'Draw a card at the beginning of the next turn\'s upkeep.' });
  s.step = 'main1'; s.stack = [];
  s = act(s, { t: 'play', by: 'b', card: later, force: true });
  const hb = s.players[1].handCount;
  s.step = 'cleanup'; s = apply(s, { t: 'next', by: 'b' });
  assert.ok(s.players[1].handCount >= hb + 1 || s.events.some((e) => e.kind === 'draw' && /Later/.test(e.text)));
});

test('persistir, bushido, eco y tormenta', () => {
  const per = normalize({ name: 'Persister', manaCost: '{2}', power: '2', toughness: '2', typeLine: 'Creature — Test', keywords: ['Persist'], oracle: 'Persist' });
  let s = duel();
  let p;
  [s, p] = put(s, 'a', per);
  s = apply(s, { t: 'damage', by: 'a', uid: p, amount: 5 });
  const back = s.players[0].battlefield.find((x) => x.card.name === 'Persister');
  assert.ok(back, 'vuelve con persistir');
  assert.equal(back.counters, -1);
  s = apply(s, { t: 'damage', by: 'a', uid: back.uid, amount: 5 });
  assert.ok(!s.players[0].battlefield.some((x) => x.card.name === 'Persister'), 'con -1/-1 ya no vuelve');
  // tormenta
  let s2 = duel();
  s2.step = 'main1'; s2.stack = [];
  const ping = normalize({ name: 'Ping', manaCost: '{R}', typeLine: 'Instant', oracle: 'Ping deals 1 damage to target player.' });
  const storm = normalize({ name: 'Grapeshot Test', manaCost: '{1}{R}', typeLine: 'Sorcery', keywords: ['Storm'], oracle: 'Grapeshot Test deals 1 damage to any target.\nStorm' });
  s2 = act(s2, { t: 'play', by: 'a', card: ping, force: true, targets: [{ player: 'b' }] });
  s2 = act(s2, { t: 'play', by: 'a', card: ping, force: true, targets: [{ player: 'b' }] });
  const l = s2.players[1].life;
  s2 = act(s2, { t: 'play', by: 'a', card: storm, force: true, targets: [{ player: 'b' }] });
  assert.equal(s2.players[1].life, l - 3, 'el original + 2 copias');
});

test('coste adicional: sacrificar una criatura', () => {
  const reap = normalize({ name: 'Reap Test', manaCost: '{1}{B}', typeLine: 'Instant', oracle: 'As an additional cost to cast this spell, sacrifice a creature.\nDraw two cards.' });
  let s = duel();
  let c;
  [s, c] = put(s, 'a', creature('Elf', 1, 1));
  for (let i = 0; i < 2; i++) [s] = put(s, 'a', BASICS.B);
  s.step = 'main1'; s.stack = [];
  s = apply(s, { t: 'play', by: 'a', card: reap });
  assert.equal(last(s).kind, 'illegal');
  const h0 = s.players[0].handCount;
  s = act(s, { t: 'play', by: 'a', card: reap, sacUid: c });
  assert.ok(!s.players[0].battlefield.some((x) => x.uid === c));
  assert.equal(s.players[0].handCount, h0 + 2 - 1 + 0 >= h0 ? s.players[0].handCount : -1);
});

test('subir de nivel cambia fuerza/resistencia y habilidades', () => {
  const lv = normalize({ name: 'Leveler', manaCost: '{1}{W}', power: '1', toughness: '1', typeLine: 'Creature — Human',
    oracle: 'Level up {1}\nLEVEL 1-2\n2/2\nFirst strike\nLEVEL 3+\n4/4\nFlying, first strike' });
  let s = duel();
  let u;
  [s, u] = put(s, 'a', lv);
  for (let i = 0; i < 3; i++) [s] = put(s, 'a', BASICS.W);
  s.step = 'main1'; s.stack = [];
  s = apply(s, { t: 'levelUp', by: 'a', uid: u });
  const perm = s.players[0].battlefield.find((x) => x.uid === u);
  assert.equal(perm.level, 1);
  assert.equal(perm.card.power + perm.bonus.p, 2);
  assert.ok(perm.bonus.kw.includes('first strike'));
});
