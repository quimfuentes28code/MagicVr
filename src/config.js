// Configuración pública de la app.
// Supabase (cuentas de usuario): la URL del proyecto y su clave pública
// («anon» / «publishable»). Son públicas por diseño: la seguridad la ponen las
// reglas de la base de datos (supabase/schema.sql). También se pueden pasar con
// VITE_SUPABASE_URL / VITE_SUPABASE_KEY al compilar.
const env = import.meta.env || {};
export const SUPABASE_URL = env.VITE_SUPABASE_URL || 'https://tzbkfcljrzwvttgmrrbs.supabase.co';
export const SUPABASE_KEY = env.VITE_SUPABASE_KEY || 'sb_publishable_eJCV-O7v_S_YbtZRLCayMw_PRyhfihr';

// Partidas clasificatorias: se encienden cuando están creadas sus tablas (supabase/ranked.sql).
export const RANKED_ENABLED = true;
// Salas de voz de Discord: se encienden cuando la función «discord-voice» está
// desplegada en Supabase con sus secretos (ver supabase/discord.sql). Si está
// apagada o falla, las partidas funcionan igual y el botón no aparece.
export const DISCORD_VOICE_ENABLED = false;
