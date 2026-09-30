import test from 'node:test';
import assert from 'node:assert/strict';
import { E, players, randomAction, makeRng } from './helpers.mjs';
import { RuleError } from '../js/engine/index.js';

const CONFIGS = [
  { tickets: 'base' },
  { tickets: 'extended', modules: { depots: true, tourism: true, routeCards: true, neighbors: true, terminus: true } },
  { tickets: 'mega', modules: { routeCards: true, neighbors: true } },
  { tickets: 'bigcities', modules: { terminus: true }, strictHistorical: true },
  { tickets: 'base', quick: true, goals: 'off' },
];

function cardTotal(st) {
  const hands = st.hands.reduce((s, h) => s + Object.values(h).reduce((a, b) => a + b, 0), 0);
  return hands + st.deck.length + st.discard.length + st.faceUp.length + st.warehouses.flat().length;
}

test('случайные партии доигрываются без ошибок и не теряют карты', () => {
  let games = 0, rejected = 0;
  for (const cfg of CONFIGS) for (let n = 2; n <= 5; n++) for (let g = 0; g < 6; g++) {
    const rng = makeRng(1000 * n + g);
    let st = E.init(cfg, players(n), 777 + g * 31 + n);
    for (let step = 0; step < 4000 && st.phase !== 'over'; step++) {
      const seats = E.waitingFor(st);
      const seat = seats[rng.int(seats.length)];
      const a = randomAction(st, seat, rng);
      assert.ok(a, `нет действий для ${seat} в фазе ${st.phase}`);
      try { st = E.apply(st, a).state; } catch (e) { if (!(e instanceof RuleError)) throw e; rejected++; }
      assert.equal(cardTotal(st), 110, 'карт должно быть 110');
      assert.ok(st.trains.every((t) => t >= 0));
    }
    assert.equal(st.phase, 'over', `партия не закончилась: ${JSON.stringify(cfg)} n=${n}`);
    assert.ok(st.result.rows.length === n);
    games++;
  }
  console.log('партий:', games, 'отклонённых ходов:', rejected);
});
