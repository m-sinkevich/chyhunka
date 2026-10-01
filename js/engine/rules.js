// Правила: можно ли занять перегон, варианты оплаты, лидеры, сети игроков, метрики целей.
import { COLORS, POLESIE } from './data.js';
import { handSize } from './state.js';

export class RuleError extends Error {}
export const fail = (msg) => { throw new RuleError(msg); };

export function leaders(st) {
  const m = Math.max(...st.score);
  return st.score.map((s, i) => (s === m ? i : -1)).filter((i) => i >= 0);
}
export const isSoleLeader = (st, seat) => { const L = leaders(st); return L.length === 1 && L[0] === seat; };

export function blindOnly(st, seat) {
  const f = st.flags[seat];
  return f.blindOnly != null && f.blindOnly < st.turnNo;
}

/** Можно ли игроку занять перегон (без учёта карт и вагонов). Возвращает текст причины или null. */
export function routeBlock(M, st, seat, r, use = {}) {
  if (st.removed[r.id]) return 'Перегон убран в строгом историческом режиме';
  if (st.claims[r.id] != null) return 'Перегон уже занят';
  for (const s of M.siblings[r.id]) {
    const owner = st.claims[s];
    if (owner == null) continue;
    if (use.e1) continue; // «Ремонтная бригада»
    if (st.n <= 3 || st.cfg.duelOn) return 'Второй ряд двойного перегона закрыт при 2–3 игроках';
    if (owner === seat) return 'Нельзя занять оба ряда двойного перегона';
  }
  if (st.trains[seat] < r.length) return `Не хватает вагонов: перегон на ${r.length}, а у вас осталось ${st.trains[seat]}`;
  return null;
}

/** Сколько карт нужно и сколько из них обязательно Локомотивы. */
export function routeNeed(st, seat, r) {
  const need = r.length + (r.ghost ? 1 : 0) + (st.flags[seat].extraCard ? 1 : 0);
  const minLoco = r.ghost || r.mountain ? 1 : 0;
  return { need, minLoco };
}

/** Проверка оплаты перегона. pay = {color, n, loco}; use = {e1,e2,e5,e6}. */
export function checkRoutePay(M, st, seat, r, pay, use = {}) {
  const h = st.hands[seat];
  const { need, minLoco } = routeNeed(st, seat, r);
  const n = pay.n | 0, loco = pay.loco | 0;
  if (n < 0 || loco < 0) return 'Неверная оплата';
  if (n + loco !== need) return `Нужно ${need} карт`;
  if (loco < minLoco) return r.ghost ? 'Призрачная ветка требует Локомотив' : 'Горный перегон требует Локомотив';
  const spare = use.e6 ? 1 : 0;
  if (loco - spare > h.loco || loco < spare) return 'Не хватает Локомотивов';
  if (n > 0) {
    if (!COLORS.includes(pay.color)) return 'Неверный цвет';
    if (r.color !== 'grey' && !use.e2 && pay.color !== r.color) return 'Цвет карт не совпадает с перегоном';
    if (h[pay.color] < n) return 'Не хватает карт этого цвета';
  }
  return null;
}

/** Все варианты оплаты перегона при текущей руке. */
export function payOptions(M, st, seat, r, use = {}) {
  const h = st.hands[seat];
  const { need, minLoco } = routeNeed(st, seat, r);
  const locoHave = h.loco + (use.e6 ? 1 : 0);
  const out = [];
  const cols = r.color === 'grey' || use.e2 ? COLORS : [r.color];
  for (const c of cols) {
    for (let loco = Math.max(minLoco, need - h[c]); loco <= Math.min(locoHave, need - 1); loco++) {
      if (use.e6 && loco < 1) continue;
      out.push({ color: c, n: need - loco, loco });
    }
  }
  out.sort((a, b) => a.loco - b.loco);
  if (locoHave >= need && need >= minLoco) out.push({ color: r.color === 'grey' ? null : r.color, n: 0, loco: need }); // только Локомотивы — последним вариантом
  return out.filter((p) => !checkRoutePay(M, st, seat, r, p, use));
}

export function stationCost(st, seat) { return st.cfg.stations - st.stationsLeft[seat] + 1; }
export function stationBlock(M, st, seat, city) {
  if (!M.cities[city]) return 'Нет такого города';
  if (st.stationsLeft[seat] <= 0) return 'Станций не осталось';
  const here = st.stationsAt[city] || [];
  if (here.includes(seat)) return 'Здесь уже есть ваша станция';
  const max = city === 'minsk' && !st.cfg.duelOn ? 3 : 1;
  if (here.length >= max) return city === 'minsk' ? 'В Минске больше нет мест для станций' : 'В городе уже есть станция';
  return null;
}
export function checkStationPay(st, seat, pay) {
  const k = stationCost(st, seat), h = st.hands[seat];
  const n = pay.n | 0, loco = pay.loco | 0;
  if (n + loco !== k) return `Станция стоит ${k} карт(ы) одного цвета`;
  if (loco > h.loco) return 'Не хватает Локомотивов';
  if (n > 0 && (!COLORS.includes(pay.color) || h[pay.color] < n)) return 'Не хватает карт этого цвета';
  return null;
}

// ---------- сети ----------
export const ownRoutes = (M, st, seat) => Object.keys(st.claims).filter((id) => st.claims[id] === seat).map((id) => M.routes[id]);

export function components(routes) {
  const parent = {};
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const add = (x) => { if (!(x in parent)) parent[x] = x; };
  for (const r of routes) { add(r.from); add(r.to); parent[find(r.from)] = find(r.to); }
  return { has: (x) => x in parent, same: (a, b) => a in parent && b in parent && find(a) === find(b), find, cities: () => Object.keys(parent) };
}

/** Самый длинный непрерывный путь (каждый перегон один раз, города можно проходить повторно). */
export function longestTrail(M, routes) {
  const adj = {};
  for (const r of routes) { (adj[r.from] ||= []).push(r); (adj[r.to] ||= []).push(r); }
  let best = 0;
  const used = new Set();
  const dfs = (u, len) => {
    if (len > best) best = len;
    for (const r of adj[u] || []) {
      if (used.has(r.id)) continue;
      used.add(r.id); dfs(M.other(r, u), len + r.length); used.delete(r.id);
    }
  };
  for (const c of Object.keys(adj)) dfs(c, 0);
  return best;
}

/** Метрики целей. net — сеть с учётом станций (для билетов и открыток), по умолчанию только свои перегоны. */
export function goalMetric(M, st, seat, gid, net) {
  const own = ownRoutes(M, st, seat);
  const comp = components(net || own);
  switch (gid) {
    case 'g_express': return longestTrail(M, own);
    case 'g_ring': return longestTrail(M, own.filter((r) => r.ring));
    case 'g_globe': return st.tickets[seat].filter((t) => comp.same(M.tickets[t].from, M.tickets[t].to)).length;
    case 'g_tourist': return st.postcards[seat].filter((p) => comp.has(M.postcards[p].city)).length;
    case 'g_local': { const s = new Set(); for (const r of own) { s.add(r.from); s.add(r.to); } return s.size; }
    case 'g_capital': return own.filter((r) => r.from === 'minsk' || r.to === 'minsk').length;
    case 'g_border': return own.filter((r) => M.isBorder(r)).length;
    case 'g_polesie': return own.filter((r) => POLESIE.includes(r.from) || POLESIE.includes(r.to)).reduce((s, r) => s + r.length, 0);
    case 'g_vilnius': return own.filter((r) => r.from === 'vilnius' || r.to === 'vilnius').length;
    default: return 0;
  }
}

export const cardsInHand = (st, seat) => handSize(st.hands[seat]);

/** Можно ли ещё что-то взять из колоды/сброса/складов. */
export function canDrawDeck(st) {
  return st.deck.length > 0 || st.discard.length > 0 || (st.cfg.modules.depots && st.warehouses.some((w) => w.length));
}
