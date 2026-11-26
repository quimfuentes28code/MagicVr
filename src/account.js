// Cuentas de usuario (Supabase): registro con correo + nombre de usuario +
// contraseña, entrar con usuario (o correo) y contraseña, y la biblioteca
// (mazos y colección) guardada en el perfil y sincronizada entre dispositivos.

import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const accountsEnabled = () => !!(SUPABASE_URL && SUPABASE_KEY);

let client = null;
let current = null; // { id, email, username, rating, wins, losses }
const listeners = new Set();

async function sb() {
  if (!accountsEnabled()) throw new Error('Las cuentas aún no están configuradas.');
  if (!client) {
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'magicar-auth' } });
    client.auth.onAuthStateChange((_ev, session) => { loadProfile(session).catch(() => {}); });
  }
  return client;
}

export const currentUser = () => current;
export function onAccountChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = () => { for (const fn of listeners) fn(current); };

async function loadProfile(session) {
  if (!session) { if (current) { current = null; emit(); } return null; }
  const c = await sb();
  const { data } = await c.from('profiles').select('username, rating, wins, losses').eq('id', session.user.id).maybeSingle();
  current = { id: session.user.id, email: session.user.email, username: data?.username || session.user.user_metadata?.username || 'Planeswalker', rating: data?.rating ?? 1000, wins: data?.wins ?? 0, losses: data?.losses ?? 0 };
  emit();
  return current;
}

/** Al arrancar: recupera la sesión guardada (si la hay). */
export async function initAccount() {
  if (!accountsEnabled()) return null;
  try {
    const c = await sb();
    const { data } = await c.auth.getSession();
    const u = await loadProfile(data.session);
    // rankeds en las que el rival no confirmó a tiempo
    if (u) c.rpc('ranked_claim', {}).then(({ data: n }) => { if (n) loadProfile(data.session); }).catch(() => {});
    return u;
  } catch { return null; }
}

const USER_RE = /^[A-Za-z0-9_]{3,18}$/;

/** Mensajes de error en español. */
function es(e) {
  const m = (e && (e.message || e.error_description || String(e))) || '';
  if (/Invalid login credentials/i.test(m)) return 'Usuario o contraseña incorrectos.';
  if (/Email not confirmed/i.test(m)) return 'Tienes que confirmar tu correo: revisa tu bandeja de entrada (y la de spam).';
  if (/User already registered|already been registered/i.test(m)) return 'Ya existe una cuenta con ese correo.';
  if (/Password should be at least/i.test(m)) return 'La contraseña es demasiado corta (mínimo 8 caracteres).';
  if (/rate limit|too many/i.test(m)) return 'Demasiados intentos. Espera un momento y vuelve a probar.';
  if (/Database error saving new user/i.test(m)) return 'Ese nombre de usuario ya está cogido o no es válido.';
  if (/fetch|network/i.test(m)) return 'No hay conexión con el servidor. Revisa tu internet.';
  return m || 'Algo ha fallado.';
}

export async function signUp({ email, username, password }) {
  username = username.trim();
  email = email.trim();
  if (!USER_RE.test(username)) throw new Error('El nombre de usuario debe tener de 3 a 18 letras, números o guion bajo (_).');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('El correo no parece válido.');
  if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
  const c = await sb();
  const { data: free, error: e1 } = await c.rpc('username_available', { u: username });
  if (e1) throw new Error(es(e1));
  if (!free) throw new Error('Ese nombre de usuario ya está cogido.');
  const { data, error } = await c.auth.signUp({ email, password, options: { data: { username }, emailRedirectTo: location.origin + location.pathname } });
  if (error) throw new Error(es(error));
  if (!data.session) return { needsConfirm: true };
  await loadProfile(data.session);
  return { needsConfirm: false };
}

/** Entrar con nombre de usuario (o correo) y contraseña. */
export async function signIn({ login, password }) {
  login = login.trim();
  const c = await sb();
  let email = login;
  if (!login.includes('@')) {
    const { data, error } = await c.rpc('login_email', { u: login, p: password });
    if (error) throw new Error(es(error));
    if (!data) throw new Error('Usuario o contraseña incorrectos.');
    email = data;
  }
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(es(error));
  return loadProfile(data.session);
}

export async function signOut() {
  const c = await sb();
  await c.auth.signOut();
  current = null;
  emit();
}

export async function resetPassword(email) {
  const c = await sb();
  const { error } = await c.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.href.split('#')[0] });
  if (error) throw new Error(es(error));
}

// ------------------------------------------------------------ biblioteca

/** Biblioteca guardada en el perfil: { data, updated } o null. */
export async function fetchLibrary() {
  if (!current) return null;
  const c = await sb();
  const { data, error } = await c.from('libraries').select('data, updated_at').eq('user_id', current.id).maybeSingle();
  if (error) throw new Error(es(error));
  return data ? { data: data.data, updated: Date.parse(data.updated_at) } : null;
}

export async function pushLibrary(lib) {
  if (!current) return;
  const c = await sb();
  const { error } = await c.from('libraries').upsert({ user_id: current.id, data: lib, updated_at: new Date(lib.updated || Date.now()).toISOString() });
  if (error) throw new Error(es(error));
}

/** Clasificación (para las rankeds). */
export async function leaderboard(limit = 50) {
  const c = await sb();
  const { data, error } = await c.from('leaderboard').select('*').limit(limit);
  if (error) throw new Error(es(error));
  return data || [];
}

/**
 * Une la biblioteca de este dispositivo con la del perfil: mazos de los dos
 * (si el mismo mazo está en ambos, gana el más reciente) y la colección más reciente.
 */
export function mergeLibraries(local, remote) {
  if (!remote || !remote.decks) return local;
  if (!local || (!local.decks.length && !Object.keys(local.collection || {}).length)) return remote;
  const newer = (remote.updated || 0) >= (local.updated || 0) ? remote : local;
  const older = newer === remote ? local : remote;
  const byId = new Map();
  for (const d of older.decks) byId.set(d.id, d);
  for (const d of newer.decks) byId.set(d.id, d);
  const deleted = new Set([...(newer.deleted || [])]);
  const decks = [...byId.values()].filter((d) => !deleted.has(d.id)).sort((a, b) => (b.created || 0) - (a.created || 0));
  return { decks, collection: { ...older.collection, ...newer.collection }, updated: Math.max(local.updated || 0, remote.updated || 0), deleted: [...deleted] };
}

// ------------------------------------------------------------ rankeds

async function rpc(name, args) {
  const c = await sb();
  const { data, error } = await c.rpc(name, args);
  if (error) throw new Error(es(error));
  return data;
}
export const rankedStart = (opponent) => rpc('ranked_start', { opponent });
export const rankedReport = (m, w) => rpc('ranked_report', { m, w });
export const rankedClaim = () => rpc('ranked_claim', {});
export const queueJoin = (c) => rpc('ranked_queue_join', { c });
export const queueTake = () => rpc('ranked_queue_take', {});
export const queueLeave = () => rpc('ranked_queue_leave', {});

export async function rankedMatch(id) {
  const c = await sb();
  const { data, error } = await c.from('ranked_matches').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(es(error));
  return data;
}

/** Vuelve a leer el perfil (puntuación, victorias…). */
export async function refreshProfile() {
  const c = await sb();
  const { data } = await c.auth.getSession();
  return loadProfile(data.session);
}
