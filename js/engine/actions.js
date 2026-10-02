// Список допустимых действий игрока. Используется интерфейсом (что можно нажать) и ботами.
// Для действий с большим выбором (станции, сброс, выбор маршрутов) возвращается шаблон template:true.
import { handSize } from './state.js';
import { routeBlock, payOptions, blindOnly, stationBlock, stationCost, canDrawDeck } from './rules.js';
import { hasRealAction } from './apply.js';

export function legalActions(M, st, seat) {
  if (st.phase === 'over') return [];
  if (st.pend.length) {
    const p = st.pend[0];
    if (p.seat !== seat) return [];
    if (p.kind === 'tunnel') {
      const h = st.hands[seat];
      const spare = p.use.e6 ? 1 : 0;
      const colorLeft = p.pay.n > 0 ? h[p.pay.color] - p.pay.n : 0;
      const locoLeft = h.loco - (p.pay.loco - spare);
      const out = [];
      for (let loco = 0; loco <= p.extra; loco++) {
        const n = p.extra - loco;
        if (n <= colorLeft && loco <= locoLeft && (p.pay.n > 0 || n === 0)) out.push({ type: 'tunnelPay', seat, pay: { n, loco } });
      }
      out.push({ type: 'tunnelPay', seat, decline: true });
      return out;
    }
    if (p.kind === 'keepTickets') return [{ type: 'keep', seat, template: true, offer: p.offer, min: p.min, postOffer: p.postOffer }];
    if (p.kind === 'discard') return [{ type: 'discard', seat, template: true, count: p.count }];
    return [];
  }
  if (st.phase === 'setup') {
    const out = [];
    const t = st.setup.tickets[seat];
    if (t) out.push({ type: 'setupTickets', seat, template: true, ...t });
    const p = st.setup.postcards[seat];
    if (p) out.push({ type: 'setupPostcards', seat, template: true, ...p });
    if (st.setup.depotOrder[0] === seat) out.push({ type: 'setupDepot', seat, template: true, cities: M.cityList.filter((c) => st.depots[c.id] == null).map((c) => c.id) });
    return out;
  }
  if (seat !== st.turn) return [];
  const out = drawOptions(st, seat, st.ts.drawn === 1);
  if (st.ts.drawn === 1) return out;
  for (const r of M.routeList) {
    if (routeBlock(M, st, seat, r)) continue;
    for (const pay of payOptions(M, st, seat, r)) out.push({ type: 'claim', seat, route: r.id, pay });
  }
  if (st.ticketDeck.length) out.push({ type: 'tickets', seat });
  if (st.cfg.duelOn && st.ticketRow.length) out.push({ type: 'ticketRow', seat, template: true, row: st.ticketRow });
  if (st.stationsLeft[seat] > 0) {
    const cities = M.cityList.filter((c) => !stationBlock(M, st, seat, c.id)).map((c) => c.id);
    if (cities.length) out.push({ type: 'station', seat, template: true, cities, cost: stationCost(st, seat) });
  }
  if (handSize(st.hands[seat]) > 0 && canDrawDeck(st)) out.push({ type: 'swap', seat, template: true });
  const rc = st.routeCards[seat];
  if (rc.includes('e3') && st.faceUp.length) out.push({ type: 'vitrina', seat, template: true });
  if (rc.includes('e4') && st.discard.length) out.push({ type: 'fromDiscard', seat, template: true });
  if (st.cfg.modules.depots && st.depotsHome[seat] > 0) out.push({ type: 'placeDepot', seat, template: true });
  // пропуск: когда сделать ничего нельзя, а в последнем круге — по желанию (например, вагоны кончились)
  if (!hasRealAction(M, st, seat) || (st.endAfterTurnNo != null && !st.ts.drawn)) out.push({ type: 'pass', seat });
  return out;
}

function drawOptions(st, seat, second) {
  const out = [];
  if (!blindOnly(st, seat)) {
    st.faceUp.forEach((c, i) => {
      if (second && c === 'loco') return;
      out.push({ type: 'draw', seat, source: 'up', index: i, card: c });
    });
  }
  if (canDrawDeck(st)) {
    if (st.cfg.modules.depots) for (let wh = 0; wh < st.n; wh++) out.push({ type: 'draw', seat, source: 'deck', wh });
    else out.push({ type: 'draw', seat, source: 'deck' });
  }
  return out;
}

/** Варианты оплаты для интерфейса с учётом выбранных путевых карт. */
export function claimOptions(M, st, seat, routeId, use = {}) {
  const r = M.routes[routeId];
  const block = routeBlock(M, st, seat, r, use);
  if (block) return { block, options: [] };
  const options = payOptions(M, st, seat, r, use);
  return { block: options.length ? null : 'Не хватает карт', options };
}
