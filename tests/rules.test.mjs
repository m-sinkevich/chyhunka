// Проверки отдельных правил на подготовленных позициях.
import test from 'node:test';
import assert from 'node:assert/strict';
import { E, players } from './helpers.mjs';
import { RuleError } from '../js/engine/index.js';

const empty = () => ({ red: 0, orange: 0, yellow: 0, green: 0, blue: 0, purple: 0, white: 0, black: 0, loco: 0 });

/** Партия сразу в фазе игры, с заданными руками. */
function start(n = 3, cfg = {}, seed = 42) {
  let st = E.init({ goals: 'off', ...cfg }, players(n), seed);
  st.setup = { tickets: {}, postcards: {}, depotOrder: [] };
  st.phase = 'play'; st.turn = 0; st.turnNo = 1; st.ts = { drawn: 0, e4: false, claimed: false };
  // вернуть руки в колоду, чтобы число карт сходилось
  for (const h of st.hands) for (const [c, k] of Object.entries(h)) { for (let i = 0; i < k; i++) st.deck.push(c); h[c] = 0; }
  return st;
}
function give(st, seat, cards) {
  for (const [c, k] of Object.entries(cards)) for (let i = 0; i < k; i++) {
    const j = st.deck.indexOf(c); assert.ok(j >= 0, 'нет карты в колоде: ' + c); st.deck.splice(j, 1); st.hands[seat][c]++;
  }
}
const act = (st, a) => E.apply(st, a).state;
const rejects = (st, a, re) => assert.throws(() => E.apply(st, a), (e) => e instanceof RuleError && (!re || re.test(e.message)));
const pass = (st) => { // ход «вхолостую»: взять 2 карты из колоды
  st = act(st, { type: 'draw', seat: st.turn, source: 'deck', wh: 0 });
  if (st.ts.drawn === 1) st = act(st, { type: 'draw', seat: st.turn, source: 'deck', wh: 0 });
  return st;
};

test('сквозной экспресс: 3 жёлтых + 1 серый жёлтой картой = 7 очков, а не 5', () => {
  let st = start(2);
  give(st, 0, { yellow: 4 });
  st = act(st, { type: 'claim', seat: 0, route: 'r069', pay: { color: 'yellow', n: 3, loco: 0 } });
  assert.equal(st.score[0], 4);
  st = pass(st);
  st = act(st, { type: 'claim', seat: 0, route: 'r071', pay: { color: 'yellow', n: 1, loco: 0 } });
  assert.equal(st.score[0], 7);
  assert.equal(st.chain[0].len, 4);
});

test('цепочка обрывается ходом без захвата и другим цветом', () => {
  let st = start(2);
  give(st, 0, { yellow: 3, red: 1 });
  st = act(st, { type: 'claim', seat: 0, route: 'r069', pay: { color: 'yellow', n: 3, loco: 0 } });
  st = pass(st);
  st = act(st, { type: 'claim', seat: 0, route: 'r071', pay: { color: 'red', n: 1, loco: 0 } });
  assert.equal(st.score[0], 4 + 1);
});

test('электрификация +1, горный перегон требует Локомотив', () => {
  let st = start(3);
  give(st, 0, { green: 4, loco: 1 });
  rejects(st, { type: 'claim', seat: 0, route: 'r007', pay: { color: 'green', n: 4, loco: 0 } }, /Локомотив/);
  give(st, 0, {});
  st.hands[0].green = 3; st.deck.push('green');
  st = act(st, { type: 'claim', seat: 0, route: 'r007', pay: { color: 'green', n: 3, loco: 1 } });
  assert.equal(st.score[0], 7 + 1);
});

test('призрачная ветка: N карт + 1 Локомотив, без электрификации и погранконтроля', () => {
  let st = start(3);
  give(st, 0, { blue: 4, loco: 1 });
  rejects(st, { type: 'claim', seat: 0, route: 'r100', pay: { color: 'blue', n: 4, loco: 0 } });
  st = act(st, { type: 'claim', seat: 0, route: 'r100', pay: { color: 'blue', n: 4, loco: 1 } });
  assert.equal(st.claims.r100, 0);
  assert.equal(st.score[0], 7);
  assert.equal(st.pend.length, 0);
});

test('погранпереход: доплата за открытые карты своего цвета или отказ', () => {
  let st = start(3);
  give(st, 0, { black: 5 });
  // подложить наверх колоды: чёрная, красная, Локомотив → доплата 2
  for (const c of ['loco', 'red', 'black']) { const j = st.deck.indexOf(c); st.deck.splice(j, 1); st.deck.push(c); }
  const s1 = act(st, { type: 'claim', seat: 0, route: 'r029', pay: { color: 'black', n: 3, loco: 0 } });
  assert.equal(s1.pend[0].kind, 'tunnel');
  assert.equal(s1.pend[0].extra, 2);
  const legal = E.legal(s1, 0);
  assert.ok(legal.some((a) => a.pay && a.pay.n === 2));
  const ok = act(s1, { type: 'tunnelPay', seat: 0, pay: { n: 2, loco: 0 } });
  assert.equal(ok.claims.r029, 0);
  assert.equal(ok.hands[0].black, 0);
  assert.equal(ok.turn, 1);
  const no = act(s1, { type: 'tunnelPay', seat: 0, decline: true });
  assert.equal(no.claims.r029, undefined);
  assert.equal(no.hands[0].black, 5);
  assert.equal(no.turn, 1);
});

test('двойной перегон: при 3 игроках второй ряд закрыт, при 4 открыт, но не для того же игрока', () => {
  let st = start(3);
  give(st, 0, { red: 2 }); give(st, 1, { white: 2 });
  st = act(st, { type: 'claim', seat: 0, route: 'r001', pay: { color: 'red', n: 2, loco: 0 } });
  rejects(st, { type: 'claim', seat: 1, route: 'r002', pay: { color: 'white', n: 2, loco: 0 } }, /Второй ряд/);
  let s4 = start(4);
  give(s4, 0, { red: 2, white: 2 }); give(s4, 1, { white: 2 });
  s4 = act(s4, { type: 'claim', seat: 0, route: 'r001', pay: { color: 'red', n: 2, loco: 0 } });
  s4 = act(s4, { type: 'claim', seat: 1, route: 'r002', pay: { color: 'white', n: 2, loco: 0 } });
  assert.equal(s4.claims.r002, 1);
});

test('станции: цена 1-2-3 карты, в Минске до трёх разных игроков, в дуэли — одна', () => {
  let st = start(4);
  for (let s = 0; s < 4; s++) give(st, s, { blue: 1 });
  st = act(st, { type: 'station', seat: 0, city: 'minsk', pay: { color: 'blue', n: 1, loco: 0 } });
  st = act(st, { type: 'station', seat: 1, city: 'minsk', pay: { color: 'blue', n: 1, loco: 0 } });
  st = act(st, { type: 'station', seat: 2, city: 'minsk', pay: { color: 'blue', n: 1, loco: 0 } });
  rejects(st, { type: 'station', seat: 3, city: 'minsk', pay: { color: 'blue', n: 1, loco: 0 } }, /Минске/);
  let d = start(2);
  give(d, 0, { blue: 1 }); give(d, 1, { blue: 1 });
  d = act(d, { type: 'station', seat: 0, city: 'minsk', pay: { color: 'blue', n: 1, loco: 0 } });
  rejects(d, { type: 'station', seat: 1, city: 'minsk', pay: { color: 'blue', n: 1, loco: 0 } });
});

test('набор карт: открытый Локомотив только первой картой и заканчивает ход', () => {
  let st = start(3);
  st.faceUp = ['loco', 'red', 'blue', 'green', 'white'];
  const j = st.deck.indexOf('loco'); st.deck.splice(j, 1); // сохранить число карт: убрать одну из колоды
  st.deck.splice(st.deck.indexOf('red'), 1); st.deck.splice(st.deck.indexOf('blue'), 1); st.deck.splice(st.deck.indexOf('green'), 1); st.deck.splice(st.deck.indexOf('white'), 1);
  const s1 = act(st, { type: 'draw', seat: 0, source: 'up', index: 1 });
  assert.equal(s1.turn, 0);
  rejects(s1, { type: 'draw', seat: 0, source: 'up', index: s1.faceUp.indexOf('loco') }, /первой/);
  const s2 = act(st, { type: 'draw', seat: 0, source: 'up', index: 0 });
  assert.equal(s2.turn, 1);
});

test('последний круг: после ≤2 вагонов каждый делает ещё ход, затем подсчёт', () => {
  let st = start(3);
  st.trains[0] = 5;
  give(st, 0, { yellow: 3 });
  st = act(st, { type: 'claim', seat: 0, route: 'r069', pay: { color: 'yellow', n: 3, loco: 0 } });
  assert.equal(st.endAfterTurnNo, 4);
  st = pass(st); st = pass(st);
  assert.equal(st.phase, 'play');
  st = pass(st);
  assert.equal(st.phase, 'over');
  assert.equal(st.result.rows.length, 3);
});

test('третья цель открывается, когда у кого-то ≤15 вагонов', () => {
  let st = start(3, { goals: 'random' });
  assert.equal(st.goals.open, 2);
  st.trains[0] = 18;
  give(st, 0, { yellow: 3 });
  st = act(st, { type: 'claim', seat: 0, route: 'r069', pay: { color: 'yellow', n: 3, loco: 0 } });
  assert.equal(st.goals.open, 3);
});

test('дуэль: один невыполненный билет не вычитается, цели — гонка', () => {
  let st = start(2, { goals: ['g_vilnius', 'g_capital', 'g_express'] });
  st.tickets[0] = ['t001', 't002'];
  const r = E.finalScore(st);
  const pts = st.tickets[0].map((t) => E.M.tickets[t].points);
  assert.equal(r.rows[0].parts.tickets, -Math.min(...pts));
  // гонка: 2 перегона в Вильнюс
  st.claims.r026 = 0; st.claims.r100 = 0;
  give(st, 0, { red: 1 });
  st = pass(st);
  assert.equal(st.goals.race.g_vilnius, 0);
});

test('путевые карты: «Экстренное торможение» — лидер отдаёт карту', () => {
  let st = start(3, { modules: { routeCards: true } });
  const ev = E.M.routeList.find((r) => r.event && !r.tunnel && !r.ghost && !r.mountain && r.color !== 'grey');
  give(st, 0, { [ev.color]: ev.length });
  give(st, 1, { red: 3 });
  st.score[1] = 50;
  st.routeCardDeck = st.routeCardDeck.filter((x) => x !== 'e10').concat(['e10']);
  st = act(st, { type: 'claim', seat: 0, route: ev.id, pay: { color: ev.color, n: ev.length, loco: 0 } });
  assert.equal(st.hands[1].red, 2);
  assert.equal(Object.values(st.hands[0]).reduce((a, b) => a + b, 0), 1);
});

test('путевые карты: «Листья на путях» — лидер сам выбирает, что сбросить', () => {
  let st = start(3, { modules: { routeCards: true } });
  const ev = E.M.routeList.find((r) => r.event && !r.tunnel && !r.ghost && !r.mountain && r.color !== 'grey');
  give(st, 0, { [ev.color]: ev.length });
  give(st, 2, { blue: 3 });
  st.score[2] = 50;
  st.routeCardDeck = st.routeCardDeck.filter((x) => x !== 'e7').concat(['e7']);
  st = act(st, { type: 'claim', seat: 0, route: ev.id, pay: { color: ev.color, n: ev.length, loco: 0 } });
  assert.equal(st.pend[0].seat, 2);
  assert.equal(st.turn, 0);
  rejects(st, { type: 'draw', seat: 1, source: 'deck' });
  st = act(st, { type: 'discard', seat: 2, cards: { blue: 2 } });
  assert.equal(st.hands[2].blue, 1);
  assert.equal(st.turn, 1);
});

test('1921: карта на склад при наборе из колоды и опустошение склада через депо', () => {
  let st = start(3, { modules: { depots: true } });
  st.depotsHome = [4, 4, 4];
  st.depots.slutsk = 1;
  st = act(st, { type: 'draw', seat: 0, source: 'deck', wh: 1 });
  st = act(st, { type: 'draw', seat: 0, source: 'deck', wh: 1 });
  assert.equal(st.warehouses[1].length, 2);
  const whCards = [...st.warehouses[1]];
  st = pass(st); st = pass(st);
  give(st, 0, { yellow: 3 });
  const before = Object.values(st.hands[0]).reduce((a, b) => a + b, 0);
  st = act(st, { type: 'claim', seat: 0, route: 'r069', pay: { color: 'yellow', n: 3, loco: 0 }, raid: ['slutsk'] });
  assert.equal(st.depotsHome[0], 3);
  assert.equal(st.warehouses[1].length, 0);
  assert.equal(Object.values(st.hands[0]).reduce((a, b) => a + b, 0), before - 3 + whCards.length);
});

test('конечные станции и соседи', () => {
  let st = start(3, { modules: { terminus: true, neighbors: true } });
  give(st, 0, { blue: 4, loco: 2, green: 2, red: 3 });
  st = act(st, { type: 'claim', seat: 0, route: 'r100', pay: { color: 'blue', n: 4, loco: 1 } }); // Гродно — Вильнюс (Литва)
  assert.deepEqual(st.neighbors.got[0], []);
  st = pass(st); st = pass(st);
  for (const c of ['red', 'red', 'red']) { st.deck.splice(st.deck.indexOf(c), 1); st.deck.push(c); } // погранконтроль без доплаты
  st.hands[0].red = 0; st.deck.push('red', 'red', 'red'); st.deck.splice(st.deck.indexOf('blue'), 3);
  st = act(st, { type: 'claim', seat: 0, route: 'r030', pay: { color: 'green', n: 2, loco: 0 } }); // Гродно — Белосток (Польша)
  assert.deepEqual(st.neighbors.got[0].map((g) => g.country).sort(), ['Литва', 'Польша']);
  assert.deepEqual(st.neighbors.got[0].map((g) => g.points), [12, 12]);   // каждая страна — 12, без очерёдности
  assert.equal(E.finalScore(st).rows[0].parts.neighbors, 24);
  st = pass(st); st = pass(st);
});

test('жетон конечной станции получает первый', () => {
  let st = start(3, { modules: { terminus: true } });
  give(st, 0, { blue: 3, loco: 1 });
  st = act(st, { type: 'claim', seat: 0, route: 'r103', pay: { color: 'blue', n: 3, loco: 1 } }); // Уречье — Рабкор
  assert.equal(st.terminus.rabkor, 0);
  const r = E.finalScore(st);
  assert.equal(r.rows[0].parts.terminus, 3);
});

test('действия других игроков вне очереди отклоняются', () => {
  const st = start(3);
  rejects(st, { type: 'draw', seat: 1, source: 'deck' }, /не ваш ход/);
});
