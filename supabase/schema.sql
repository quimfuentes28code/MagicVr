-- Magic AR · base de datos (Supabase)
-- Pégalo entero en Supabase → SQL Editor → New query → Run. Se puede ejecutar
-- más de una vez sin romper nada.
--
-- Tablas:
--   profiles   perfil público de cada jugador (nombre de usuario, puntuación de ranked)
--   libraries  la biblioteca de cada jugador (mazos y colección), privada
--   matches    partidas jugadas (para rankeds y estadísticas)

create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------------ perfiles
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username extensions.citext unique not null
    check (char_length(username) between 3 and 18 and username ~ '^[A-Za-z0-9_]+$'),
  rating int not null default 1000,
  wins int not null default 0,
  losses int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists "perfiles públicos" on public.profiles;
create policy "perfiles públicos" on public.profiles for select using (true);
drop policy if exists "editar mi perfil" on public.profiles;
create policy "editar mi perfil" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- El jugador sólo puede cambiar su nombre; la puntuación la cambia el servidor.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant update (username) on public.profiles to authenticated;

-- Al registrarse, se crea su perfil con el nombre de usuario elegido.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.profiles (id, username) values (new.id, new.raw_user_meta_data ->> 'username');
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ¿Está libre este nombre de usuario?
create or replace function public.username_available(u text) returns boolean
language sql security definer set search_path = public, extensions stable as $$
  select not exists (select 1 from public.profiles where username = u::extensions.citext);
$$;
grant execute on function public.username_available(text) to anon, authenticated;

-- Entrar con nombre de usuario: devuelve el correo SÓLO si la contraseña es
-- correcta (así no se puede averiguar el correo de nadie por su nombre).
create or replace function public.login_email(u text, p text) returns text
language sql security definer set search_path = public, extensions stable as $$
  select au.email from auth.users au
  join public.profiles pr on pr.id = au.id
  where pr.username = u::extensions.citext
    and au.encrypted_password = extensions.crypt(p, au.encrypted_password);
$$;
grant execute on function public.login_email(text, text) to anon, authenticated;

-- ---------------------------------------------------------------- biblioteca
create table if not exists public.libraries (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.libraries enable row level security;
drop policy if exists "mi biblioteca (leer)" on public.libraries;
create policy "mi biblioteca (leer)" on public.libraries for select using (auth.uid() = user_id);
drop policy if exists "mi biblioteca (crear)" on public.libraries;
create policy "mi biblioteca (crear)" on public.libraries for insert with check (auth.uid() = user_id);
drop policy if exists "mi biblioteca (guardar)" on public.libraries;
create policy "mi biblioteca (guardar)" on public.libraries for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update on public.libraries to authenticated;

-- ------------------------------------------------------- partidas (rankeds)
create table if not exists public.matches (
  id bigint generated always as identity primary key,
  mode text not null default '1v1',
  player_a uuid references public.profiles on delete set null,
  player_b uuid references public.profiles on delete set null,
  winner uuid references public.profiles on delete set null,
  ranked boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.matches enable row level security;
drop policy if exists "partidas públicas" on public.matches;
create policy "partidas públicas" on public.matches for select using (true);
-- (las partidas las registrará el servidor cuando activemos las rankeds)
grant select on public.matches to anon, authenticated;

-- Clasificación
create or replace view public.leaderboard with (security_invoker = true) as
  select username, rating, wins, losses from public.profiles order by rating desc, wins desc;
grant select on public.leaderboard to anon, authenticated;
