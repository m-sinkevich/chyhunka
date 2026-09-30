// Бот «Лёгкий»: короткие маршруты, случайный подходящий перегон, часто тянет карты вслепую.
import { BotContext } from './common.js';

export function easyMove(E, v, legal, rng) {
  const b = new BotContext(E, v, legal, rng);
  const targets = b.targets();
  // выбор маршрутов наугад (без расчёта пути) — главная слабость «Лёгкого»
  const k = legal[0];
  if (k && (k.type === 'setupTickets' || k.type === 'keep')) {
    const offer = [...k.offer];
    rng.shuffle(offer);
    let keep = offer.filter((id) => !['long', 'transit'].includes(b.M.tickets[id].set)).slice(0, Math.max(k.min, 2));
    if (keep.length < k.min) keep = offer.slice(0, k.min);
    return k.type === 'keep' ? { type: 'keep', seat: b.me, tickets: keep, postcards: [] } : { type: k.type, seat: b.me, tickets: keep };
  }
  const c = b.common(targets);
  if (c !== undefined) return c;
  const { M, me } = b;
  if (v.ts.drawn === 1) return rng.next() < 0.6 ? (legal.find((a) => a.source === 'deck' && (a.wh == null || a.wh === me)) || legal[0]) : b.drawFor(b.neededColors(targets), 0.1);
  const claims = b.claims().filter((a) => targets.has(a.route));
  if (claims.length && rng.next() < 0.45) {
    const a = rng.pick(claims);
    return a;
  }
  if (!b.openTickets().length && v.trains[me] >= 18) {
    const t = legal.find((a) => a.type === 'tickets');
    if (t) return t;
  }
  if (!targets.size) {
    const any = b.claims().filter((a) => M.routes[a.route].length >= 2);
    if (any.length) return rng.pick(any);
  }
  const d = rng.next() < 0.75 ? legal.find((a) => a.type === 'draw' && a.source === 'deck' && (a.wh == null || a.wh === me)) : b.drawFor(b.neededColors(targets), 0.15);
  return d || b.drawFor({}) || b.claims()[0] || legal.find((a) => !a.template) || null;
}
