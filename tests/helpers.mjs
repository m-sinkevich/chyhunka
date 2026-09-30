import { readFileSync } from 'node:fs';
import { makeEngine, COLORS } from '../js/engine/index.js';
import { makeRng } from '../js/engine/rng.js';
export const MAP = JSON.parse(readFileSync(new URL('../data/map.json', import.meta.url)));
export const E = makeEngine(MAP);
export const players = (n) => Array.from({ length: n }, (_, i) => ({ name: 'И' + (i + 1), color: ['red', 'blue', 'green', 'yellow', 'black'][i] }));

/** Случайный игрок: выбирает любое допустимое действие и заполняет шаблоны. */
export function randomAction(st, seat, rng) {
  const legal = E.legal(st, seat);
  if (!legal.length) return null;
  const a = rng.pick(legal);
  if (!a.template) return a;
  const h = st.hands[seat];
  const cardsOf = (k, src) => { const pool = []; for (const [c, v] of Object.entries(src)) for (let i = 0; i < v; i++) pool.push(c); rng.shuffle(pool); const out = {}; for (const c of pool.slice(0, k)) out[c] = (out[c] || 0) + 1; return out; };
  switch (a.type) {
    case 'setupTickets': { let keep = a.offer.filter((t) => !['long', 'transit'].includes(E.M.tickets[t].set)).slice(0, Math.max(a.min, 2)); const lg = a.offer.find((t) => ['long', 'transit'].includes(E.M.tickets[t].set)); if (lg && keep.length >= a.min && rng.next() < 0.5) keep = [lg, ...keep.slice(0, Math.max(1, a.min - 1))]; if (keep.length < a.min) keep = a.offer.slice(0, a.min); return { type: a.type, seat, tickets: keep }; }
    case 'setupPostcards': return { type: a.type, seat, postcards: a.offer.slice(0, 1 + rng.int(a.offer.length)) };
    case 'setupDepot': return { type: a.type, seat, city: rng.pick(a.cities) };
    case 'keep': return { type: 'keep', seat, tickets: a.offer.slice(0, 1 + rng.int(a.offer.length)), postcards: a.postOffer.filter(() => rng.next() < 0.5) };
    case 'discard': return { type: 'discard', seat, cards: cardsOf(a.count, h) };
    case 'ticketRow': return { type: a.type, seat, picks: [rng.int(a.row.length)] };
    case 'station': { const k = a.cost; const col = COLORS.find((c) => h[c] + h.loco >= k); if (!col) return { type: 'draw', seat, source: 'deck', wh: 0 }; const n = Math.min(h[col], k); return { type: 'station', seat, city: rng.pick(a.cities), pay: { color: col, n, loco: k - n } }; }
    case 'swap': return { type: 'swap', seat, cards: cardsOf(1 + rng.int(3), h) };
    case 'vitrina': return { type: 'vitrina', seat, picks: [0, 1, 2, 3, 4].slice(0, Math.min(3, st.faceUp.length)) };
    case 'fromDiscard': { const dc = {}; for (const c of st.discard) dc[c] = (dc[c] || 0) + 1; return { type: 'fromDiscard', seat, cards: cardsOf(Math.min(3, st.discard.length), dc) }; }
    case 'placeDepot': return { type: 'placeDepot', seat, city: rng.pick(E.M.cityList.filter((c) => st.depots[c.id] == null)).id };
  }
  return a;
}
export { makeRng };
