import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homography, applyH, invertH, rectToQuad } from '../src/homography.js';

test('la homografía lleva las esquinas del rectángulo al cuadrilátero y se invierte', () => {
  const quad = [[30, 40], [300, 20], [320, 250], [10, 200]];
  const H = rectToQuad(100, 80, quad);
  const corners = [[0, 0], [100, 0], [100, 80], [0, 80]];
  corners.forEach(([x, y], i) => {
    const [u, v] = applyH(H, x, y);
    assert.ok(Math.abs(u - quad[i][0]) < 1e-6 && Math.abs(v - quad[i][1]) < 1e-6);
  });
  const Hi = invertH(H);
  const [x, y] = applyH(Hi, ...applyH(H, 37, 51));
  assert.ok(Math.abs(x - 37) < 1e-6 && Math.abs(y - 51) < 1e-6);
  assert.ok(homography(corners, corners).every((v, i) => Math.abs(v - [1, 0, 0, 0, 1, 0, 0, 0, 1][i]) < 1e-9));
});
