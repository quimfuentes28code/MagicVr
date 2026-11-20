import { test } from 'node:test';
import assert from 'node:assert/strict';

// vision.js usa APIs del navegador sólo dentro de funciones; el emparejador es puro.
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const { matchKnown } = await import('../src/vision.js');

test('empareja lecturas OCR imperfectas con cartas oficiales', () => {
  const cases = [
    ['Choque | o p', 'Shock'],
    ['(AngeldeSera ~~ g#&)', 'Serra Angel'],
    ['¥ Murder d >', 'Murder'],
    ['Tierra basica — Bosque', 'Forest'],
    ['| Osos pardos 2 =', 'Grizzly Bears'],
    ['Elfos de Llanowar', 'Llanowar Elves'],
    ['Trasgo furioso', 'Raging Goblin'],
  ];
  for (const [text, name] of cases) assert.equal(matchKnown(text).best?.card.name, name, text);
  assert.equal(matchKnown('asdf qwer').best, null);
});
