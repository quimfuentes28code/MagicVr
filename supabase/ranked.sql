-- Magic AR · partidas clasificatorias (rankeds)
-- Pégalo en Supabase → SQL Editor → New query → Run (después de schema.sql).
-- Se puede ejecutar varias veces.
--
-- Puntuación: todos empiezan en 0. Ganar: +25. Perder: −15 (nunca por debajo de 0).
-- El resultado lo aplica el servidor cuando los dos jugadores dicen lo mismo.

-- ------------------------------------------------------------ puntuación desde 0
alter table public.profiles alter column rating set default 0;
update public.profiles set rating = 0 where rating = 1000 and wins = 0 and losses = 0;

-- ------------------------------------------------------------ partidas
create table if not exists public.ranked_matches (
  id uuid primary key default gen_random_uuid(),
  player_a uuid not null references public.profiles on delete cascade,
  player_b uuid not null references public.profiles on delete cascade,
  report_a uuid,
  report_b uuid,
  reported_at timestamptz,
  status text not null default 'playing' check (status in ('playing', 'done', 'disputed')),
  winner uuid,
  points_win int,
  points_loss int,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check (player_a <> player_b)
);
alter table public.ranked_matches enable row level security;
drop policy if exists "mis rankeds" on public.ranked_matches;
create policy "mis rankeds" on public.ranked_matches for select using (auth.uid() in (player_a, player_b));
revoke insert, update, delete on public.ranked_matches from anon, authenticated;
grant select on public.ranked_matches to authenticated;

-- Aplica el resultado (sólo desde las funciones de abajo).
create or replace function public.ranked_apply(m uuid, w uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.ranked_matches; l uuid;
begin
  select * into r from public.ranked_matches where id = m for update;
  if r.status <> 'playing' or w not in (r.player_a, r.player_b) then return; end if;
  l := case when w = r.player_a then r.player_b else r.player_a end;
  update public.profiles set rating = rating + 25, wins = wins + 1 where id = w;
  update public.profiles set rating = greatest(0, rating - 15), losses = losses + 1 where id = l;
  update public.ranked_matches set status = 'done', winner = w, points_win = 25, points_loss = 15, finished_at = now() where id = m;
  insert into public.matches (mode, player_a, player_b, winner, ranked) values ('1v1', r.player_a, r.player_b, w, true);
end $$;
revoke execute on function public.ranked_apply(uuid, uuid) from public, anon, authenticated;

-- El anfitrión crea la partida al empezar. Máximo 5 rankeds al día contra el mismo rival.
create or replace function public.ranked_start(opponent uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n int; mid uuid;
begin
  if me is null then raise exception 'Tienes que entrar en tu cuenta.'; end if;
  if opponent = me then raise exception 'No puedes jugar contra ti mismo.'; end if;
  if not exists (select 1 from public.profiles where id = opponent) then raise exception 'Ese jugador no existe.'; end if;
  select count(*) into n from public.ranked_matches
    where ((player_a = me and player_b = opponent) or (player_a = opponent and player_b = me))
      and created_at > now() - interval '24 hours';
  if n >= 5 then raise exception 'Ya habéis jugado 5 rankeds hoy entre vosotros. Mañana más.'; end if;
  insert into public.ranked_matches (player_a, player_b) values (me, opponent) returning id into mid;
  return mid;
end $$;
grant execute on function public.ranked_start(uuid) to authenticated;

-- Cada jugador dice quién ha ganado. Si coinciden, se aplica; si no, queda en disputa.
create or replace function public.ranked_report(m uuid, w uuid) returns json
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.ranked_matches;
begin
  select * into r from public.ranked_matches where id = m for update;
  if r.id is null or me not in (r.player_a, r.player_b) then raise exception 'Esa partida no es tuya.'; end if;
  if r.status <> 'playing' then return row_to_json(r); end if;
  if w not in (r.player_a, r.player_b) then raise exception 'Ganador no válido.'; end if;
  if me = r.player_a then
    update public.ranked_matches set report_a = w, reported_at = coalesce(reported_at, now()) where id = m;
  else
    update public.ranked_matches set report_b = w, reported_at = coalesce(reported_at, now()) where id = m;
  end if;
  select * into r from public.ranked_matches where id = m;
  if r.report_a is not null and r.report_b is not null then
    if r.report_a = r.report_b then perform public.ranked_apply(m, r.report_a);
    else update public.ranked_matches set status = 'disputed', finished_at = now() where id = m;
    end if;
  end if;
  select * into r from public.ranked_matches where id = m;
  return row_to_json(r);
end $$;
grant execute on function public.ranked_report(uuid, uuid) to authenticated;

-- Si el rival no dice nada en 10 minutos (cerró la app al perder…), cuenta lo que dijiste tú.
create or replace function public.ranked_claim() returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.ranked_matches; n int := 0;
begin
  for r in select * from public.ranked_matches
    where status = 'playing' and reported_at < now() - interval '10 minutes'
      and ((player_a = me and report_a is not null and report_b is null) or (player_b = me and report_b is not null and report_a is null))
  loop
    perform public.ranked_apply(r.id, coalesce(r.report_a, r.report_b));
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.ranked_claim() to authenticated;

-- ------------------------------------------------------------ buscar partida
create table if not exists public.ranked_queue (
  user_id uuid primary key references public.profiles on delete cascade,
  code text not null,
  created_at timestamptz not null default now()
);
alter table public.ranked_queue enable row level security;
revoke all on public.ranked_queue from anon, authenticated;

-- Me pongo a esperar con el código de mi sala.
create or replace function public.ranked_queue_join(c text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Tienes que entrar en tu cuenta.'; end if;
  delete from public.ranked_queue where created_at < now() - interval '3 minutes';
  insert into public.ranked_queue (user_id, code) values (auth.uid(), upper(c))
    on conflict (user_id) do update set code = excluded.code, created_at = now();
end $$;
grant execute on function public.ranked_queue_join(text) to authenticated;

-- ¿Hay alguien esperando? Me llevo su código (y lo saco de la cola).
create or replace function public.ranked_queue_take() returns text
language plpgsql security definer set search_path = public as $$
declare q public.ranked_queue;
begin
  if auth.uid() is null then raise exception 'Tienes que entrar en tu cuenta.'; end if;
  delete from public.ranked_queue where created_at < now() - interval '3 minutes';
  select * into q from public.ranked_queue where user_id <> auth.uid() order by created_at limit 1 for update skip locked;
  if q.user_id is null then return null; end if;
  delete from public.ranked_queue where user_id = q.user_id;
  return q.code;
end $$;
grant execute on function public.ranked_queue_take() to authenticated;

create or replace function public.ranked_queue_leave() returns void
language sql security definer set search_path = public as $$
  delete from public.ranked_queue where user_id = auth.uid();
$$;
grant execute on function public.ranked_queue_leave() to authenticated;
