import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeLibraries } from '../src/account.js';

test('unir la biblioteca del dispositivo con la del perfil', () => {
  const local = { decks: [{ id: 'a', name: 'Rojo', created: 1 }, { id: 'b', name: 'Verde (local)', created: 2 }], collection: { x: { n: 1 } }, updated: 100 };
  const remote = { decks: [{ id: 'b', name: 'Verde (perfil)', created: 2 }, { id: 'c', name: 'Azul', created: 3 }], collection: { y: { n: 2 } }, updated: 200, deleted: [] };
  const m = mergeLibraries(local, remote);
  assert.deepEqual(m.decks.map((d) => d.id).sort(), ['a', 'b', 'c']);
  assert.equal(m.decks.find((d) => d.id === 'b').name, 'Verde (perfil)', 'gana la versión más reciente');
  assert.ok(m.collection.x && m.collection.y);
  // un mazo borrado en el perfil no reaparece
  const m2 = mergeLibraries(local, { ...remote, deleted: ['a'] });
  assert.ok(!m2.decks.some((d) => d.id === 'a'));
  // biblioteca vacía en el dispositivo: se usa la del perfil
  assert.equal(mergeLibraries({ decks: [], collection: {} }, remote), remote);
});
