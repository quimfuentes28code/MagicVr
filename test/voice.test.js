import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALPHABET, LIMITS, normalizeCode, isValidCode, isValidMode, channelName, userLimit, isMatchChannelName,
  snowflakeTime, roomStatus, rateDecision, channelsToSweep, clientIp,
} from '../supabase/functions/discord-voice/logic.js';
import { voiceButtonVisible, voiceEnabled, voiceRoom } from '../src/voice.js';
import { DISCORD_VOICE_ENABLED } from '../src/config.js';

// Snowflake de Discord para un instante dado.
const flake = (ms) => String((BigInt(ms) - 1420070400000n) << 22n);
const H = 3600e3;

test('el alfabeto es el mismo que el de los códigos de sala', async () => {
  const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../src/net.js', import.meta.url), 'utf8'));
  assert.ok(src.includes(`'${ALPHABET}'`));
});

test('códigos de partida válidos e inválidos', () => {
  assert.equal(normalizeCode('  abcde '), 'ABCDE');
  assert.ok(isValidCode('ABCDE'));
  assert.ok(isValidCode('xyzwq'));
  assert.ok(!isValidCode('ABCD'));
  assert.ok(!isValidCode('ABCDEF'));
  assert.ok(!isValidCode('ABCDI')); // la I no se usa
  assert.ok(!isValidCode('ABCD0'));
  assert.ok(!isValidCode(null));
  assert.ok(!isValidCode('AB DE'));
});

test('modos y límite de personas', () => {
  assert.ok(isValidMode('1v1') && isValidMode('commander') && !isValidMode('x'));
  assert.equal(userLimit('1v1'), 2);
  assert.equal(userLimit('commander'), 4);
});

test('nombre del canal', () => {
  assert.equal(channelName('abcde'), 'Partida ABCDE');
  assert.ok(isMatchChannelName('Partida ABCDE'));
  assert.ok(!isMatchChannelName('Partida ABC'));
  assert.ok(!isMatchChannelName('General'));
  assert.ok(!isMatchChannelName('partida ABCDE'));
});

test('snowflake → fecha', () => {
  const t = Date.UTC(2026, 10, 26, 12, 0, 0);
  assert.equal(snowflakeTime(flake(t)), t);
  assert.equal(snowflakeTime('175928847299117063'), 1462015105796); // ejemplo de la documentación de Discord
});

test('estado de una sala', () => {
  const now = Date.UTC(2026, 0, 1, 12);
  assert.equal(roomStatus(null, now), 'missing');
  assert.equal(roomStatus({ created_at: new Date(now - H).toISOString() }, now), 'ok');
  assert.equal(roomStatus({ created_at: new Date(now - H).toISOString(), closed_at: new Date(now).toISOString() }, now), 'closed');
  assert.equal(roomStatus({ created_at: new Date(now - (LIMITS.roomTtlHours + 1) * H).toISOString() }, now), 'expired');
});

test('límites contra abusos', () => {
  assert.ok(rateDecision({ kind: 'register', byIp: 0, byUser: 0 }).ok);
  assert.ok(rateDecision({ kind: 'register', byIp: LIMITS.roomsPerHour - 1 }).ok);
  assert.ok(!rateDecision({ kind: 'register', byIp: LIMITS.roomsPerHour }).ok);
  assert.ok(!rateDecision({ kind: 'register', byUser: LIMITS.roomsPerHour }).ok);
  assert.ok(rateDecision({ kind: 'channel', byIp: LIMITS.channelsPerHour - 1 }).ok);
  assert.ok(!rateDecision({ kind: 'channel', byIp: LIMITS.channelsPerHour }).ok);
  const full = rateDecision({ kind: 'channel', open: LIMITS.maxOpenChannels });
  assert.ok(!full.ok);
  assert.match(full.reason, /demasiadas salas de voz abiertas/);
  // el límite global no afecta a registrar salas
  assert.ok(rateDecision({ kind: 'register', open: 999 }).ok);
});

test('limpieza: sólo canales de voz de partida, de la categoría, y viejos', () => {
  const now = Date.UTC(2026, 10, 26, 12);
  const old = flake(now - 5 * H);
  const fresh = flake(now - 1 * H);
  const chans = [
    { id: old, type: 2, parent_id: 'cat', name: 'Partida ABCDE' }, // se borra
    { id: fresh, type: 2, parent_id: 'cat', name: 'Partida FGHJK' }, // reciente
    { id: old, type: 2, parent_id: 'otra', name: 'Partida LMNPQ' }, // otra categoría
    { id: old, type: 2, parent_id: 'cat', name: 'Charla' }, // no es de partida
    { id: old, type: 0, parent_id: 'cat', name: 'Partida RSTUV' }, // de texto
    null,
  ];
  assert.deepEqual(channelsToSweep(chans, 'cat', now).map((c) => c.name), ['Partida ABCDE']);
  assert.deepEqual(channelsToSweep(undefined, 'cat', now), []);
});

test('IP del cliente', () => {
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })), '1.2.3.4');
  assert.equal(clientIp({ 'x-real-ip': '5.6.7.8' }), '5.6.7.8');
  assert.equal(clientIp({}), 'desconocida');
});

test('cuándo se ve el botón', () => {
  assert.ok(!voiceButtonVisible({ enabled: false, role: 'host', registered: true }));
  assert.ok(voiceButtonVisible({ enabled: true, role: 'host', registered: true }));
  assert.ok(!voiceButtonVisible({ enabled: true, role: 'host', registered: false }));
  assert.ok(!voiceButtonVisible({ enabled: true, role: 'host', registered: true, closed: true }));
  assert.ok(voiceButtonVisible({ enabled: true, role: 'guest', hostReady: true }));
  assert.ok(!voiceButtonVisible({ enabled: true, role: 'guest', hostReady: false }));
  assert.ok(!voiceButtonVisible({ enabled: true, role: 'guest', registered: true })); // el invitado depende del anfitrión
});

test('con el interruptor apagado no se llama al servidor ni se ve el botón', async () => {
  assert.equal(voiceEnabled(), DISCORD_VOICE_ENABLED);
  if (DISCORD_VOICE_ENABLED) return;
  const orig = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('no'); };
  try {
    const host = voiceRoom({ code: 'ABCDE', mode: '1v1', role: 'host' });
    assert.equal(await host.register(), false);
    assert.equal(host.visible, false);
    const guest = voiceRoom({ code: 'ABCDE', role: 'guest' });
    guest.setHostReady(true);
    assert.equal(guest.visible, false);
    host.close();
    assert.equal(called, false);
  } finally { globalThis.fetch = orig; }
});
