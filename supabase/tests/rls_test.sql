-- Проверка RLS и функций: хозяин A, гость B, посторонний C, новое устройство D.
\set ON_ERROR_STOP 0
\set QUIET 1
\pset tuples_only on
\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B '''bbbbbbbb-0000-0000-0000-000000000002'''
\set C '''cccccccc-0000-0000-0000-000000000003'''
\set D '''dddddddd-0000-0000-0000-000000000004'''
create or replace function pg_temp.ok(cond boolean, msg text) returns text language plpgsql as
$$ begin if cond then return 'OK   ' || msg; else return 'FAIL ' || msg; end if; end $$;
create or replace function pg_temp.err(q text, msg text) returns text language plpgsql as
$$ begin execute q; return 'FAIL ' || msg || ' (ошибки не было)'; exception when others then return 'OK   ' || msg || ': ' || sqlerrm; end $$;
set role authenticated;

select set_config('request.jwt.claim.sub', :A, false);
select r->>'room_id' as room, r->>'code' as code, r->>'return_code' as ret_a from (select public.create_room('Михаил', '{"tickets":"base"}', '0.3.0') r) x \gset
select pg_temp.ok(length(:'code') = 6, 'create_room выдаёт код из 6 символов');

select set_config('request.jwt.claim.sub', :B, false);
select r->>'return_code' as ret_b, (r->>'seat')::int as seat_b from (select public.join_room(lower(:'code'), 'Анна') r) x \gset
select pg_temp.ok(:seat_b = 1, 'гость занимает место 1');
select pg_temp.ok((select count(*) from public.seats where room_id = :'room') = 5, 'гость видит места своей комнаты');
select pg_temp.err('select * from public.seat_secrets', 'хэши кодов возврата недоступны');

select set_config('request.jwt.claim.sub', :C, false);
select pg_temp.ok((select count(*) from public.rooms) = 0, 'посторонний не видит комнату');
select pg_temp.ok((select count(*) from public.seats) = 0, 'посторонний не видит места');
do $$ begin perform public.join_room('ZZZZZZ', 'X'); raise notice 'FAIL несуществующая комната'; exception when others then raise notice 'OK   несуществующая комната: %', sqlerrm; end $$;

select set_config('request.jwt.claim.sub', :B, false);
do $$ begin perform public.update_lobby((select room_id from public.seats limit 1), '{}', '[]'); raise notice 'FAIL гость меняет настройки'; exception when others then raise notice 'OK   гость не меняет настройки: %', sqlerrm; end $$;

select set_config('request.jwt.claim.sub', :A, false);
select public.update_lobby(:'room', '{"tickets":"extended"}', '[{"seat":2,"kind":"bot","bot_level":"medium","name":"Бот · Средний","color":"green"}]');
select pg_temp.ok((select kind from public.seats where room_id = :'room' and seat = 2) = 'bot', 'хозяин ставит бота');
select public.commit_turn(:'room', 1, '{"secret":"deck"}', '{"pub":1}',
  '[{"seat":0,"view":{"hand":"A"}},{"seat":1,"view":{"hand":"B"}},{"seat":2,"view":{"hand":"bot"}}]',
  '[{"text":"всем","vis":"all"},{"text":"только Анне","vis":1},{"text":"только хозяину","vis":0}]', null, null, null, 'playing');
select pg_temp.ok((select status from public.rooms where id = :'room') = 'playing', 'партия началась');

select set_config('request.jwt.claim.sub', :B, false);
select pg_temp.ok((select count(*) from public.private_views) = 1 and (select view->>'hand' from public.private_views) = 'B', 'гость видит только свою руку');
select pg_temp.ok((select count(*) from public.host_state) = 0, 'гость не видит host_state');
select pg_temp.ok((select count(*) from public.public_state) = 1, 'гость видит public_state');
select pg_temp.ok((select string_agg(text, ',' order by id) from public.events) = 'всем,только Анне', 'гость видит только свои события');
insert into public.actions (room_id, seat, base_seq, payload) values (:'room', 1, 1, '{"type":"draw"}');
select pg_temp.ok((select count(*) from public.actions) = 1, 'гость вставляет своё действие');
do $$ begin insert into public.actions (room_id, seat, base_seq, payload) select room_id, 0, 1, '{}' from public.rooms limit 1; raise notice 'FAIL действие за чужое место'; exception when others then raise notice 'OK   действие за чужое место отклонено'; end $$;
do $$ begin insert into public.actions (room_id, seat, base_seq, payload, status) select room_id, 1, 1, '{}', 'applied' from public.rooms limit 1; raise notice 'FAIL вставка со статусом'; exception when others then raise notice 'OK   нельзя задать статус действия'; end $$;
do $$ begin update public.public_state set seq = 99; raise notice 'FAIL гость меняет public_state'; exception when others then raise notice 'OK   гость не меняет public_state'; end $$;
select pg_temp.err(format('select public.commit_turn(%L, 5, ''{}'', ''{}'', ''[]'', ''[]'')', :'room'), 'гость не коммитит ход');
do $$ begin update public.actions set status = 'applied'; raise notice 'FAIL гость меняет статус'; exception when others then raise notice 'OK   гость не меняет статус действия'; end $$;

select set_config('request.jwt.claim.sub', :C, false);
select pg_temp.err(format('insert into public.actions (room_id, seat, base_seq, payload) values (%L, 1, 1, ''{}'')', :'room'), 'посторонний не вставляет действия');
select pg_temp.err(format('select public.join_room(%L, ''Чужой'')', :'code'), 'в идущую партию новым игроком не войти');
select pg_temp.ok((select count(*) from public.public_state) = 0 and (select count(*) from public.events) = 0, 'посторонний не видит состояние и события');

select set_config('request.jwt.claim.sub', :A, false);
select pg_temp.ok((select count(*) from public.actions) = 1, 'хозяин видит действия гостей');
select public.commit_turn(:'room', 2, '{"secret":2}', '{"pub":2}', '[]', '[]', (select id from public.actions limit 1), 'applied', null, null);
select pg_temp.ok((select status from public.actions limit 1) = 'applied', 'хозяин отмечает действие применённым');
do $$ begin perform public.commit_turn((select id from public.rooms limit 1), 2, '{}', '{}', '[]', '[]'); raise notice 'FAIL устаревший seq'; exception when others then raise notice 'OK   устаревшее состояние отклонено: %', sqlerrm; end $$;

select set_config('request.jwt.claim.sub', :D, false);
select pg_temp.err(format('select public.claim_seat(%L, 1, ''WRONGCODE'')', :'code'), 'неверный код возврата');
select public.claim_seat(:'code', 1, :'ret_b') is not null;
select pg_temp.ok((select view->>'hand' from public.private_views) = 'B', 'новое устройство по коду возврата видит руку места 1');

select set_config('request.jwt.claim.sub', :B, false);
select pg_temp.ok((select count(*) from public.private_views) = 0, 'старое устройство потеряло доступ');

select set_config('request.jwt.claim.sub', :C, false);
select public.claim_seat(:'code', 0, :'ret_a') is not null;
select pg_temp.ok((select count(*) from public.host_state) = 1, 'хозяин с другого устройства по коду возврата получает host_state');

select set_config('request.jwt.claim.sub', :A, false);
do $$ begin perform public.commit_turn((select id from public.rooms limit 1), 9, '{}', '{}', '[]', '[]'); raise notice 'FAIL старый хозяин всё ещё хозяин'; exception when others then raise notice 'OK   старое устройство хозяина больше не хозяин'; end $$;

select set_config('request.jwt.claim.sub', :D, false);
do $$ declare i int; begin for i in 1..11 loop insert into public.actions (room_id, seat, base_seq, payload) select id, 1, 3, '{}' from public.rooms limit 1; end loop; raise notice 'FAIL нет ограничения частоты'; exception when others then raise notice 'OK   ограничение частоты: %', sqlerrm; end $$;
select set_config('request.jwt.claim.sub', :A, false);
select pg_temp.ok(public.ping() is not null, 'ping отвечает');

-- удаление комнаты (хозяином теперь стал C — он вернулся на место 0 по коду)
select set_config('request.jwt.claim.sub', :D, false);
select pg_temp.err(format('select public.delete_room(%L)', :'room'), 'гость не может удалить комнату');
select set_config('request.jwt.claim.sub', :A, false);
select pg_temp.err(format('select public.delete_room(%L)', :'room'), 'бывший хозяин (место передано) не может удалить комнату');
select set_config('request.jwt.claim.sub', :C, false);
select public.delete_room(:'room');
reset role;
select pg_temp.ok((select count(*) from public.rooms where id = :'room') = 0, 'хозяин удалил комнату');
select pg_temp.ok((select count(*) from public.seats where room_id = :'room') = 0, 'места удалены каскадом');
