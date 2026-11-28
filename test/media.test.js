import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldSend, shouldCall, mergeMedia, pairQuality, scaleFor, wantOf } from '../src/media.js';
import { clampRatio, fitRect, mapQuad, quadSize, quadUsable, loadSplit, SPLIT_DEFAULTS, SPLIT_LAYOUT, computeWants, rivalStatus } from '../src/ui/split.js';

test('sólo mando mi cámara si la enseño y el otro no la ha ocultado', () => {
  const map = { a: { sharing: true }, b: { sharing: false, wants: {} }, c: { wants: { a: false } } };
  assert.ok(shouldSend(map, 'a', 'b'));
  assert.ok(!shouldSend(map, 'a', 'c')); // c no quiere ver a a
  assert.ok(!shouldSend(map, 'b', 'a')); // b no enseña
  assert.ok(!shouldSend(map, 'a', 'zz')); // desconocido
  assert.ok(!shouldSend({}, 'a', 'b'));
});

test('entre dos jugadores llama sólo uno', () => {
  assert.ok(shouldCall('aaa', 'bbb'));
  assert.ok(!shouldCall('bbb', 'aaa'));
  assert.ok(!shouldCall('aaa', 'aaa'));
  assert.ok(!shouldCall(null, 'bbb'));
});

test('el mapa junta lo nuevo con lo que había', () => {
  const m1 = mergeMedia({}, 'a', { sharing: true, peerId: 'x' });
  const m2 = mergeMedia(m1, 'a', { sharing: false });
  assert.deepEqual(m2.a, { sharing: false, peerId: 'x' });
  assert.deepEqual(m1.a.sharing, true); // no cambia el original
});

test('calidad y reducción de la imagen', () => {
  assert.equal(pairQuality('normal', 'normal'), 'normal');
  assert.equal(pairQuality('normal', 'low'), 'low');
  assert.equal(pairQuality('normal', 'normal', 'thumb'), 'thumb');
  assert.equal(scaleFor(1200, 'thumb'), 5);
  assert.equal(scaleFor(1280, 'normal'), 2);
  assert.equal(scaleFor(320, 'normal'), 1);
  assert.equal(scaleFor(1600, 'low'), 4);
});

test('tamaño de la mitad del rival entre 25 % y 75 %', () => {
  assert.equal(clampRatio(0.1), 0.25);
  assert.equal(clampRatio(0.9), 0.75);
  assert.equal(clampRatio('x'), 0.5);
  assert.equal(clampRatio(0.6), 0.6);
});

test('dónde se ve el vídeo dentro de su caja', () => {
  assert.deepEqual(fitRect(200, 100, 100, 100, 'contain'), { x: 50, y: 0, w: 100, h: 100 });
  assert.deepEqual(fitRect(200, 100, 100, 100, 'cover'), { x: 0, y: -50, w: 200, h: 200 });
  assert.deepEqual(fitRect(200, 100, 0, 0), { x: 0, y: 0, w: 200, h: 100 });
});

test('zonas del rival sobre su vídeo (normal y girado)', () => {
  const q = [[0.1, 0.2], [0.6, 0.2], [0.6, 0.8], [0.1, 0.8]];
  const r = { x: 0, y: 0, w: 100, h: 100 };
  assert.deepEqual(mapQuad(q, r).map((p) => p.map(Math.round)), [[10, 20], [60, 20], [60, 80], [10, 80]]);
  // girado 180°: sigue empezando por la esquina de arriba a la izquierda de la pantalla
  assert.deepEqual(mapQuad(q, r, true).map((p) => p.map(Math.round)), [[40, 20], [90, 20], [90, 80], [40, 80]]);
  assert.deepEqual(quadSize(mapQuad(q, r)), { w: 50, h: 60 });
});

test('cuadriláteros válidos', () => {
  assert.ok(quadUsable([[0.1, 0.2], [0.6, 0.2], [0.6, 0.8], [0.1, 0.8]]));
  assert.ok(!quadUsable(null));
  assert.ok(!quadUsable([[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]])); // diminuto
  assert.ok(!quadUsable([[0, 0], [1, 0], [1, NaN], [0, 1]]));
  assert.ok(!quadUsable([[0, 0], [5, 0], [5, 1], [0, 1]])); // fuera del vídeo
});

test('preferencias por defecto y distribución para media pantalla', () => {
  assert.deepEqual(loadSplit(), SPLIT_DEFAULTS); // sin localStorage
  assert.equal(SPLIT_DEFAULTS.mode, 'split');
  for (const k of ['bl', 'br', 'sx', 'sy', 'sh', 'zx', 'zy', 'zh']) assert.ok(SPLIT_LAYOUT[k] >= 0 && SPLIT_LAYOUT[k] <= 100);
});

test('miniaturas: también se manda vídeo a quien sólo te ve en pequeño', () => {
  const map = { a: { sharing: true }, b: { wants: { a: 'thumb' } } };
  assert.ok(shouldSend(map, 'a', 'b'));
  assert.equal(wantOf(map.b, 'a'), 'thumb');
  assert.equal(wantOf({}, 'a'), true);
});

test('a quién pido vídeo', () => {
  const base = { others: ['b', 'c', 'd'], viewOpp: 'b', seeRival: true };
  assert.deepEqual(computeWants({ ...base, mode: 'split' }), { b: true, c: 'thumb', d: 'thumb' });
  assert.deepEqual(computeWants({ ...base, mode: 'split', thumbs: false }), { b: true, c: false, d: false });
  assert.deepEqual(computeWants({ ...base, mode: 'pip' }), { b: true, c: false, d: false });
  assert.deepEqual(computeWants({ ...base, mode: 'solo' }), { b: false, c: false, d: false });
  assert.deepEqual(computeWants({ ...base, mode: 'solo', overview: true }), { b: true, c: true, d: true });
  assert.deepEqual(computeWants({ ...base, mode: 'split', seeRival: false, overview: true }), { b: false, c: false, d: false });
});

test('texto del recuadro del rival', () => {
  const player = { name: 'Ana' };
  assert.equal(rivalStatus({ player: null }), '');
  assert.match(rivalStatus({ player: { name: 'G', isBot: true }, seeRival: true }), /golem/);
  assert.match(rivalStatus({ player, seeRival: false }), /ocultas/);
  assert.match(rivalStatus({ player, seeRival: true, remote: { online: false } }), /conectando/);
  assert.match(rivalStatus({ player, seeRival: true, remote: { online: true, info: { sharing: false, share: true } } }), /apagada/);
  assert.match(rivalStatus({ player, seeRival: true, remote: { online: true, info: { sharing: false } } }), /no enseña/);
  assert.match(rivalStatus({ player, seeRival: true, remote: { online: true, info: { sharing: true }, state: 'failed' } }), /no se pudo/);
  assert.match(rivalStatus({ player, seeRival: true, remote: { online: true, info: { sharing: true }, state: 'connecting' } }), /conectando la cámara/);
  assert.equal(rivalStatus({ player, seeRival: true, remote: { online: true, info: { sharing: true }, stream: {}, state: 'ok' } }), 'Ana');
});
