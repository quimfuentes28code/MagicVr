// Magic AR · salas de voz de Discord para las partidas online.
//
// Esta función es la ÚNICA que habla con Discord. El token del bot vive como
// secreto de Supabase (DISCORD_BOT_TOKEN), nunca en la app ni en el repo.
//
// Secretos (Supabase → Edge Functions → Secrets):
//   DISCORD_BOT_TOKEN    token del bot
//   DISCORD_GUILD_ID     ID del servidor de Discord
//   DISCORD_CATEGORY_ID  (opcional) ID de la categoría «Partidas»; si falta, se busca o se crea
//   SWEEP_SECRET         clave para la limpieza programada (cron)
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los pone Supabase solo.
//
// Acciones (POST JSON { action, ... }):
//   register { code, mode }   el anfitrión registra su sala → { secret }
//   status   { code }         ¿hay sala de voz para este código? → { active, invite }
//   open     { code }         crea (una sola vez) el canal y devuelve la invitación → { invite }
//   close    { code, secret } el anfitrión cierra la sala: se borra el canal
//   sweep                     limpieza (cabecera x-sweep-secret)

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  LIMITS, CATEGORY_NAME, normalizeCode, isValidCode, isValidMode, channelName, userLimit,
  roomStatus, rateDecision, channelsToSweep, clientIp,
} from './logic.js';

const env = (k: string) => Deno.env.get(k) || '';
const BOT_TOKEN = env('DISCORD_BOT_TOKEN');
const GUILD_ID = env('DISCORD_GUILD_ID');
const SWEEP_SECRET = env('SWEEP_SECRET');
const API = 'https://discord.com/api/v10';

const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (error: string, status = 400) => json({ ok: false, error }, status);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hourAgo = () => new Date(Date.now() - 3600e3).toISOString();

// ------------------------------------------------------------------ Discord
async function discord(method: string, path: string, body?: unknown) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(API + path, {
      method,
      headers: { Authorization: 'Bot ' + BOT_TOKEN, 'Content-Type': 'application/json', 'User-Agent': 'DiscordBot (https://github.com/quimfuentes28code/MagicVr, 1.0)' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.status === 429) {
      const j = await r.json().catch(() => ({}));
      await sleep(Math.min(5, Number(j.retry_after) || 1) * 1000);
      continue;
    }
    if (r.status === 204) return null;
    const j = await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(new Error(`Discord ${r.status}: ${j?.message || ''}`), { status: r.status });
    return j;
  }
  throw new Error('Discord está saturado. Prueba en unos segundos.');
}

let categoryId = env('DISCORD_CATEGORY_ID');
async function category(): Promise<string> {
  if (categoryId) return categoryId;
  const chans = await discord('GET', `/guilds/${GUILD_ID}/channels`);
  const found = chans.find((c: any) => c.type === 4 && c.name.toLowerCase() === CATEGORY_NAME.toLowerCase());
  categoryId = found ? found.id : (await discord('POST', `/guilds/${GUILD_ID}/channels`, { name: CATEGORY_NAME, type: 4 })).id;
  return categoryId;
}

async function deleteChannel(id: string | null) {
  if (!id || id === 'pending') return;
  try { await discord('DELETE', `/channels/${id}`); } catch (e) { if ((e as any).status !== 404) throw e; }
}

// ---------------------------------------------------------------- utilidades
async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Usuario de Magic AR (si ha entrado en su cuenta): opcional. */
async function userId(req: Request): Promise<string | null> {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token || token.startsWith('sb_') || token.split('.').length !== 3) return null;
  try {
    const { data } = await db.auth.getUser(token);
    return data.user?.id || null;
  } catch { return null; }
}

async function countEvents(kind: string, ip: string, user: string | null) {
  const q = () => db.from('voice_events').select('id', { count: 'exact', head: true }).eq('kind', kind).gte('created_at', hourAgo());
  const byIp = (await q().eq('ip', ip)).count || 0;
  const byUser = user ? (await q().eq('user_id', user)).count || 0 : 0;
  return { byIp, byUser };
}

const getRoom = async (code: string) => (await db.from('voice_rooms').select('*').eq('code', code).maybeSingle()).data;

// ------------------------------------------------------------------ acciones
async function register(code: string, mode: string, ip: string, user: string | null) {
  if (!isValidMode(mode)) return fail('Modo de partida no válido.');
  const room = await getRoom(code);
  if (room && roomStatus(room) === 'ok') return fail('Ese código de partida ya tiene sala.', 409);
  const rate = rateDecision({ kind: 'register', ...(await countEvents('register', ip, user)) });
  if (!rate.ok) return fail(rate.reason, 429);
  if (room) { await deleteChannel(room.channel_id).catch(() => {}); await db.from('voice_rooms').delete().eq('code', code); }
  const secret = crypto.randomUUID() + crypto.randomUUID();
  const { error } = await db.from('voice_rooms').insert({ code, mode, host_secret_hash: await sha256(secret), ip, user_id: user });
  if (error) return fail('No se pudo registrar la sala.', 500);
  await db.from('voice_events').insert({ kind: 'register', ip, user_id: user });
  return json({ ok: true, secret });
}

async function status(code: string) {
  const room = await getRoom(code);
  const active = roomStatus(room) === 'ok';
  return json({ ok: true, active, mode: active ? room.mode : null, invite: active ? room.invite_url : null });
}

async function open(code: string, ip: string, user: string | null) {
  let room = await getRoom(code);
  const st = roomStatus(room);
  if (st === 'missing') return fail('Esa partida no existe.', 404);
  if (st !== 'ok') return fail('La partida ya ha terminado.', 410);
  if (room.invite_url) return json({ ok: true, invite: room.invite_url });

  // Sólo una petición crea el canal: se «reserva» poniendo channel_id = 'pending'.
  const stale = new Date(Date.now() - 30e3).toISOString();
  if (room.channel_id === null || (room.channel_id === 'pending' && Date.parse(room.channel_claimed_at) < Date.now() - 30e3)) {
    const rate = rateDecision({
      kind: 'channel',
      ...(await countEvents('channel', ip, user)),
      open: (await db.from('voice_rooms').select('code', { count: 'exact', head: true }).not('channel_id', 'is', null).is('closed_at', null)).count || 0,
    });
    if (!rate.ok) return fail(rate.reason, 429);
    const { data: claimed } = await db.from('voice_rooms')
      .update({ channel_id: 'pending', channel_claimed_at: new Date().toISOString() })
      .eq('code', code).is('closed_at', null)
      .or(`channel_id.is.null,and(channel_id.eq.pending,channel_claimed_at.lt.${stale})`)
      .select('code');
    if (claimed && claimed.length) {
      let channel: any = null;
      try {
        channel = await discord('POST', `/guilds/${GUILD_ID}/channels`, { name: channelName(code), type: 2, parent_id: await category(), user_limit: userLimit(room.mode) });
        const inv = await discord('POST', `/channels/${channel.id}/invites`, { max_age: LIMITS.inviteMaxAgeSeconds, max_uses: 0, unique: true });
        const invite = `https://discord.gg/${inv.code}`;
        await db.from('voice_rooms').update({ channel_id: channel.id, invite_url: invite, channel_created_at: new Date().toISOString() }).eq('code', code);
        await db.from('voice_events').insert({ kind: 'channel', ip, user_id: user });
        return json({ ok: true, invite });
      } catch (e) {
        console.error('open', e);
        await deleteChannel(channel?.id).catch(() => {});
        await db.from('voice_rooms').update({ channel_id: null, channel_claimed_at: null }).eq('code', code);
        return fail('No se pudo crear la sala de voz en Discord.', 502);
      }
    }
  }
  // Otro jugador la está creando ahora mismo: esperamos a que termine.
  for (let i = 0; i < 10; i++) {
    await sleep(800);
    room = await getRoom(code);
    if (room?.invite_url) return json({ ok: true, invite: room.invite_url });
  }
  return fail('La sala de voz se está creando. Vuelve a pulsar en unos segundos.', 503);
}

async function close(code: string, secret: string) {
  const room = await getRoom(code);
  if (!room) return json({ ok: true });
  if (!secret || (await sha256(secret)) !== room.host_secret_hash) return fail('No puedes cerrar esta sala.', 403);
  await db.from('voice_rooms').update({ closed_at: new Date().toISOString() }).eq('code', code);
  await deleteChannel(room.channel_id);
  return json({ ok: true });
}

/** Red de seguridad: borra canales de partida viejos y cierra salas caducadas. */
async function sweep() {
  const now = Date.now();
  let deleted = 0;
  const cat = await category();
  const chans = await discord('GET', `/guilds/${GUILD_ID}/channels`);
  for (const c of channelsToSweep(chans, cat, now)) {
    await deleteChannel(c.id).catch((e) => console.error('sweep', e));
    await db.from('voice_rooms').update({ closed_at: new Date().toISOString() }).eq('channel_id', c.id).is('closed_at', null);
    deleted++;
  }
  // Salas caducadas que aún tengan canal.
  const old = new Date(now - LIMITS.roomTtlHours * 3600e3).toISOString();
  const { data: expired } = await db.from('voice_rooms').select('code, channel_id').is('closed_at', null).lt('created_at', old);
  for (const r of expired || []) {
    await deleteChannel(r.channel_id).catch(() => {});
    await db.from('voice_rooms').update({ closed_at: new Date().toISOString() }).eq('code', r.code);
  }
  // Limpieza de registros antiguos.
  const day = new Date(now - 24 * 3600e3).toISOString();
  await db.from('voice_events').delete().lt('created_at', day);
  await db.from('voice_rooms').delete().lt('created_at', new Date(now - 48 * 3600e3).toISOString());
  return { deleted, expired: (expired || []).length };
}

let lastSweep = 0;
function maybeSweep() {
  if (Date.now() - lastSweep < 10 * 60e3) return;
  lastSweep = Date.now();
  const p = sweep().catch((e) => console.error('sweep', e));
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil?.(p);
}

// ------------------------------------------------------------------ entrada
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail('Método no permitido.', 405);
  if (!BOT_TOKEN || !GUILD_ID) return fail('Las salas de voz no están configuradas.', 503);
  let body: any;
  try { body = await req.json(); } catch { return fail('Petición no válida.'); }
  const action = String(body?.action || '');
  try {
    if (action === 'sweep') {
      if (!SWEEP_SECRET || req.headers.get('x-sweep-secret') !== SWEEP_SECRET) return fail('No autorizado.', 401);
      lastSweep = Date.now();
      return json({ ok: true, ...(await sweep()) });
    }
    const code = normalizeCode(body.code);
    if (!isValidCode(code)) return fail('Código de partida no válido.');
    maybeSweep();
    const ip = clientIp(req.headers);
    if (action === 'register') return await register(code, String(body.mode || ''), ip, await userId(req));
    if (action === 'status') return await status(code);
    if (action === 'open') return await open(code, ip, await userId(req));
    if (action === 'close') return await close(code, String(body.secret || ''));
    return fail('Acción desconocida.');
  } catch (e) {
    console.error(action, e);
    return fail('Error en la sala de voz.', 500);
  }
});
