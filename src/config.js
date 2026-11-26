// Configuración pública de la app.
// Supabase (cuentas de usuario): la URL del proyecto y su clave pública
// («anon» / «publishable»). Son públicas por diseño: la seguridad la ponen las
// reglas de la base de datos (supabase/schema.sql). También se pueden pasar con
// VITE_SUPABASE_URL / VITE_SUPABASE_KEY al compilar.
const env = import.meta.env || {};
export const SUPABASE_URL = env.VITE_SUPABASE_URL || '';
export const SUPABASE_KEY = env.VITE_SUPABASE_KEY || '';
