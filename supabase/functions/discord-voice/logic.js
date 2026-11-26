// Lógica pura de las salas de voz de Discord (sin red ni Discord): la usan la
// Edge Function (index.ts) y los tests de la app (test/voice.test.js).

/** Letras de los códigos de partida (las mismas que src/net.js: sin I ni O). */
export const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export const LIMITS = {
  roomTtlHours: 6, // una sala registrada vale 6 horas
  inviteMaxAgeSeconds: 6 * 3600, // la invitación de Discord caduca a las 6 horas
  channelMaxAgeHours: 4, // red de seguridad: los canales de partida se borran a las 4 horas
  roomsPerHour: 10, // salas registradas por hora (por IP y por usuario)
  channelsPerHour: 5, // canales de voz creados por hora (por IP y por usuario)
  maxOpenChannels: 25, // canales de partida abiertos a la vez en todo el servidor
};

const CODE_RE = new RegExp(`^[${ALPHABET}]{5}$`);
export const normalizeCode = (c) => String(c || '').trim().toUpperCase();
export const isValidCode = (c) => CODE_RE.test(normalizeCode(c));
export const isValidMode = (m) => m === '1v1' || m === 'commander';

export const CHANNEL_PREFIX = 'Partida ';
export const CATEGORY_NAME = 'Partidas';
export const channelName = (code) => CHANNEL_PREFIX + normalizeCode(code);
/** Duelo: 2 personas. Commander: 4. */
export const userLimit = (mode) => (mode === 'commander' ? 4 : 2);
const CHANNEL_NAME_RE = new RegExp(`^${CHANNEL_PREFIX}[${ALPHABET}]{5}$`);
export const isMatchChannelName = (name) => CHANNEL_NAME_RE.test(String(name || ''));

/** Momento (ms) en que se creó algo de Discord, a partir de su identificador (snowflake). */
export function snowflakeTime(id) {
  return Number((BigInt(String(id)) >> 22n) + 1420070400000n);
}

/** Estado de una sala registrada: 'missing' | 'closed' | 'expired' | 'ok'. */
export function roomStatus(room, now = Date.now()) {
  if (!room) return 'missing';
  if (room.closed_at) return 'closed';
  if (now - Date.parse(room.created_at) > LIMITS.roomTtlHours * 3600e3) return 'expired';
  return 'ok';
}

/**
 * ¿Se permite la acción? kind: 'register' | 'channel'.
 * byIp / byUser: cuántas veces se hizo en la última hora; open: canales abiertos ahora.
 */
export function rateDecision({ kind, byIp = 0, byUser = 0, open = 0 }) {
  const max = kind === 'register' ? LIMITS.roomsPerHour : LIMITS.channelsPerHour;
  if (byIp >= max || byUser >= max) {
    return { ok: false, reason: kind === 'register' ? 'Has creado demasiadas salas en la última hora. Espera un poco.' : 'Has abierto demasiadas salas de voz en la última hora. Espera un poco.' };
  }
  if (kind === 'channel' && open >= LIMITS.maxOpenChannels) {
    return { ok: false, reason: 'Ahora mismo hay demasiadas salas de voz abiertas. Prueba en unos minutos.' };
  }
  return { ok: true };
}

/**
 * Canales de voz de partida que hay que borrar (red de seguridad): los de la
 * categoría de partidas, con nombre «Partida XXXXX», creados hace más de maxAgeHours.
 */
export function channelsToSweep(channels, categoryId, now = Date.now(), maxAgeHours = LIMITS.channelMaxAgeHours) {
  return (channels || []).filter((c) => c && c.type === 2 && String(c.parent_id) === String(categoryId)
    && isMatchChannelName(c.name) && now - snowflakeTime(c.id) > maxAgeHours * 3600e3);
}

/** Primera IP de la cabecera x-forwarded-for (o la que haya). */
export function clientIp(headers) {
  const get = (k) => (headers && typeof headers.get === 'function' ? headers.get(k) : headers && headers[k]) || '';
  return (String(get('x-forwarded-for')).split(',')[0] || get('x-real-ip') || 'desconocida').trim();
}
