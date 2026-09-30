// Подсчёт очков в конце партии.
import { STATION_BONUS, DEPOT_BONUS, TERMINUS_POINTS } from './data.js';
import { ownRoutes, components, goalMetric } from './rules.js';

/** Лучший выбор чужих перегонов для станций игрока (перебор, станций не больше 3). */
export function bestStationUse(M, st, seat) {
  const cities = Object.keys(st.stationsAt).filter((c) => st.stationsAt[c].includes(seat));
  const own = ownRoutes(M, st, seat);
  const opts = cities.map((c) => [null, ...M.adj[c].filter((r) => st.claims[r.id] != null && st.claims[r.id] !== seat)]);
  let best = { value: -Infinity, pick: [] };
  const evalPick = (pick) => {
    const net = own.concat(pick.filter(Boolean));
    return ticketPart(M, st, seat, net).total + postcardPart(M, st, seat, net).total;
  };
  const rec = (i, pick) => {
    if (i === opts.length) {
      const v = evalPick(pick);
      if (v > best.value) best = { value: v, pick: [...pick] };
      return;
    }
    for (const o of opts[i]) { pick.push(o); rec(i + 1, pick); pick.pop(); }
  };
  rec(0, []);
  return { cities, routes: best.pick.map((r) => (r ? r.id : null)), net: own.concat(best.pick.filter(Boolean)) };
}

export function ticketPart(M, st, seat, net) {
  const comp = components(net);
  const rows = st.tickets[seat].map((id) => {
    const t = M.tickets[id];
    return { id, done: comp.same(t.from, t.to), points: t.points };
  });
  let total = rows.reduce((s, r) => s + (r.done ? r.points : -r.points), 0);
  let forgiven = null;
  if (st.cfg.duelOn) { // «Списать билет»: один невыполненный не вычитается
    const miss = rows.filter((r) => !r.done).sort((a, b) => b.points - a.points)[0];
    if (miss) { forgiven = miss.id; total += miss.points; }
  }
  return { rows, total, done: rows.filter((r) => r.done).length, forgiven };
}

export function postcardPart(M, st, seat, net) {
  const comp = components(net);
  const rows = st.postcards[seat].map((id) => {
    const p = M.postcards[id];
    return { id, done: comp.has(p.city) || (st.stationsAt[p.city] || []).includes(seat), points: p.points };
  });
  return { rows, total: rows.reduce((s, r) => s + (r.done ? r.points : -r.points), 0) };
}

/** Кто получает цель: в режиме гонки — первый выполнивший, иначе максимум метрики (>0), ничья — все. */
export function goalHolders(M, st, gid, nets) {
  if (st.cfg.duelOn && st.goals.race[gid] != null) return [st.goals.race[gid]];
  if (st.cfg.duelOn) return [];
  const vals = st.players.map((_, s) => goalMetric(M, st, s, gid, nets ? nets[s] : null));
  const m = Math.max(...vals);
  return m > 0 ? vals.map((v, i) => (v === m ? i : -1)).filter((i) => i >= 0) : [];
}

export function finalScore(M, st) {
  const n = st.n;
  const stations = st.players.map((_, s) => bestStationUse(M, st, s));
  const nets = stations.map((x) => x.net);
  const goalIds = st.goals.ids.slice(0, st.goals.open);
  const holders = Object.fromEntries(goalIds.map((g) => [g, goalHolders(M, st, g, nets)]));
  const maxDepots = Math.max(...st.depotsHome);
  const rows = st.players.map((p, s) => {
    const tk = ticketPart(M, st, s, nets[s]);
    const pc = postcardPart(M, st, s, nets[s]);
    const goals = goalIds.filter((g) => holders[g].includes(s)).map((g) => ({ id: g, points: M.goals[g].points }));
    const depots = st.cfg.modules.depots && maxDepots > 0 && st.depotsHome[s] === maxDepots ? DEPOT_BONUS : 0;
    const neighbors = st.neighbors.got[s].reduce((a, x) => a + x.points, 0);
    const terminus = Object.values(st.terminus).filter((o) => o === s).length * TERMINUS_POINTS;
    const parts = {
      routes: st.score[s],
      stations: st.stationsLeft[s] * STATION_BONUS,
      tickets: tk.total,
      goals: goals.reduce((a, g) => a + g.points, 0),
      postcards: st.cfg.modules.tourism ? pc.total : 0,
      depots, neighbors, terminus,
    };
    const total = Object.values(parts).reduce((a, b) => a + b, 0);
    return {
      seat: s, name: p.name, parts, total,
      ticketsDone: tk.done, ticketRows: tk.rows, forgiven: tk.forgiven, postcardRows: pc.rows,
      goals, stationsUsed: st.cfg.stations - st.stationsLeft[s], stationRoutes: stations[s],
    };
  });
  // победитель: сумма, затем больше выполненных билетов, затем меньше станций, затем больше целей
  const order = [...rows].sort((a, b) => b.total - a.total || b.ticketsDone - a.ticketsDone || a.stationsUsed - b.stationsUsed || b.goals.length - a.goals.length);
  order.forEach((r, i) => { r.place = i + 1; });
  return { rows, order: order.map((r) => r.seat), holders, n };
}
