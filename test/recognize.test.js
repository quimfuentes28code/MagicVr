// Reconocimiento por imagen: base de huellas y cálculo de la huella.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseCardHash, hashFromInner, nearest, WORDS, BITS, STRIDE } from '../src/recognize.js';

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
  const q = db.hashes.slice(1234 * STRIDE, 1235 * STRIDE);
  const [[d, i]] = nearest(db, q, 1);
  assert.equal(d, 0);
  assert.equal(db.oracle(i), db.oracle(1234));
});

test('la huella no cambia con la luz suave (reflejos, sombras)', () => {
  // patrón cualquiera + un degradado suave de luz → casi la misma huella
  const g = new Float32Array(128 * 176);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cellv = Array.from({ length: 16 * 22 }, () => rnd() * 200);
  for (let y = 0; y < 176; y++) for (let x = 0; x < 128; x++) g[y * 128 + x] = cellv[Math.floor(y / 8) * 16 + Math.floor(x / 8)];
  const a = hashFromInner(g);
  const g2 = g.map((v, i) => v * 1.1 + 40 + (i % 128) * 0.3 + Math.floor(i / 128) * 0.2);
  const b = hashFromInner(g2);
  let diff = 0;
  // la huella de paso alto (segunda mitad) no cambia con la luz suave
  for (let w = WORDS; w < STRIDE; w++) { let v = a[w] ^ b[w]; while (v) { diff += v & 1; v >>>= 1; } }
  assert.ok(diff <= 6, 'la luz cambió ' + diff + ' bits');
  // y es la misma con la misma imagen
  assert.deepEqual([...hashFromInner(g)], [...a]);
});
