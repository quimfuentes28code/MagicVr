// Reconocimiento por imagen: base de huellas y cálculo de la huella.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseCardHash, hashFromInner, nearest, WORDS, BITS } from '../src/recognize.js';

const FILE = new URL('../public/cardhash.bin', import.meta.url);

test('la base de huellas se lee y tiene todas las ilustraciones', { skip: !existsSync(FILE) }, () => {
  const buf = readFileSync(FILE);
  const db = parseCardHash(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.ok(db.n > 40000, 'esperaba más de 40.000 ilustraciones, hay ' + db.n);
  assert.equal(WORDS, 11);
  assert.equal(BITS, 330);
  assert.match(db.oracle(0), /^[0-9a-f-]{36}$/);
  assert.match(db.image(0), /^[0-9a-f-]{36}$/);
  // cada huella se encuentra a sí misma a distancia 0
  const q = db.hashes.slice(1234 * WORDS, 1235 * WORDS);
  const [[d, i]] = nearest(db, q, 1);
  assert.equal(d, 0);
  assert.equal(db.oracle(i), db.oracle(1234));
});

test('la huella compara cada zona con la de su derecha', () => {
  // degradado horizontal: cada zona es más clara que la anterior → todos los bits a 1
  const g = new Float32Array(128 * 176);
  for (let y = 0; y < 176; y++) for (let x = 0; x < 128; x++) g[y * 128 + x] = x;
  const h = hashFromInner(g);
  let ones = 0;
  for (let b = 0; b < BITS; b++) if (h[b >> 5] & (1 << (b & 31))) ones++;
  assert.equal(ones, BITS);
  // al revés → todos a 0
  for (let y = 0; y < 176; y++) for (let x = 0; x < 128; x++) g[y * 128 + x] = 200 - x;
  assert.ok(hashFromInner(g).every((w) => w === 0));
});
