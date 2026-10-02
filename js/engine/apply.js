// Применение действия к состоянию. Чистая функция: на вход состояние и действие,
// на выход новое состояние и список событий для журнала. Ошибка правил — RuleError.
import { COLORS, COLOR_NAMES, RACE_THRESHOLDS } from './data.js';
import { drawCard, refillFaceUp, handSize } from './state.js';
import { randInt } from './rng.js';
import {
  RuleError, fail, leaders, isSoleLeader, blindOnly, routeBlock, checkRoutePay, stationBlock,
  checkStationPay, stationCost, ownRoutes, components, goalMetric, canDrawDeck,
  neighborCountries, neighborPoints,
} from './rules.js';
import { finalScore } from './scoring.js';

const clone = (x) => (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)));
const cardName = (c) => (c === 'loco' ? 'Локомотив' : COLOR_NAMES[c]);
const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c; };
const cardsWord = (n) => `${n} ${plural(n, 'карту', 'карты', 'карт')}`;

export function apply(M, stIn, action) {
  const st = clone(stIn);
  const ev = [];
  const ctx = { M, st, ev, actor: action?.seat, name: (s) => st.players[s].name, log: (text, vis = 'all', extra = {}) => ev.push({ text, vis, seat: ctx.actor, ...extra }) };
  if (!action || typeof action.type !== 'string') fail('Пустое действие');
  const seat = action.seat;
  if (!(seat >= 0 && seat < st.n)) fail('Неверное место игрока');
  if (st.phase === 'over') fail('Партия окончена');

  if (st.pend.length) {
    const p = st.pend[0];
    if (p.seat !== seat) fail(`Ждём решения игрока ${ctx.name(p.seat)}`);
    PENDING[p.kind](ctx, p, action);
  } else if (st.phase === 'setup') {
    SETUP[action.type] ? SETUP[action.type](ctx, seat, action) : fail('Сейчас идёт подготовка к партии');
    maybeStart(ctx);
  } else {
    if (seat !== st.turn) fail('Сейчас не ваш ход');
    const fn = TURN[action.type];
    if (!fn) fail('Неизвестное действие');
    if (st.ts.drawn === 1 && action.type !== 'draw') fail('Возьмите вторую карту');
    if (action.type !== 'pass') st.passes = 0;
    fn(ctx, seat, action);
  }
  st.seq++;
  return { state: st, events: ev };
}

// ---------- подготовка ----------
const SETUP = {
  setupTickets(ctx, seat, a) {
    const { st, M } = ctx;
    const o = st.setup.tickets[seat];
    if (!o) fail('Маршруты уже выбраны');
    const keep = uniq(a.tickets || []);
    if (!keep.every((t) => o.offer.includes(t))) fail('Можно оставить только предложенные маршруты');
    if (keep.length < o.min) fail(`Оставьте не меньше ${o.min} маршрутов`);
    const longs = keep.filter((t) => ['long', 'transit'].includes(M.tickets[t].set)).length;
    if (longs > o.maxLong) fail('Длинный маршрут можно оставить только один');
    st.tickets[seat].push(...keep);
    for (const t of o.offer) if (!keep.includes(t) && !['long', 'transit'].includes(M.tickets[t].set)) st.ticketDeck.unshift(t);
    delete st.setup.tickets[seat];
    ctx.log(`${ctx.name(seat)} оставляет ${keep.length} ${plural(keep.length, 'маршрут', 'маршрута', 'маршрутов')}`, 'all', { kind: 'keep', count: keep.length });
  },
  setupPostcards(ctx, seat, a) {
    const { st } = ctx;
    const o = st.setup.postcards[seat];
    if (!o) fail('Открытки уже выбраны');
    const keep = uniq(a.postcards || []);
    if (!keep.every((t) => o.offer.includes(t))) fail('Можно оставить только предложенные открытки');
    if (keep.length < o.min) fail('Оставьте хотя бы одну открытку');
    st.postcards[seat].push(...keep);
    for (const t of o.offer) if (!keep.includes(t)) st.postcardDeck.unshift(t);
    delete st.setup.postcards[seat];
    ctx.log(`${ctx.name(seat)} оставляет открыток: ${keep.length}`, 'all', { kind: 'keep', postcards: keep.length });
  },
  setupDepot(ctx, seat, a) {
    const { st, M } = ctx;
    if (st.setup.depotOrder[0] !== seat) fail('Сейчас депо ставит другой игрок');
    if (!M.cities[a.city]) fail('Нет такого города');
    if (st.depots[a.city] != null) fail('В городе уже есть депо');
    st.depots[a.city] = seat;
    st.setup.depotOrder.shift();
    ctx.log(`${ctx.name(seat)} ставит депо: ${M.cities[a.city].name}`, 'all', { kind: 'depot', city: a.city });
  },
};

function maybeStart(ctx) {
  const { st } = ctx;
  const s = st.setup;
  if (Object.keys(s.tickets).length || Object.keys(s.postcards).length || s.depotOrder.length) return;
  st.phase = 'play';
  st.turn = 0; st.turnNo = 1; st.ts = { drawn: 0, e4: false, claimed: false };
  ctx.log(`Партия началась. Ходит ${ctx.name(0)}`, 'all', { kind: 'turn', seat: 0 });
}

// ---------- действия в свой ход ----------
const TURN = {
  draw(ctx, seat, a) {
    const { st } = ctx;
    const first = st.ts.drawn === 0;
    if (a.source === 'up') {
      if (blindOnly(st, seat)) fail('«Скот на путях»: в этот ход только из закрытой колоды');
      const i = a.index | 0;
      const c = st.faceUp[i];
      if (!c) fail('Нет такой открытой карты');
      if (c === 'loco' && !first) fail('Открытый Локомотив можно взять только первой картой');
      st.faceUp.splice(i, 1);
      st.hands[seat][c]++;
      refillFaceUp(st);
      st.ts.drawn += c === 'loco' ? 2 : 1;
      ctx.log(`${ctx.name(seat)} берёт открытую карту: ${cardName(c)}`, 'all', { kind: 'draw', source: 'up', index: i, card: c });
    } else if (a.source === 'deck') {
      if (!canDrawDeck(st)) fail('Колода пуста');
      if (st.cfg.modules.depots) {
        const wh = a.wh;
        if (!(wh >= 0 && wh < st.n)) fail('Выберите склад, на который положить карту');
        const c0 = drawCard(st);
        if (c0) { st.warehouses[wh].push(c0); ctx.log(`${ctx.name(seat)} кладёт карту на склад игрока ${ctx.name(wh)}`, 'all', { kind: 'warehouse', to: wh }); }
      }
      const c = drawCard(st);
      if (c) {
        st.hands[seat][c]++;
        ctx.log(`${ctx.name(seat)} берёт карту из колоды`, 'all', { kind: 'draw', source: 'deck' });
        ctx.log(`Вам пришла карта: ${cardName(c)}`, seat, { kind: 'draw', source: 'deck', card: c, own: true });
      }
      st.ts.drawn += 1;
      refillFaceUp(st);
    } else fail('Неверный источник карты');
    if (st.ts.drawn >= 2 || !canDrawSecond(st, seat)) finishAction(ctx);
  },

  claim(ctx, seat, a) {
    const { st, M } = ctx;
    const r = M.routes[a.route];
    if (!r) fail('Нет такого перегона');
    const use = normUse(st, seat, a.use);
    const b = routeBlock(M, st, seat, r, use);
    if (b) fail(b);
    const pay = { color: a.pay?.color ?? null, n: a.pay?.n | 0, loco: a.pay?.loco | 0 };
    const e = checkRoutePay(M, st, seat, r, pay, use);
    if (e) fail(e);
    const raid = checkRaid(M, st, seat, r, a.raid);
    if (r.tunnel && !r.ghost && !use.e5) {
      // погранконтроль: открыть 3 карты (4, если игрок единолично лидирует)
      const k = st.cfg.leader4 && isSoleLeader(st, seat) ? 4 : 3;
      const revealed = [];
      for (let i = 0; i < k; i++) { const c = drawCard(st); if (c) revealed.push(c); }
      const extra = revealed.filter((c) => c === 'loco' || (pay.n > 0 && c === pay.color)).length;
      st.discard.push(...revealed);
      ctx.log(`${ctx.name(seat)}: погранконтроль на перегоне ${M.routeName(r)}${k === 4 ? ' (усиленный досмотр)' : ''} — открыты ${revealed.map(cardName).join(', ') || 'нет карт'}; доплата ${extra}`, 'all', { kind: 'tunnel', cards: revealed, route: r.id, extra, k });
      if (extra > 0) {
        st.pend.push({ seat, kind: 'tunnel', route: r.id, pay, use, raid, revealed, extra });
        return;
      }
    }
    finalizeClaim(ctx, seat, r, pay, { n: 0, loco: 0 }, use, raid);
    finishAction(ctx);
  },

  tickets(ctx, seat) {
    const { st } = ctx;
    if (!st.ticketDeck.length) fail('Колода маршрутов пуста');
    const offer = st.ticketDeck.splice(-Math.min(3, st.ticketDeck.length)).reverse();
    const postOffer = st.cfg.modules.tourism ? st.postcardDeck.splice(-Math.min(2, st.postcardDeck.length)).reverse() : [];
    st.stats[seat].ticketsDrawn++;
    st.pend.push({ seat, kind: 'keepTickets', offer, min: 1, postOffer });
    ctx.log(`${ctx.name(seat)} берёт маршруты`, 'all', { kind: 'tickets', count: offer.length });
  },

  ticketRow(ctx, seat, a) {
    const { st, M } = ctx;
    if (!st.cfg.duelOn) fail('Открытый ряд маршрутов есть только в дуэли');
    const picks = uniq((a.picks || []).map(Number));
    if (picks.length < 1 || picks.length > 2 || !picks.every((i) => st.ticketRow[i])) fail('Возьмите 1 или 2 маршрута из ряда');
    const got = picks.sort((x, y) => y - x).map((i) => st.ticketRow.splice(i, 1)[0]);
    st.tickets[seat].push(...got);
    while (st.ticketRow.length < 4 && st.ticketDeck.length) st.ticketRow.push(st.ticketDeck.pop());
    ctx.log(`${ctx.name(seat)} берёт из ряда: ${got.map((t) => `${M.cities[M.tickets[t].from].name} — ${M.cities[M.tickets[t].to].name}`).join('; ')}`, 'all', { kind: 'tickets', count: got.length, row: true });
    finishAction(ctx);
  },

  station(ctx, seat, a) {
    const { st, M } = ctx;
    const b = stationBlock(M, st, seat, a.city);
    if (b) fail(b);
    const pay = { color: a.pay?.color ?? null, n: a.pay?.n | 0, loco: a.pay?.loco | 0 };
    const e = checkStationPay(st, seat, pay);
    if (e) fail(e);
    const k = stationCost(st, seat);
    payCards(st, seat, pay.color, pay.n, pay.loco);
    (st.stationsAt[a.city] ||= []).push(seat);
    st.stationsLeft[seat]--;
    ctx.log(`${ctx.name(seat)} ставит станцию: ${M.cities[a.city].name} (${cardsWord(k)})`, 'all', { kind: 'station', city: a.city, pay: { color: pay.color, n: pay.n, loco: pay.loco } });
    finishAction(ctx);
  },

  swap(ctx, seat, a) {
    const { st } = ctx;
    const cards = a.cards || {};
    const total = Object.values(cards).reduce((s, v) => s + (v | 0), 0);
    if (total < 1 || total > 5) fail('Сбросьте от 1 до 5 карт');
    for (const [c, k] of Object.entries(cards)) if (!(c in st.hands[seat]) || st.hands[seat][c] < (k | 0) || k < 0) fail('У вас нет таких карт');
    for (const [c, k] of Object.entries(cards)) { st.hands[seat][c] -= k; for (let i = 0; i < k; i++) st.discard.push(c); }
    let got = 0;
    for (let i = 0; i < total; i++) { const c = drawCard(st); if (c) { st.hands[seat][c]++; got++; } }
    refillFaceUp(st);
    ctx.log(`${ctx.name(seat)} меняет состав: сбросил ${cardsWord(total)}, взял ${got}`, 'all', { kind: 'swap', count: total });
    finishAction(ctx);
  },

  vitrina(ctx, seat, a) { // путевая карта e3: вместо обычного набора взять 3 открытые карты
    const { st } = ctx;
    takeRouteCard(ctx, seat, 'e3');
    const picks = uniq((a.picks || []).map(Number)).filter((i) => st.faceUp[i]);
    const want = Math.min(3, st.faceUp.length);
    if (picks.length !== want) fail(`Выберите ${want} открытые карты`);
    const got = picks.sort((x, y) => y - x).map((i) => st.faceUp.splice(i, 1)[0]);
    for (const c of got) st.hands[seat][c]++;
    refillFaceUp(st);
    ctx.log(`${ctx.name(seat)} играет «Витрину»: ${got.map(cardName).join(', ')}`, 'all', { kind: 'draw', source: 'up', cards: got });
    finishAction(ctx);
  },

  fromDiscard(ctx, seat, a) { // путевая карта e4: 3 карты по выбору из сброса (ход продолжается)
    const { st } = ctx;
    if (st.ts.drawn) fail('Сначала закончите набор карт');
    const cards = a.cards || {};
    const total = Object.values(cards).reduce((s, v) => s + (v | 0), 0);
    const avail = st.discard.length;
    if (total !== Math.min(3, avail)) fail(`Выберите ${Math.min(3, avail)} карты из сброса`);
    for (const [c, k] of Object.entries(cards)) if (st.discard.filter((x) => x === c).length < k) fail('В сбросе нет таких карт');
    takeRouteCard(ctx, seat, 'e4');
    for (const [c, k] of Object.entries(cards)) for (let i = 0; i < k; i++) { st.discard.splice(st.discard.indexOf(c), 1); st.hands[seat][c]++; }
    ctx.log(`${ctx.name(seat)} играет «Со склада» и берёт ${cardsWord(total)} из сброса`, 'all', { kind: 'draw', source: 'discard', cards: Object.entries(cards).flatMap(([c, k]) => Array(k).fill(c)) });
  },

  placeDepot(ctx, seat, a) { // 1921: бесплатно поставить депо со склада в город без депо
    const { st, M } = ctx;
    if (!st.cfg.modules.depots) fail('Модуль складов и депо выключен');
    if (st.depotsHome[seat] < 1) fail('У вас не осталось депо');
    if (!M.cities[a.city]) fail('Нет такого города');
    if (st.depots[a.city] != null) fail('В городе уже есть депо');
    st.depots[a.city] = seat; st.depotsHome[seat]--;
    ctx.log(`${ctx.name(seat)} ставит депо: ${M.cities[a.city].name}`, 'all', { kind: 'depot', city: a.city });
  },

  pass(ctx, seat) {
    const { st } = ctx;
    const forced = !hasRealAction(ctx.M, st, seat);
    if (!forced && !(st.endAfterTurnNo != null && !st.ts.drawn)) fail('Пропустить ход можно, только если сделать ничего нельзя, или в последнем круге');
    if (forced) st.passes++;
    ctx.log(forced ? `${ctx.name(seat)} пропускает ход: действий нет` : `${ctx.name(seat)} пропускает последний ход`, 'all', { kind: 'pass' });
    finishAction(ctx);
  },
};

// ---------- отложенные решения ----------
const PENDING = {
  tunnel(ctx, p, a) {
    const { st, M } = ctx;
    if (a.type !== 'tunnelPay') fail('Решите, доплачиваете ли на погранконтроле');
    st.pend.shift();
    const r = M.routes[p.route];
    if (a.decline) {
      ctx.log(`${ctx.name(p.seat)} отказывается от доплаты — перегон ${M.routeName(r)} не занят`, 'all', { kind: 'tunnel', route: r.id, declined: true });
      finishAction(ctx);
      return;
    }
    const n = a.pay?.n | 0, loco = a.pay?.loco | 0;
    const h = st.hands[p.seat];
    if (n + loco !== p.extra) { st.pend.unshift(p); fail(`Доплатите ${p.extra} карт(ы)`); }
    const spare = p.use.e6 ? 1 : 0;
    if (p.pay.n === 0 && n > 0) { st.pend.unshift(p); fail('Перегон оплачен Локомотивами — доплата тоже Локомотивами'); }
    if (h[p.pay.color] - p.pay.n < n || h.loco - (p.pay.loco - spare) < loco) { st.pend.unshift(p); fail('Не хватает карт для доплаты'); }
    finalizeClaim(ctx, p.seat, r, p.pay, { n, loco }, p.use, p.raid);
    finishAction(ctx);
  },
  keepTickets(ctx, p, a) {
    const { st, M } = ctx;
    if (a.type !== 'keep') fail('Выберите маршруты, которые оставляете');
    const keep = uniq(a.tickets || []);
    if (!keep.every((t) => p.offer.includes(t))) fail('Можно оставить только предложенные маршруты');
    if (keep.length < p.min) fail(`Оставьте хотя бы ${p.min} маршрут`);
    const keepP = uniq(a.postcards || []).filter((x) => p.postOffer.includes(x));
    st.pend.shift();
    st.tickets[p.seat].push(...keep);
    for (const t of p.offer) if (!keep.includes(t)) st.ticketDeck.unshift(t);
    st.postcards[p.seat].push(...keepP);
    for (const t of p.postOffer) if (!keepP.includes(t)) st.postcardDeck.unshift(t);
    ctx.log(`${ctx.name(p.seat)} оставляет ${keep.length} ${plural(keep.length, 'маршрут', 'маршрута', 'маршрутов')}${p.postOffer.length ? ` и ${keepP.length} откр.` : ''}`, 'all', { kind: 'keep', count: keep.length });
    void M;
    finishAction(ctx);
  },
  discard(ctx, p, a) {
    const { st } = ctx;
    if (a.type !== 'discard') fail('Сбросьте карты');
    const cards = a.cards || {};
    const total = Object.values(cards).reduce((s, v) => s + (v | 0), 0);
    if (total !== p.count) fail(`Сбросьте ровно ${p.count} карт(ы)`);
    for (const [c, k] of Object.entries(cards)) if (!(c in st.hands[p.seat]) || st.hands[p.seat][c] < k || k < 0) fail('У вас нет таких карт');
    st.pend.shift();
    for (const [c, k] of Object.entries(cards)) { st.hands[p.seat][c] -= k; for (let i = 0; i < k; i++) st.discard.push(c); }
    ctx.log(`${ctx.name(p.seat)} сбрасывает ${cardsWord(total)} (${p.reason})`, 'all', { kind: 'discard', count: total, seat: p.seat });
    finishAction(ctx);
  },
};

// ---------- захват перегона ----------
function finalizeClaim(ctx, seat, r, pay, extra, use, raid) {
  const { st, M } = ctx;
  const spare = use.e6 ? 1 : 0;
  payCards(st, seat, pay.color, pay.n + extra.n, pay.loco + extra.loco - spare);
  for (const k of ['e1', 'e2', 'e5', 'e6']) if (use[k]) takeRouteCard(ctx, seat, k);
  if (st.flags[seat].extraCard) delete st.flags[seat].extraCard;
  st.claims[r.id] = seat;
  st.trains[seat] -= r.length;
  st.stats[seat].claims++;

  // очки за длину и сквозной экспресс
  const payColor = pay.n > 0 ? pay.color : null;
  const prev = st.chain[seat];
  let gain = M.scoreFor(r.length);
  let chainNote = '';
  if (st.cfg.chain && prev && (prev.ends.includes(r.from) || prev.ends.includes(r.to))
      && (payColor == null || prev.color == null || prev.color === payColor) && prev.len + r.length <= 10) {
    const len = prev.len + r.length;
    gain = M.scoreFor(len) - M.scoreFor(prev.len);
    st.chain[seat] = { color: prev.color || payColor, ends: [r.from, r.to], len, routes: [...prev.routes, r.id] };
    chainNote = `, сквозной экспресс ${len} ваг.`;
  } else {
    st.chain[seat] = { color: payColor, ends: [r.from, r.to], len: r.length, routes: [r.id] };
  }
  const elec = r.electrified && !r.ghost ? 1 : 0;
  st.score[seat] += gain + elec;
  ctx.log(`${ctx.name(seat)} занимает ${M.routeName(r)} (${r.length} ваг.): +${gain}${elec ? ' +1 ⚡' : ''}${chainNote}`, 'all', { kind: 'claim', route: r.id, pts: { len: r.length, base: M.scoreFor(r.length), chain: gain - M.scoreFor(r.length), chainLen: st.chain[seat].len, elec }, pay: { color: pay.color, n: pay.n + extra.n, loco: pay.loco + extra.loco } });

  // 1921: опустошить склады
  for (const city of raid) {
    const owner = st.depots[city];
    if (owner == null || st.depotsHome[seat] < 1) continue;
    st.depotsHome[seat]--;
    const cards = st.warehouses[owner];
    for (const c of cards) st.hands[seat][c]++;
    st.warehouses[owner] = [];
    ctx.log(`${ctx.name(seat)} сбрасывает депо и забирает склад игрока ${ctx.name(owner)}: ${cardsWord(cards.length)}`, 'all', { kind: 'raid', from: owner, count: cards.length });
  }
  // конечные станции
  for (const c of [r.from, r.to]) {
    if (c in st.terminus && st.terminus[c] == null) {
      st.terminus[c] = seat;
      ctx.log(`${ctx.name(seat)} получает жетон конечной станции «${M.cities[c].name}» (3 очка)`, 'all', { kind: 'terminus', city: c });
    }
  }
  // соседи
  if (st.cfg.modules.neighbors) checkNeighbors(ctx, seat);
  st.ts.claimed = true;
  // путевая карта
  if (st.cfg.modules.routeCards && r.event) drawRouteCard(ctx, seat);
}

function checkNeighbors(ctx, seat) {
  const { st, M } = ctx;
  const set = neighborCountries(M, ownRoutes(M, st, seat), st.cfg);
  const got = st.neighbors.got[seat];
  const have = got.filter((g) => !g.bonus).map((g) => g.country);
  const fresh = [...set].filter((c) => !have.includes(c));
  if (!fresh.length) return;
  const k1 = have.length + fresh.length;
  const delta = neighborPoints(st.cfg, k1) - neighborPoints(st.cfg, have.length);
  fresh.forEach((country, i) => got.push({ country, points: i ? 0 : delta }));   // очки шкалы записываются на первую из новых стран
  const all = [...have, ...fresh];
  ctx.log(`${ctx.name(seat)} соединил страны: ${all.join(', ')} — ${all.length} ${all.length < 5 ? 'страны' : 'стран'}, +${delta} очк. (всего ${neighborPoints(st.cfg, k1)})`, 'all', { kind: 'neighbors', countries: all, points: delta });
  if (st.cfg.neighborsCross && st.neighbors.cross == null && k1 >= (st.cfg.neighborsCrossAt || 4)) {
    st.neighbors.cross = seat;
    got.push({ country: 'Перекрёсток Европы', points: st.cfg.neighborsCross, bonus: true });
    ctx.log(`${ctx.name(seat)} первым соединил 4 страны — «Перекрёсток Европы» +${st.cfg.neighborsCross} очк.`, 'all', { kind: 'neighbors', points: st.cfg.neighborsCross });
  }
}

function drawRouteCard(ctx, seat) {
  const { st, M } = ctx;
  const id = st.routeCardDeck.pop();
  if (!id) { ctx.log('Колода путевых карт пуста'); return; }
  const e = M.events[id];
  if (e.kind === 'keep') {
    st.routeCards[seat].push(id);
    ctx.log(`${ctx.name(seat)} берёт путевую карту`, 'all', { kind: 'routeCard', seat });
    ctx.log(`Ваша путевая карта: «${e.name}» — ${e.text}`, seat, { kind: 'routeCard', id, seat });
    return;
  }
  ctx.log(`${ctx.name(seat)} открывает путевую карту «${e.name}»: ${e.text}`, 'all', { kind: 'routeCard', id, seat });
  const lead = leaders(st);
  if (id === 'e7') for (const q of lead) queueDiscard(ctx, q, Math.min(2, handSize(st.hands[q])), '«Листья на путях»');
  if (id === 'e8') for (const q of lead) st.flags[q].blindOnly = st.turnNo;
  if (id === 'e9') for (const q of lead) st.flags[q].extraCard = true;
  if (id === 'e10') for (const q of lead) if (q !== seat) moveRandomCard(ctx, q, seat);
  if (id === 'e11') for (let q = 0; q < st.n; q++) { const k = handSize(st.hands[q]); if (k >= 12) queueDiscard(ctx, q, k - 10, '«Ревизия»'); }
  if (id === 'e12') for (let q = 0; q < st.n; q++) if (st.score[q] > st.score[seat]) moveRandomCard(ctx, q, seat);
  if (id === 'e8' || id === 'e9') ctx.log(`Действует на: ${lead.map(ctx.name).join(', ')}`);
  st.routeCardDeck.unshift(id); // сыгранная карта — под низ колоды
}

function queueDiscard(ctx, seat, count, reason) {
  if (count <= 0) return;
  ctx.st.pend.push({ seat, kind: 'discard', count, reason });
}

function moveRandomCard(ctx, from, to) {
  const { st } = ctx;
  const pool = [];
  for (const [c, k] of Object.entries(st.hands[from])) for (let i = 0; i < k; i++) pool.push(c);
  if (!pool.length) return;
  const c = pool[randInt(st, pool.length)];
  st.hands[from][c]--; st.hands[to][c]++;
  ctx.log(`${ctx.name(from)} отдаёт игроку ${ctx.name(to)} случайную карту`, 'all', { kind: 'give', from, to });
  ctx.log(`Вы получили: ${cardName(c)}`, to);
  ctx.log(`Вы отдали: ${cardName(c)}`, from);
}

function takeRouteCard(ctx, seat, id) {
  const { st } = ctx;
  const i = st.routeCards[seat].indexOf(id);
  if (i < 0) fail('У вас нет такой путевой карты');
  st.routeCards[seat].splice(i, 1);
  st.routeCardDeck.unshift(id);
}

function normUse(st, seat, use) {
  const out = {};
  for (const k of ['e1', 'e2', 'e5', 'e6']) if (use && use[k]) {
    if (!st.routeCards[seat].includes(k)) fail('У вас нет такой путевой карты');
    out[k] = true;
  }
  return out;
}

function checkRaid(M, st, seat, r, raid) {
  if (!raid || !raid.length) return [];
  if (!st.cfg.modules.depots) fail('Модуль складов выключен');
  const list = uniq(raid);
  for (const c of list) {
    if (c !== r.from && c !== r.to) fail('Склад можно забрать только в конце занятого перегона');
    if (st.depots[c] == null) fail('В этом городе нет депо');
  }
  if (st.depotsHome[seat] < list.length) fail('Не хватает своих депо у склада');
  return list;
}

function payCards(st, seat, color, n, loco) {
  const h = st.hands[seat];
  if (n > 0) { h[color] -= n; for (let i = 0; i < n; i++) st.discard.push(color); }
  if (loco > 0) { h.loco -= loco; for (let i = 0; i < loco; i++) st.discard.push('loco'); }
  if (h[color] < 0 || h.loco < 0) throw new RuleError('Внутренняя ошибка оплаты');
}

function canDrawSecond(st, seat) {
  if (canDrawDeck(st)) return true;
  if (blindOnly(st, seat)) return false;
  return st.faceUp.some((c) => c !== 'loco');
}

/** Есть ли у игрока хоть одно действие, кроме пропуска хода. */
export function hasRealAction(M, st, seat) {
  if (canDrawDeck(st) || (!blindOnly(st, seat) && st.faceUp.length)) return true;
  if (st.ticketDeck.length || (st.cfg.duelOn && st.ticketRow.length)) return true;
  for (const r of M.routeList) {
    if (routeBlock(M, st, seat, r)) continue;
    const h = st.hands[seat];
    const tot = (c) => h[c] + h.loco;
    const { length } = r;
    if ((r.color === 'grey' ? Math.max(...COLORS.map(tot)) : tot(r.color)) >= length + (r.ghost ? 1 : 0)) return true;
  }
  return false;
}

// ---------- конец действия и хода ----------
function finishAction(ctx) {
  const { st } = ctx;
  if (st.pend.length) return; // ждём решений (доплата, выбор маршрутов, сброс)
  endTurn(ctx);
}

function endTurn(ctx) {
  const { st, M } = ctx;
  const seat = st.turn;
  if (!st.ts.claimed) st.chain[seat] = null;
  const f = st.flags[seat];
  if (f.blindOnly != null && f.blindOnly < st.turnNo) delete f.blindOnly;

  // третья цель — когда у кого-то осталось 15 вагонов или меньше
  if (st.goals.ids.length > st.goals.open && st.trains.some((t) => t <= 15)) {
    st.goals.open = st.goals.ids.length;
    const g = M.goals[st.goals.ids[st.goals.open - 1]];
    ctx.log(`Открыта третья цель: «${g.name}» (${g.points} очк.) — ${g.rule}`, 'all', { kind: 'goal', goal: g.id });
  }
  // цели-гонка в дуэли
  if (st.cfg.duelOn) {
    for (const gid of st.goals.ids.slice(0, st.goals.open)) {
      if (st.goals.race[gid] != null) continue;
      const order = [seat, ...st.players.map((_, i) => i).filter((i) => i !== seat)];
      for (const s of order) {
        if (goalMetric(M, st, s, gid) >= RACE_THRESHOLDS[gid]) {
          st.goals.race[gid] = s;
          ctx.log(`${ctx.name(s)} первым выполняет цель «${M.goals[gid].name}» (+${M.goals[gid].points})`, 'all', { kind: 'goal', goal: gid, seat: s });
          break;
        }
      }
    }
  }
  // последний круг
  if (st.endAfterTurnNo == null && st.trains[seat] <= 2) {
    st.endAfterTurnNo = st.turnNo + st.n;
    ctx.log(`У игрока ${ctx.name(seat)} осталось ${st.trains[seat]} ваг. — последний круг: каждый делает ещё один ход`, 'all', { kind: 'lastRound', seat });
  }
  const stuck = st.passes >= st.n * 2;
  if ((st.endAfterTurnNo != null && st.turnNo >= st.endAfterTurnNo) || stuck) {
    if (stuck) ctx.log('Ни у кого нет возможных действий — партия окончена');
    st.phase = 'over';
    st.result = finalScore(M, st);
    const w = st.result.rows[st.result.order[0]];
    ctx.log(`Партия окончена. Побеждает ${w.name} — ${w.total} очк.`, 'all', { kind: 'over' });
    return;
  }
  st.turn = (st.turn + 1) % st.n;
  st.turnNo++;
  st.ts = { drawn: 0, e4: false, claimed: false };
  ctx.log(`Ходит ${ctx.name(st.turn)}`, 'all', { kind: 'turn', seat: st.turn });
}

function uniq(a) { return [...new Set(a)]; }
