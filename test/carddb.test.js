import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const DB = 'public/carddb.json';

test('base de datos completa: busca cualquier carta y empareja lecturas de la cámara', { skip: !existsSync(DB) && 'falta public/carddb.json (npm run carddb)' }, async () => {
  const carddb = await import('../src/carddb.js');
  const { matchKnown } = await import('../src/vision.js');
  const t0 = Date.now();
  const db = carddb._loadForTests(JSON.parse(readFileSync(DB, 'utf8')));
  console.log(`  ${db.records.length} cartas indexadas en ${Date.now() - t0} ms`);
  assert.ok(db.records.length > 30000);

  assert.equal(carddb.cardByName('relampago').name, 'Lightning Bolt');
  assert.equal(carddb.cardByName('Anillo solar').name, 'Sol Ring');
  assert.ok(carddb.searchNames('contrahe').includes('Contrahechizo'));
  assert.equal(carddb.searchNames('Choque')[0], 'Choque', 'el nombre exacto sale el primero');
  assert.equal(carddb.searchNames('shock')[0], 'Shock');

  const cases = [
    ['| Relampago 3 :', 'Lightning Bolt'],
    ['Contrahechizo |', 'Counterspell'],
    ['Anillo so1ar', 'Sol Ring'],
    ['(Atraxa, voz de los magistrados', 'Atraxa, Praetors\' Voice'],
    ['Sol Ring', 'Sol Ring'],
    ['Choque | o p', 'Shock'],
  ];
  const t1 = Date.now();
  for (const [text, name] of cases) assert.equal(matchKnown(text).best?.card.name, name, text);
  console.log(`  ${cases.length} lecturas emparejadas en ${Date.now() - t1} ms`);

  const bolt = carddb.cardByName('Lightning Bolt');
  assert.equal(bolt.printedName, 'Relámpago');
  assert.equal(bolt.effects.spell[0].kind, 'damage');
  assert.match(bolt.image, /^https:\/\/cards\.scryfall\.io\/normal\/front\//);
});
