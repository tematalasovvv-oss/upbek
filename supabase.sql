-- UpBek: серверная часть (Supabase / Postgres)
-- Один раз выполнить в Supabase → SQL Editor.
-- Таблицы закрыты (RLS без политик). Доступ только через функции ниже
-- и только по секретному коду пользователя (в базе хранится лишь его SHA-256).

create table if not exists public.upbek_state (
  owner text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.upbek_events (
  id bigint generated always as identity primary key,
  owner text not null,
  kind text not null,
  body text,
  created_at timestamptz not null default now()
);
create index if not exists upbek_events_owner_idx on public.upbek_events (owner, id);

alter table public.upbek_state enable row level security;
alter table public.upbek_events enable row level security;
revoke all on public.upbek_state from anon, authenticated;
revoke all on public.upbek_events from anon, authenticated;

create or replace function public.upbek_owner(p_token text)
returns text language plpgsql immutable as $$
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 100 then
    raise exception 'bad token';
  end if;
  return encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
end $$;

-- События из «Команд» iPhone: сон (bed / wake) и SMS банков
create or replace function public.push_event(p_token text, p_kind text, p_text text default null)
returns json language plpgsql security definer set search_path = public as $$
declare o text := upbek_owner(p_token);
begin
  if p_kind not in ('bed', 'wake', 'sms', 'note') then raise exception 'bad kind'; end if;
  if (select count(*) from upbek_events where owner = o) > 2000 then raise exception 'too many events'; end if;
  insert into upbek_events (owner, kind, body) values (o, p_kind, left(p_text, 2000));
  return json_build_object('ok', true, 'kind', p_kind);
end $$;

create or replace function public.pull_events(p_token text)
returns table (id bigint, kind text, body text, created_at timestamptz)
language sql security definer set search_path = public as $$
  select e.id, e.kind, e.body, e.created_at from upbek_events e
  where e.owner = upbek_owner(p_token) order by e.id limit 500
$$;

create or replace function public.ack_events(p_token text, p_ids bigint[])
returns void language sql security definer set search_path = public as $$
  delete from upbek_events where owner = upbek_owner(p_token) and id = any (p_ids)
$$;

-- Облачная копия данных (зашифрована на телефоне ключом из кода)
create or replace function public.save_state(p_token text, p_data jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare o text := upbek_owner(p_token);
begin
  if octet_length(p_data::text) > 5000000 then raise exception 'too big'; end if;
  insert into upbek_state (owner, data, updated_at) values (o, p_data, now())
  on conflict (owner) do update set data = excluded.data, updated_at = now();
  return json_build_object('ok', true, 'at', now());
end $$;

create or replace function public.load_state(p_token text)
returns json language sql security definer set search_path = public as $$
  select json_build_object('data', data, 'at', updated_at) from upbek_state where owner = upbek_owner(p_token)
$$;

revoke all on function public.push_event(text, text, text) from public;
revoke all on function public.pull_events(text) from public;
revoke all on function public.ack_events(text, bigint[]) from public;
revoke all on function public.save_state(text, jsonb) from public;
revoke all on function public.load_state(text) from public;
grant execute on function public.push_event(text, text, text) to anon, authenticated;
grant execute on function public.pull_events(text) to anon, authenticated;
grant execute on function public.ack_events(text, bigint[]) to anon, authenticated;
grant execute on function public.save_state(text, jsonb) to anon, authenticated;
grant execute on function public.load_state(text) to anon, authenticated;

-- ===== Рейтинг друзей (v3): только имя, уровень, серия и проценты, без финансов =====
create table if not exists public.upbek_board (
  owner text not null,
  grp text not null,
  name text not null,
  avatar text,
  level int,
  streak int,
  s7 numeric,
  s30 numeric,
  today numeric,
  detail jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner, grp)
);
alter table public.upbek_board enable row level security;
revoke all on public.upbek_board from anon, authenticated;

create or replace function public.board_push(p_token text, p_group text, p_name text, p_avatar text, p_level int, p_streak int, p_s7 numeric, p_s30 numeric, p_today numeric, p_detail jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare o text := upbek_owner(p_token);
begin
  if p_group !~ '^[A-Z0-9]{6}$' then raise exception 'bad group'; end if;
  if length(coalesce(p_name, '')) < 1 or length(p_name) > 24 then raise exception 'bad name'; end if;
  if octet_length(coalesce(p_detail::text, '')) > 4000 then raise exception 'too big'; end if;
  if (select count(*) from upbek_board where grp = p_group and owner <> o) >= 50 then raise exception 'group full'; end if;
  insert into upbek_board (owner, grp, name, avatar, level, streak, s7, s30, today, detail, updated_at)
  values (o, p_group, p_name, left(p_avatar, 8), p_level, p_streak, p_s7, p_s30, p_today, p_detail, now())
  on conflict (owner, grp) do update set name = excluded.name, avatar = excluded.avatar, level = excluded.level, streak = excluded.streak,
    s7 = excluded.s7, s30 = excluded.s30, today = excluded.today, detail = excluded.detail, updated_at = now();
  return json_build_object('ok', true);
end $$;

create or replace function public.board_list(p_token text, p_group text)
returns table (name text, avatar text, level int, streak int, s7 numeric, s30 numeric, today numeric, detail jsonb, updated_at timestamptz, me boolean)
language sql security definer set search_path = public as $$
  select b.name, b.avatar, b.level, b.streak, b.s7, b.s30, b.today, b.detail, b.updated_at, b.owner = upbek_owner(p_token)
  from upbek_board b
  where b.grp = p_group
    and exists (select 1 from upbek_board m where m.grp = p_group and m.owner = upbek_owner(p_token))
  order by b.s7 desc nulls last
  limit 50
$$;

create or replace function public.board_leave(p_token text, p_group text)
returns void language sql security definer set search_path = public as $$
  delete from upbek_board where owner = upbek_owner(p_token) and grp = p_group
$$;

revoke all on function public.board_push(text, text, text, text, int, int, numeric, numeric, numeric, jsonb) from public;
revoke all on function public.board_list(text, text) from public;
revoke all on function public.board_leave(text, text) from public;
grant execute on function public.board_push(text, text, text, text, int, int, numeric, numeric, numeric, jsonb) to anon, authenticated;
grant execute on function public.board_list(text, text) to anon, authenticated;
grant execute on function public.board_leave(text, text) to anon, authenticated;
