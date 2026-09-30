// Бот «Магистральщик»: копит один цвет и собирает магистраль подряд идущими ходами
// (сквозной экспресс), потом играет как «Средний». Перенос стратегии rush из симулятора.
import { BotContext } from './common.js';
import { mediumTurn } from './medium.js';

function corridors(M) {
  return M.map.mainlines.map((m) => ({
    color: m.color,
    segs: m.cities.slice(1).map((c, i) => M.routeList.filter((r) => ((r.from === m.cities[i] && r.to === c) || (r.to === m.cities[i] && r.from === c)) && (r.color === m.color || r.color === 'grey'))),
  }));
}

export function mainlineMove(E, v, legal, rng) {
  const b = new BotContext(E, v, legal, rng);
  const targets = b.targets();
  const c = b.common(targets);
  if (c !== undefined) return c;
  const { M, me } = b;
  const h = b.hand;
  const corr = (M._corr ||= corridors(M));
  // выбрать магистраль, которую ещё можно собрать целиком
  let plan = null;
  for (const cr of corr) {
    const rem = cr.segs.filter((lanes) => !lanes.some((r) => b.mine(r)));
    if (!rem.length || rem.some((lanes) => !lanes.some((r) => b.free(r)))) continue;
    const need = rem.reduce((s, l) => s + l[0].length, 0);
    const needLoco = rem.filter((l) => l[0].mountain || l[0].ghost).length;
    if (need > v.trains[me]) continue;
    const started = cr.segs.length !== rem.length;
    const sc = need - 0.6 * (h[cr.color] + h.loco) - (started ? 20 : 0);
    if (!plan || sc < plan.sc) plan = { sc, color: cr.color, rem, need, needLoco, started };
  }
  if (plan) {
    const ch = v.chain[me];
    const active = ch && ch.color === plan.color;
    if (v.ts.drawn !== 1 && (active || h[plan.color] + h.loco >= plan.need + plan.needLoco + 1)) {
      // следующий сегмент, стыкующийся с концом цепочки
      const lanes = (ch ? plan.rem.find((l) => l.some((r) => ch.ends.includes(r.from) || ch.ends.includes(r.to))) : null) || plan.rem[0];
      const opts = b.claims().filter((a) => lanes.some((r) => r.id === a.route) && (a.pay.n === 0 || a.pay.color === plan.color));
      if (opts.length) return b.withRaid(b.bestPay(opts));
    }
    // копить цвет
    const draws = legal.filter((a) => a.type === 'draw');
    const up = draws.find((a) => a.source === 'up' && a.card === plan.color);
    if (up) return up;
    if (v.ts.drawn === 1 || rng.next() < 0.8) {
      const deck = draws.find((a) => a.source === 'deck' && (a.wh == null || a.wh === me));
      if (deck) return deck;
    }
  }
  return mediumTurn(b, targets);
}
