// Бот «Средний»: перенос бота Medium из симулятора (belarus_sim.py).
// Строит кратчайшие пути к своим маршрутам, копит нужные цвета, продлевает сквозной экспресс.
import { BotContext } from './common.js';

export function mediumMove(E, v, legal, rng) {
  const b = new BotContext(E, v, legal, rng);
  const targets = b.targets();
  const c = b.common(targets);
  if (c !== undefined) return c;
  return mediumTurn(b, targets);
}

export function mediumTurn(b, targets) {
  const { v, M, me } = b;
  if (v.ts.drawn === 1) return b.drawFor(b.neededColors(targets));
  const claims = b.claims();
  const need = b.neededColors(targets);
  // 1) занять перегон на пути к маршруту
  const byRoute = new Map();
  for (const a of claims) (byRoute.get(a.route) || byRoute.set(a.route, []).get(a.route)).push(a);
  let best = null, bv = -Infinity;
  for (const [rid, val] of targets) {
    const opts = byRoute.get(rid);
    if (!opts) continue;
    const a = b.bestPay(opts, need);
    const r = M.routes[rid];
    const score = r.length * 2 + val * 0.1 - a.pay.loco * 1.5 + b.chainBonus(a);
    if (score > bv) { bv = score; best = a; }
  }
  if (best) return b.withRaid(best);
  const open = b.openTickets();
  // 2) маршрутов нет — добрать, если хватает вагонов
  if (!open.length && v.trains[me] >= 14) {
    const row = b.legal.find((a) => a.type === 'ticketRow');
    if (row) {
      const pick = b.chooseTickets(row.row, 1).slice(0, 2).map((id) => row.row.indexOf(id));
      if (pick.length) return { type: 'ticketRow', seat: me, picks: pick };
    }
    const t = b.legal.find((a) => a.type === 'tickets');
    if (t) return t;
  }
  // 3) целей нет — занять самый длинный доступный перегон
  if (!targets.size) {
    let lb = null;
    for (const a of claims) {
      const r = M.routes[a.route];
      const val = r.length + b.chainBonus(a) * 0.5 - a.pay.loco;
      if (!lb || val > lb.val) lb = { a, val, len: r.length };
    }
    if (lb && (lb.len >= 3 || v.trains[me] <= 6 || !b.legal.some((a) => a.type === 'draw'))) return b.withRaid(lb.a);
  }
  // 4) карты под нужные цвета
  const d = b.drawFor(need);
  if (d) return d;
  if (claims.length) return claims[0];
  return b.legal.find((a) => !a.template) || null;
}
