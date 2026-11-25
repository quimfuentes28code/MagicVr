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

// Detección automática de la superficie de la mesa (punto de fuga)
import { detectSurface } from '../src/surface.js';

function tableScene(vp, W = 320, H = 240) {
  // textura de mesa (vetas verticales y un tapete) proyectada con perspectiva hacia vp
  const along = (bx, by, yt) => [vp[0] + (bx - vp[0]) * (yt - vp[1]) / (by - vp[1]), yt];
  const bl = [-20, H + 10];
  const br = [W + 20, H + 10];
  const dst = vp ? [along(...bl, 25), along(...br, 25), br, bl] : [[-10, -10], [W + 10, -10], [W + 10, H + 10], [-10, H + 10]];
  const Hm = homography(dst, [[0, 0], [400, 0], [400, 300], [0, 300]]);
  const g = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [u, v] = applyH(Hm, x, y);
    let c = 60;
    if (u >= 0 && u <= 400 && v >= 0 && v <= 300) {
      c = 130;
      if (u % 40 < 4) c = 95;
      if ((u > 30 && u < 36) || (u > 364 && u < 370) || (v > 30 && v < 36) || (v > 264 && v < 270)) c = 40;
    }
    g[y * W + x] = c;
  }
  return g;
}

test('detecta el punto de fuga de una mesa vista en ángulo', () => {
  const W = 320, H = 240;
  const r = detectSurface(tableScene([170, -180]), W, H);
  assert.ok(!r.topDown, 'no debe ser cenital');
  assert.ok(Math.abs(r.vp[0] - 170 / W) < 0.06, 'x del punto de fuga ' + r.vp[0]);
  assert.ok(Math.abs(r.vp[1] - -180 / H) < 0.2, 'y del punto de fuga ' + r.vp[1]);
  assert.equal(r.quad.length, 4);
});

test('cámara cenital: sin perspectiva', () => {
  const r = detectSurface(tableScene(null), 320, 240);
  assert.ok(r.topDown);
});
