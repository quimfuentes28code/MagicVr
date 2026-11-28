import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locateAcross, pickFit } from '../src/cardfit.js';

// mesa con ruido y una carta (borde oscuro, interior claro con «ilustración»)
function scene(W, H, card) {
  const g = new Float32Array(W * H);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < g.length; i++) g[i] = 120 + rnd() * 30;
  if (card) {
    const { cx, cy, h } = card;
    const w = h * 63 / 88;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (Math.abs(dx) < w / 2 && Math.abs(dy) < h / 2) {
        let v = Math.min(w / 2 - Math.abs(dx), h / 2 - Math.abs(dy)) < h * 0.04 ? 20 : 205;
        if (dy > -h * 0.38 && dy < 0 && Math.abs(dx) < w * 0.4) v = 70 + ((x * 3 + y * 5) % 60);
        g[y * W + x] = v;
      }
    }
  }
  return g;
}
const W = 900;
const H = 600;
const crop = (g, cx, cy, ch, out) => {
  const o = new Float32Array(out * out);
  for (let y = 0; y < out; y++) for (let x = 0; x < out; x++) {
    const sx = Math.round(cx - ch / 2 + (x / out) * ch);
    const sy = Math.round(cy - ch / 2 + (y / out) * ch);
    o[y * out + x] = sx >= 0 && sy >= 0 && sx < W && sy < H ? g[sy * W + sx] : 0;
  }
  return { g: o, W: out, H: out, ch, cx, cy };
};
const fit = async (card) => {
  const g = scene(W, H, card);
  const best = await locateAcross(({ scale, dx, dy }, out) => { const ch = 160 * scale; return crop(g, 450 + dx * ch, 300 + dy * ch, ch, out); }, { minScore: 40 });
  if (!best) return null;
  const k = best.ch / best.H;
  return { cx: best.cx - best.ch / 2 + best.res.cx * k, cy: best.cy - best.ch / 2 + best.res.cy * k, h: best.res.h * k };
};

test('el círculo se adapta a una carta más pequeña, igual, más grande o desplazada', async () => {
  for (const card of [{ cx: 470, cy: 290, h: 70 }, { cx: 440, cy: 310, h: 150 }, { cx: 455, cy: 300, h: 300 }, { cx: 330, cy: 290, h: 70 }, { cx: 520, cy: 400, h: 110 }]) {
    const f = await fit(card);
    assert.ok(f, 'encuentra la carta');
    assert.ok(Math.abs(f.h - card.h) / card.h < 0.12, `alto ${f.h} ≈ ${card.h}`);
    assert.ok(Math.hypot(f.cx - card.cx, f.cy - card.cy) < card.h * 0.06, 'centro');
  }
});

test('sin carta, no se inventa nada', async () => {
  assert.equal(await fit(null), null);
});

test('elige la búsqueda con la carta a un tamaño cómodo', () => {
  const mk = (h, score, H = 200) => ({ res: { h, score }, H });
  assert.equal(pickFit([mk(170, 100), mk(110, 98), mk(50, 99)]).res.h, 110);
  assert.equal(pickFit([mk(170, 100), mk(110, 10)]).res.h, 170); // la otra puntúa muy poco
  assert.equal(pickFit([mk(30, 100)]), null); // demasiado pequeña para fiarse
  assert.equal(pickFit([mk(110, 5)], 40), null);
});
