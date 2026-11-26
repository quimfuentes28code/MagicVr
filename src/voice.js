// Salas de voz de Discord para las partidas online.
//
// La app nunca habla con Discord: llama a la función «discord-voice» de
// Supabase, que es la que guarda el token del bot. Si está apagada
// (DISCORD_VOICE_ENABLED) o falla, el botón simplemente no aparece.

import { SUPABASE_URL, SUPABASE_KEY, DISCORD_VOICE_ENABLED } from './config.js';
import { accessToken } from './account.js';
import { h, toast } from './ui/dom.js';

export const VOICE_LABEL = '🎙️ Sala de voz en Discord';
const ENDPOINT = `${SUPABASE_URL}/functions/v1/discord-voice`;

export const voiceEnabled = () => !!(DISCORD_VOICE_ENABLED && SUPABASE_URL && SUPABASE_KEY);

/** ¿Se enseña el botón? Anfitrión: cuando su sala está registrada. Invitado: cuando el anfitrión dice que hay voz. */
export function voiceButtonVisible({ enabled, role, registered, hostReady, closed }) {
  if (!enabled || closed) return false;
  return role === 'host' ? !!registered : !!hostReady;
}

async function call(action, data = {}, { keepalive = false, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_KEY };
  const token = auth ? await accessToken() : null;
  if (token) headers.Authorization = 'Bearer ' + token;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify({ action, ...data }), keepalive, signal: keepalive ? undefined : ctrl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || 'No se pudo conectar con la sala de voz.');
    return j;
  } finally { clearTimeout(timer); }
}

const isNative = () => !!(globalThis.Capacitor && globalThis.Capacitor.isNativePlatform && globalThis.Capacitor.isNativePlatform());

/**
 * Sala de voz de una partida. role: 'host' (abrió el portal) o 'guest' (entró con el código).
 * El anfitrión la registra en el servidor y avisa a los invitados por la conexión de la partida.
 */
export function voiceRoom({ code, mode = '1v1', role }) {
  const st = { registered: false, hostReady: false, closed: false, secret: null, invite: null, busy: false };
  const buttons = new Set();
  const listeners = new Set();
  const visible = () => voiceButtonVisible({ enabled: voiceEnabled(), role, ...st });
  const refresh = () => {
    for (const b of buttons) {
      b.hidden = !visible();
      b.disabled = st.busy;
      b.textContent = st.busy ? 'Abriendo la sala de voz…' : VOICE_LABEL;
    }
    for (const fn of listeners) fn(visible());
  };

  const onPageHide = () => vr.close();

  const vr = {
    code, mode, role,
    get visible() { return visible(); },
    get ready() { return st.registered; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** Anfitrión: registra la sala en el servidor (así nadie puede abrir canales de partidas que no existen). */
    async register() {
      if (role !== 'host' || !voiceEnabled() || st.registered || st.closed) return false;
      try {
        const r = await call('register', { code, mode });
        if (st.closed) { call('close', { code, secret: r.secret }, { auth: false }).catch(() => {}); return false; }
        st.secret = r.secret;
        st.registered = true;
        globalThis.addEventListener?.('pagehide', onPageHide);
        refresh();
        return true;
      } catch (e) {
        console.warn('voz:', e.message);
        return false;
      }
    },

    /** Invitado: el anfitrión dice si hay sala de voz. */
    setHostReady(ready) {
      if (role !== 'guest' || st.hostReady === !!ready) return;
      st.hostReady = !!ready;
      refresh();
    },

    /** Abre la invitación de Discord (en la app de Discord si está instalada). */
    async open() {
      if (!visible() || st.busy) return;
      if (st.invite) { openUrl(st.invite); return; }
      // La ventana se abre ya (al tocar) para que el navegador no la bloquee.
      const win = isNative() ? null : window.open('', '_blank');
      st.busy = true; refresh();
      try {
        const r = await call('open', { code });
        st.invite = r.invite;
        if (win && !win.closed) { try { win.opener = null; } catch { /* */ } win.location.href = r.invite; } else openUrl(r.invite);
      } catch (e) {
        if (win) win.close();
        toast(e.message || 'No se pudo abrir la sala de voz.', 'warn', 5000);
      } finally { st.busy = false; refresh(); }
    },

    /** Anfitrión: al acabar la partida (o salir) se borra el canal de Discord. */
    close() {
      if (st.closed) return;
      st.closed = true;
      globalThis.removeEventListener?.('pagehide', onPageHide);
      if (role === 'host' && st.secret) call('close', { code, secret: st.secret }, { keepalive: true, auth: false }).catch(() => {});
      refresh();
    },

    /** Botón con el estilo de la app; se enseña y se esconde solo. */
    button(cls = 'gem small voice-btn') {
      const b = h('button', { class: cls, onClick: () => vr.open() }, VOICE_LABEL);
      buttons.add(b);
      refresh();
      return b;
    },
  };
  return vr;
}

function openUrl(url) {
  if (isNative()) window.open(url, '_system');
  else if (!window.open(url, '_blank')) location.href = url;
}

/** Sala que no hace nada (partidas locales). */
export const noVoice = { visible: false, open() {}, close() {}, register: async () => false, setHostReady() {}, button: () => null, onChange: () => () => {} };
