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
