-- «Чыгунка» — схема Supabase.
-- Выполнить целиком в Supabase → SQL Editor (повторный запуск безопасен).
-- Перед этим: Authentication → Sign In / Providers → включить «Allow anonymous sign-ins».
--
-- Модель: браузер хозяина — арбитр. Гости пишут только свои действия в actions,
-- хозяин применяет их игровым движком и одним вызовом commit_turn обновляет состояние.

create extension if not exists pgcrypto;

-- ---------- таблицы ----------
create table if not exists public.rooms (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  host_uid      uuid not null,
  status        text not null default 'lobby' check (status in ('lobby', 'playing', 'finished')),
  config        jsonb not null default '{}'::jsonb,
  rules_version text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.seats (
  room_id    uuid not null references public.rooms(id) on delete cascade,
  seat       int  not null check (seat between 0 and 4),
  kind       text not null default 'closed' check (kind in ('human', 'bot', 'closed')),
  bot_level  text check (bot_level in ('easy', 'medium', 'mainline')),
  uid        uuid,
  name       text check (char_length(name) <= 20),
  color      text,
  primary key (room_id, seat)
);

-- хэши кодов возврата: без политик — доступ только через функции
create table if not exists public.seat_secrets (
  room_id     uuid not null references public.rooms(id) on delete cascade,
  seat        int  not null,
  return_hash text not null,
  primary key (room_id, seat)
);

create table if not exists public.public_state (
  room_id    uuid primary key references public.rooms(id) on delete cascade,
  seq        int not null,
  state      jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.private_views (
  room_id uuid not null references public.rooms(id) on delete cascade,
  seat    int  not null,
  seq     int  not null,
  view    jsonb not null,
  primary key (room_id, seat)
);

create table if not exists public.host_state (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  seq     int not null,
  state   jsonb not null
);

create table if not exists public.actions (
  id         bigint generated always as identity primary key,
  room_id    uuid not null references public.rooms(id) on delete cascade,
  seat       int  not null,
  uid        uuid not null default auth.uid(),
  base_seq   int  not null,
  payload    jsonb not null,
  status     text not null default 'pending' check (status in ('pending', 'applied', 'rejected')),
  error      text,
  created_at timestamptz not null default now()
);
create index if not exists actions_room_pending on public.actions (room_id, id) where status = 'pending';

create table if not exists public.events (
  id         bigint generated always as identity primary key,
  room_id    uuid not null references public.rooms(id) on delete cascade,
  seq        int  not null,
  visibility int,              -- null = видят все, иначе номер места
  text       text not null,
  data       jsonb,
  created_at timestamptz not null default now()
);
create index if not exists events_room on public.events (room_id, id);

-- ---------- помощники для RLS ----------
create or replace function public.my_seat(p_room uuid) returns int
language sql stable security definer set search_path = public as $$
  select seat from public.seats where room_id = p_room and uid = auth.uid() limit 1
$$;

create or replace function public.is_member(p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.seats where room_id = p_room and uid = auth.uid())
      or exists (select 1 from public.rooms where id = p_room and host_uid = auth.uid())
$$;

create or replace function public.is_host(p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.rooms where id = p_room and host_uid = auth.uid())
$$;

-- ---------- RLS ----------
alter table public.rooms         enable row level security;
alter table public.seats         enable row level security;
alter table public.seat_secrets  enable row level security;
alter table public.public_state  enable row level security;
alter table public.private_views enable row level security;
alter table public.host_state    enable row level security;
alter table public.actions       enable row level security;
alter table public.events        enable row level security;

drop policy if exists rooms_read on public.rooms;
create policy rooms_read on public.rooms for select using (public.is_member(id));

drop policy if exists seats_read on public.seats;
create policy seats_read on public.seats for select using (public.is_member(room_id));

drop policy if exists public_state_read on public.public_state;
create policy public_state_read on public.public_state for select using (public.is_member(room_id));

drop policy if exists private_views_read on public.private_views;
create policy private_views_read on public.private_views for select
  using (exists (select 1 from public.seats s where s.room_id = private_views.room_id and s.seat = private_views.seat and s.uid = auth.uid()));

drop policy if exists host_state_read on public.host_state;
create policy host_state_read on public.host_state for select using (public.is_host(room_id));

drop policy if exists actions_read on public.actions;
create policy actions_read on public.actions for select using (uid = auth.uid() or public.is_host(room_id));

drop policy if exists actions_insert on public.actions;
create policy actions_insert on public.actions for insert
  with check (uid = auth.uid() and status = 'pending' and error is null and seat = public.my_seat(room_id)
              and exists (select 1 from public.rooms r where r.id = room_id and r.status = 'playing'));

drop policy if exists events_read on public.events;
create policy events_read on public.events for select
  using (public.is_member(room_id) and (visibility is null or visibility = public.my_seat(room_id)));

-- гостям — только чтение и вставка своих действий; всё остальное — через функции ниже
revoke all on public.rooms, public.seats, public.seat_secrets, public.public_state, public.private_views,
              public.host_state, public.actions, public.events from anon, authenticated;
grant select on public.rooms, public.seats, public.public_state, public.private_views, public.host_state,
                public.actions, public.events to authenticated;
grant insert (room_id, seat, base_seq, payload) on public.actions to authenticated;

-- не больше 10 действий за 5 секунд от одного игрока
create or replace function public.actions_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.actions where uid = new.uid and created_at > now() - interval '5 seconds') >= 10 then
    raise exception 'Слишком часто. Подождите пару секунд';
  end if;
  return new;
end $$;
drop trigger if exists actions_rate_limit on public.actions;
create trigger actions_rate_limit before insert on public.actions for each row execute function public.actions_rate_limit();

-- ---------- функции (RPC) ----------
-- pgcrypto в Supabase лежит в схеме extensions, поэтому она есть в search_path
create or replace function public.gen_code(len int, alphabet text) returns text
language plpgsql volatile set search_path = public, extensions as $$
declare s text := ''; b bytea := gen_random_bytes(len);
begin
  for i in 0 .. len - 1 loop
    s := s || substr(alphabet, 1 + (get_byte(b, i) % char_length(alphabet)), 1);
  end loop;
  return s;
end $$;

create or replace function public.hash_code(p text) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(digest(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex')
$$;

-- Создать комнату: хозяин занимает место 0. Возвращает код комнаты и личный код возврата.
create or replace function public.create_room(p_name text, p_config jsonb, p_rules text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_room uuid; v_code text; v_ret text; i int;
begin
  if v_uid is null then raise exception 'Нужен вход (анонимный)'; end if;
  if char_length(coalesce(trim(p_name), '')) = 0 or char_length(p_name) > 20 then raise exception 'Имя — от 1 до 20 символов'; end if;
  if (select count(*) from public.rooms where host_uid = v_uid and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Не больше 5 комнат в час';
  end if;
  loop
    v_code := public.gen_code(6, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    exit when not exists (select 1 from public.rooms where code = v_code);
  end loop;
  insert into public.rooms (code, host_uid, config, rules_version) values (v_code, v_uid, coalesce(p_config, '{}'::jsonb), p_rules)
    returning id into v_room;
  for i in 0 .. 4 loop
    insert into public.seats (room_id, seat, kind) values (v_room, i, case when i = 0 or i = 1 then 'human' else 'closed' end);
  end loop;
  update public.seats set uid = v_uid, name = trim(p_name), color = 'pink' where room_id = v_room and seat = 0;
  v_ret := public.gen_code(8, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  insert into public.seat_secrets values (v_room, 0, public.hash_code(v_ret));
  return jsonb_build_object('room_id', v_room, 'code', v_code, 'seat', 0, 'return_code', v_ret);
end $$;

-- Войти в комнату по коду: занять свободное место «человек».
create or replace function public.join_room(p_code text, p_name text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); r public.rooms; v_seat int; v_ret text;
begin
  if v_uid is null then raise exception 'Нужен вход (анонимный)'; end if;
  if char_length(coalesce(trim(p_name), '')) = 0 or char_length(p_name) > 20 then raise exception 'Имя — от 1 до 20 символов'; end if;
  select * into r from public.rooms where code = upper(trim(p_code));
  if not found then raise exception 'Комната не найдена'; end if;
  select seat into v_seat from public.seats where room_id = r.id and uid = v_uid;
  if found then
    return jsonb_build_object('room_id', r.id, 'code', r.code, 'seat', v_seat, 'return_code', null, 'status', r.status);
  end if;
  if r.status <> 'lobby' then raise exception 'Партия уже идёт. Чтобы вернуться на своё место, введите код возврата'; end if;
  select seat into v_seat from public.seats where room_id = r.id and kind = 'human' and uid is null order by seat limit 1 for update;
  if not found then raise exception 'Свободных мест нет'; end if;
  update public.seats set uid = v_uid, name = trim(p_name),
    color = coalesce(color, (array['pink','cyan','lime','pumpkin','violet'])[v_seat + 1]) where room_id = r.id and seat = v_seat;
  v_ret := public.gen_code(8, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  insert into public.seat_secrets values (r.id, v_seat, public.hash_code(v_ret))
    on conflict (room_id, seat) do update set return_hash = excluded.return_hash;
  update public.rooms set updated_at = now() where id = r.id;
  return jsonb_build_object('room_id', r.id, 'code', r.code, 'seat', v_seat, 'return_code', v_ret, 'status', r.status);
end $$;

-- Вернуться на своё место с другого устройства по коду возврата (место 0 — права хозяина).
create or replace function public.claim_seat(p_code text, p_seat int, p_return_code text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); r public.rooms;
begin
  if v_uid is null then raise exception 'Нужен вход (анонимный)'; end if;
  select * into r from public.rooms where code = upper(trim(p_code));
  if not found then raise exception 'Комната не найдена'; end if;
  if not exists (select 1 from public.seat_secrets where room_id = r.id and seat = p_seat and return_hash = public.hash_code(p_return_code)) then
    raise exception 'Неверный код возврата';
  end if;
  update public.seats set uid = null where room_id = r.id and uid = v_uid and seat <> p_seat;
  update public.seats set uid = v_uid, kind = 'human', bot_level = null where room_id = r.id and seat = p_seat;
  if p_seat = 0 then update public.rooms set host_uid = v_uid where id = r.id; end if;
  update public.rooms set updated_at = now() where id = r.id;
  return jsonb_build_object('room_id', r.id, 'code', r.code, 'seat', p_seat, 'status', r.status);
end $$;

-- Хозяин меняет настройки и места в лобби.
-- p_seats: [{seat, kind, bot_level, color, name?}] — name меняется только у ботов.
create or replace function public.update_lobby(p_room uuid, p_config jsonb, p_seats jsonb) returns void
language plpgsql volatile security definer set search_path = public as $$
declare s jsonb;
begin
  if not public.is_host(p_room) then raise exception 'Только хозяин меняет настройки'; end if;
  if (select status from public.rooms where id = p_room) <> 'lobby' then raise exception 'Партия уже началась'; end if;
  update public.rooms set config = coalesce(p_config, config), updated_at = now() where id = p_room;
  for s in select * from jsonb_array_elements(coalesce(p_seats, '[]'::jsonb)) loop
    if (s->>'seat')::int = 0 then
      update public.seats set color = coalesce(s->>'color', color) where room_id = p_room and seat = 0;
      continue;
    end if;
    update public.seats set
      kind = s->>'kind',
      bot_level = case when s->>'kind' = 'bot' then coalesce(s->>'bot_level', 'medium') else null end,
      uid = case when s->>'kind' = 'human' then uid else null end,
      name = case when s->>'kind' = 'bot' then left(coalesce(s->>'name', 'Бот'), 20)
                  when s->>'kind' = 'human' then name else null end,
      color = coalesce(s->>'color', color)
    where room_id = p_room and seat = (s->>'seat')::int;
  end loop;
end $$;

-- Имя и цвет своего места (гость в лобби).
create or replace function public.update_my_seat(p_room uuid, p_name text, p_color text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if (select status from public.rooms where id = p_room) <> 'lobby' then raise exception 'Партия уже началась'; end if;
  update public.seats set name = coalesce(left(nullif(trim(p_name), ''), 20), name), color = coalesce(p_color, color)
   where room_id = p_room and uid = auth.uid();
end $$;

-- Один ход хозяина: состояние, виды игроков, события и статус обработанного действия — одной транзакцией.
create or replace function public.commit_turn(
  p_room uuid, p_seq int, p_host jsonb, p_public jsonb, p_privates jsonb, p_events jsonb,
  p_action bigint default null, p_action_status text default null, p_error text default null, p_room_status text default null
) returns void
language plpgsql volatile security definer set search_path = public as $$
declare cur int; pv jsonb; ev jsonb;
begin
  if not public.is_host(p_room) then raise exception 'Только хозяин ведёт партию'; end if;
  select seq into cur from public.host_state where room_id = p_room for update;
  if cur is not null and p_seq <= cur and p_host is not null then
    raise exception 'Состояние устарело (открыта вторая вкладка хозяина?)';
  end if;
  if p_host is not null then
    insert into public.host_state values (p_room, p_seq, p_host)
      on conflict (room_id) do update set seq = excluded.seq, state = excluded.state;
    insert into public.public_state values (p_room, p_seq, p_public, now())
      on conflict (room_id) do update set seq = excluded.seq, state = excluded.state, updated_at = now();
    for pv in select * from jsonb_array_elements(coalesce(p_privates, '[]'::jsonb)) loop
      insert into public.private_views values (p_room, (pv->>'seat')::int, p_seq, pv->'view')
        on conflict (room_id, seat) do update set seq = excluded.seq, view = excluded.view;
    end loop;
    for ev in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
      insert into public.events (room_id, seq, visibility, text, data)
        values (p_room, p_seq, nullif(ev->>'vis', 'all')::int, ev->>'text', ev->'data');
    end loop;
  end if;
  if p_action is not null then
    update public.actions set status = p_action_status, error = p_error where id = p_action and room_id = p_room;
  end if;
  update public.rooms set status = coalesce(p_room_status, status), updated_at = now() where id = p_room;
end $$;

-- Заменить игрока ботом (или вернуть место человеку: p_level = null).
create or replace function public.set_seat_bot(p_room uuid, p_seat int, p_level text, p_name text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_host(p_room) then raise exception 'Только хозяин'; end if;
  if p_seat = 0 then raise exception 'Место хозяина нельзя отдать боту'; end if;
  if p_level is null then
    update public.seats set kind = 'human', bot_level = null, uid = null where room_id = p_room and seat = p_seat;
  else
    update public.seats set kind = 'bot', bot_level = p_level, uid = null where room_id = p_room and seat = p_seat;
  end if;
end $$;

-- Удалить комнату со всеми данными (только хозяин). Места, ходы, журнал удаляются каскадом.
create or replace function public.delete_room(p_room uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_host(p_room) then raise exception 'Удалить партию может только хозяин'; end if;
  delete from public.rooms where id = p_room;
end $$;

-- Проверка, что проект не спит (для GitHub Actions раз в 3 дня).
create or replace function public.ping() returns timestamptz language sql stable as $$ select now() $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.create_room(text, jsonb, text), public.join_room(text, text), public.claim_seat(text, int, text),
  public.update_lobby(uuid, jsonb, jsonb), public.update_my_seat(uuid, text, text),
  public.commit_turn(uuid, int, jsonb, jsonb, jsonb, jsonb, bigint, text, text, text),
  public.set_seat_bot(uuid, int, text, text), public.delete_room(uuid), public.my_seat(uuid), public.is_member(uuid), public.is_host(uuid)
  to authenticated;
grant execute on function public.ping() to anon, authenticated;

-- ---------- Realtime ----------
do $$
declare t text;
begin
  foreach t in array array['rooms', 'seats', 'public_state', 'private_views', 'actions', 'events'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; when undefined_object then raise notice 'Нет публикации supabase_realtime';
    end;
  end loop;
end $$;

-- ---------- уборка: комнаты без активности 30 дней ----------
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('bnr-cleanup', '17 3 * * *', $c$delete from public.rooms where updated_at < now() - interval '30 days'$c$);
exception when others then
  raise notice 'pg_cron недоступен — включите его в Database → Extensions или удаляйте старые комнаты вручную: %', sqlerrm;
end $$;
