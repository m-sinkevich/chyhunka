// Что видит игрок: своя рука, свои маршруты и открытки; у соперников — только количество.
// seat = -1 — публичная часть (public_state). После конца партии раскрывается всё, включая seed.
import { handSize } from './state.js';

const counts = (arr) => arr.map((x) => x.length);

export function view(M, st, seat) {
  const over = st.phase === 'over';
  const mine = (s) => over || s === seat;
  const discardCounts = {};
  for (const c of st.discard) discardCounts[c] = (discardCounts[c] || 0) + 1;
  const p = st.pend[0];
  let pending = null;
  if (p) {
    pending = { seat: p.seat, kind: p.kind };
    if (p.kind === 'tunnel') Object.assign(pending, { route: p.route, revealed: p.revealed, extra: p.extra, pay: p.pay, use: p.use });
    if (p.kind === 'discard') Object.assign(pending, { count: p.count, reason: p.reason });
    if (p.kind === 'keepTickets') Object.assign(pending, { offerCount: p.offer.length, postCount: p.postOffer.length });
    if (p.kind === 'keepTickets' && p.seat === seat) Object.assign(pending, { offer: p.offer, min: p.min, postOffer: p.postOffer });
  }
  const setup = {
    waiting: [...new Set([...Object.keys(st.setup.tickets), ...Object.keys(st.setup.postcards)].map(Number))],
    depotOrder: st.setup.depotOrder,
    tickets: seat >= 0 ? st.setup.tickets[seat] || null : null,
    postcards: seat >= 0 ? st.setup.postcards[seat] || null : null,
  };
  return {
    v: st.v, cfg: st.cfg, n: st.n, me: seat, players: st.players,
    phase: st.phase, turn: st.turn, turnNo: st.turnNo, seq: st.seq,
    deckCount: st.deck.length, discardCount: st.discard.length, discardCounts, faceUp: st.faceUp,
    hand: seat >= 0 ? st.hands[seat] : null,
    hands: over ? st.hands : null,
    handCounts: st.hands.map(handSize),
    trains: st.trains, stationsLeft: st.stationsLeft, stationsAt: st.stationsAt,
    score: st.score, claims: st.claims, removed: st.removed,
    tickets: st.tickets.map((t, s) => (mine(s) ? t : null)), ticketCounts: counts(st.tickets),
    ticketDeckCount: st.ticketDeck.length, ticketRow: st.ticketRow,
    postcards: st.postcards.map((t, s) => (mine(s) ? t : null)), postcardCounts: counts(st.postcards),
    goals: { open: st.goals.ids.slice(0, st.goals.open), total: st.goals.ids.length, race: st.goals.race },
    routeCards: st.routeCards.map((t, s) => (mine(s) ? t : null)), routeCardCounts: counts(st.routeCards),
    routeCardDeckCount: st.routeCardDeck.length,
    flags: st.flags,
    warehouseCounts: counts(st.warehouses), depotsHome: st.depotsHome, depots: st.depots,
    neighbors: st.neighbors, terminus: st.terminus, chain: st.chain,
    pending, setup, ts: st.ts, endAfterTurnNo: st.endAfterTurnNo,
    result: st.result, seed: over ? st.seed : null,
    stats: st.stats,
  };
}

export const publicView = (M, st) => view(M, st, -1);
