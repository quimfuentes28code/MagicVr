-- Magic AR · salas de voz de Discord
-- Pégalo en Supabase → SQL Editor → New query → Run. Se puede ejecutar varias veces.
-- Estas tablas sólo las usa la función «discord-voice» (con la clave de servicio):
-- la app no puede leerlas ni escribirlas.

-- ------------------------------------------------------------ salas registradas
create table if not exists public.voice_rooms (
  code text primary key check (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$'),
  mode text not null default '1v1' check (mode in ('1v1', 'commander')),
  host_secret_hash text not null,
  ip text,
  user_id uuid,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  channel_id text,
  channel_claimed_at timestamptz,
  invite_url text,
  channel_created_at timestamptz
);
alter table public.voice_rooms enable row level security;
revoke all on public.voice_rooms from anon, authenticated;
create index if not exists voice_rooms_channel on public.voice_rooms (channel_id);

-- ------------------------------------------------------------ registro para los límites
create table if not exists public.voice_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('register', 'channel')),
  ip text,
  user_id uuid,
  created_at timestamptz not null default now()
);
alter table public.voice_events enable row level security;
revoke all on public.voice_events from anon, authenticated;
create index if not exists voice_events_kind_time on public.voice_events (kind, created_at);

-- ------------------------------------------------------------ limpieza cada 30 minutos
-- ANTES DE EJECUTAR: cambia PON_AQUI_TU_SWEEP_SECRET por el mismo valor que pusiste
-- en el secreto SWEEP_SECRET de la función. (Si no lo cambias no pasa nada grave:
-- la función también limpia sola de vez en cuando mientras se usa.)
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'discord-voice-sweep';
select cron.schedule('discord-voice-sweep', '*/30 * * * *', $$
  select net.http_post(
    url := 'https://tzbkfcljrzwvttgmrrbs.supabase.co/functions/v1/discord-voice',
    headers := '{"Content-Type": "application/json", "x-sweep-secret": "PON_AQUI_TU_SWEEP_SECRET"}'::jsonb,
    body := '{"action": "sweep"}'::jsonb
  );
$$);
