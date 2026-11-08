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
