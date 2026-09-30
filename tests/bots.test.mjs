import test from 'node:test';
import assert from 'node:assert/strict';
import { E, players, makeRng } from './helpers.mjs';
import { botAction, BOTS } from '../js/bots/index.js';

test('боты доигрывают партии со всеми модулями без ошибочных ходов', () => {
  const cfg = { tickets: 'extended', modules: { depots: true, tourism: true, routeCards: true, neighbors: true, terminus: true } };
  const levels = Object.keys(BOTS);
  for (let g = 0; g < 9; g++) {
    const n = 2 + (g % 4);
    const rng = makeRng(g);
    let st = E.init(g % 2 ? cfg : {}, players(n), 500 + g);
    let steps = 0;
    while (st.phase !== 'over') {
      for (const seat of E.waitingFor(st)) {
        const a = botAction(E, st, seat, levels[(seat + g) % 3], rng);
        st = E.apply(st, a).state; // ошибка правил здесь = ошибка бота
        if (st.phase === 'over') break;
      }
      assert.ok(++steps < 3000, 'партия зациклилась');
    }
    assert.equal(st.result.rows.length, n);
  }
});
