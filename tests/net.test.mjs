// Сетевой протокол на «демо-сети» (та же логика доступа, что в schema.sql): хозяин, два гостя и бот.
import test from 'node:test';
import assert from 'node:assert/strict';
import { E, players, randomAction, makeRng } from './helpers.mjs';
import { openDemo } from '../js/net/demo.js';
import { createRoom, joinRoom, claimSeat, Lobby } from '../js/net/room.js';
import { HostGame } from '../js/net/host.js';
import { GuestGame } from '../js/net/guest.js';
import { legalFromView } from '../js/engine/viewstate.js';
import { BOTS } from '../js/bots/index.js';

globalThis.localStorage = { d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = String(v); }, removeItem(k) { delete this.d[k]; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('допустимые действия по «виду» совпадают с полными', () => {
  const rng = makeRng(5);
  let st = E.init({ modules: { depots: true, tourism: true, routeCards: true } }, players(3), 99);
  for (let i = 0; i < 300 && st.phase !== 'over'; i++) {
    for (let s = 0; s < 3; s++) {
      const a = JSON.stringify(E.legal(st, s).map(({ seat, ...x }) => x));
      const b = JSON.stringify(legalFromView(E.M, E.view(st, s)).map(({ seat, ...x }) => x));
      assert.equal(b, a, `место ${s}, шаг ${i}`);
    }
    const seats = E.waitingFor(st);
    const a = randomAction(st, seats[0], rng);
    try { st = E.apply(st, a).state; } catch { /* ход отклонён — пропускаем */ }
  }
});

test('сетевая партия: хозяин + 2 гостя + бот доигрывают до конца; тайны не утекают', { timeout: 120000 }, async () => {
  const storage = { d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; } };
  const A = openDemo({ storage, session: null, uid: 'uid-A', bcName: 't1', rateLimit: 0 });
  const B = openDemo({ storage, session: null, uid: 'uid-B', bcName: 't1', rateLimit: 0 });
  const C = openDemo({ storage, session: null, uid: 'uid-C', bcName: 't1', rateLimit: 0 });
  const room = await createRoom(A, 'Хозяин', {});
  const jb = await joinRoom(B, room.code.toLowerCase(), 'Анна');
  assert.equal(jb.seat, 1);
  const lobby = new Lobby(A, room.room_id);
  await lobby.load();
  await lobby.save({ tickets: 'base', modules: { routeCards: true, terminus: true } }, [
    { seat: 1, kind: 'human', color: 'blue' }, { seat: 2, kind: 'human', color: 'green' }, { seat: 3, kind: 'bot', bot_level: 'medium', name: 'Бот · Средний', color: 'black' },
  ]);
  const jc = await joinRoom(C, room.code, 'Олег');
  assert.equal(jc.seat, 2);
  await lobby.load();
  await assert.rejects(() => B.rpc('update_lobby', { p_room: room.room_id, p_config: {}, p_seats: [] }), /хозяин/);

  const host = await HostGame.create(E, A, { id: room.room_id, code: room.code }, lobby.seats, lobby.room.config);
  host.runner.botDelay = () => 5;
  await host.start();
  const gB = new GuestGame(E, B, { id: room.room_id, code: room.code }, 1);
  const gC = new GuestGame(E, C, { id: room.room_id, code: room.code }, 2);
  await gB.start(); await gC.start();
  assert.ok(gB.view && gC.view);
  // гость не видит чужую руку и host_state
  assert.equal((await B.select('host_state', { room_id: room.room_id })).length, 0);
  assert.equal((await B.select('private_views', { room_id: room.room_id })).length, 1);
  assert.equal(gB.view.tickets[gC.view.me], null);

  const rng = makeRng(3);
  const bot = BOTS.medium.move;
  let steps = 0, rejected = 0;
  // чужой ход гостя отклоняется хозяином
  const t0 = Date.now();
  while (host.state.phase !== 'over' && Date.now() - t0 < 100000) {
    steps++;
    const waiting = E.waitingFor(host.state);
    let moved = false;
    for (const g of [gB, gC]) {
      if (!g.view || !waiting.includes(g.view.me) || g.view.seq !== host.state.seq) continue;
      const a = bot(E, g.view, legalFromView(E.M, g.view), rng);
      const r = await g.submit(a);
      if (!r.ok) rejected++;
      moved = true;
      break;
    }
    if (!moved && waiting.includes(host.seat)) {
      const a = bot(E, host.view || E.view(host.state, host.seat), E.legal(host.state, host.seat), rng);
      await host.submit(a);
      moved = true;
    }
    if (!moved) await sleep(15);
  }
  assert.equal(host.state.phase, 'over', 'партия не закончилась');
  await sleep(200);
  assert.equal(gB.view.phase, 'over');
  assert.ok(gB.view.result.rows.length === 4);
  assert.equal(gB.view.seed, host.state.seed, 'seed раскрыт в конце');
  // приватные события гостя B не видны гостю C
  const evB = await B.select('events', { room_id: room.room_id });
  const evC = await C.select('events', { room_id: room.room_id });
  assert.ok(evB.some((e) => e.visibility === 1));
  assert.ok(!evC.some((e) => e.visibility === 1));
  console.log('шагов', steps, 'отклонено', rejected, 'событий', evB.length);

  // возврат на место с другого устройства по коду
  const D = openDemo({ storage, session: null, uid: 'uid-D', bcName: 't1', rateLimit: 0 });
  await claimSeat(D, room.code, 1, jb.return_code, 'Анна');
  assert.equal((await D.select('private_views', { room_id: room.room_id })).length, 1);
  assert.equal((await B.select('private_views', { room_id: room.room_id })).length, 0);
  for (const g of [gB, gC, host]) g.close();
  for (const x of [A, B, C, D]) x.close();
});

test('ход гостя вне очереди отклоняется, ход при офлайн-хозяине ждёт в очереди', { timeout: 60000 }, async () => {
  const storage = { d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; } };
  const A = openDemo({ storage, session: null, uid: 'uid-A', bcName: 't2', rateLimit: 0 });
  const B = openDemo({ storage, session: null, uid: 'uid-B', bcName: 't2', rateLimit: 0 });
  const room = await createRoom(A, 'Хозяин', {});
  await joinRoom(B, room.code, 'Анна');
  const lobby = new Lobby(A, room.room_id); await lobby.load();
  const r0 = { id: room.room_id, code: room.code };
  let host = await HostGame.create(E, A, r0, lobby.seats, {});
  await host.start();
  const g = new GuestGame(E, B, r0, 1); await g.start();
  // подготовка: оба выбирают маршруты
  const pick = (v) => ({ type: 'setupTickets', tickets: v.setup.tickets.offer.slice(0, v.setup.tickets.min) });
  await host.submit(pick(host.view));
  assert.ok((await g.submit(pick(g.view))).ok);
  await sleep(100);
  assert.equal(g.view.phase, 'play');
  const r = await g.submit({ type: 'draw', source: 'deck' });
  assert.equal(r.ok, false);
  assert.match(r.error, /не ваш ход/);
  // хозяин закрыл вкладку; гость ходит после хозяина — ход ждёт
  await host.submit({ type: 'draw', source: 'deck' }); await host.submit({ type: 'draw', source: 'deck' });
  host.close();
  await sleep(100);
  const pend = g.submit({ type: 'draw', source: 'deck' });
  await sleep(200);
  const rows = await A.select('actions', { room_id: room.room_id, status: 'pending' });
  assert.equal(rows.length, 1);
  // хозяин вернулся — ход обработан
  const seats = await A.select('seats', { room_id: room.room_id }, { order: 'seat' });
  host = await HostGame.resume(E, A, r0, seats);
  await host.start();
  const res = await pend;
  assert.equal(res.ok, true);
  assert.equal(host.state.ts.drawn, 1);
  host.close(); g.close(); A.close(); B.close();
});
