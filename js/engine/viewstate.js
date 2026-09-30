// Гость не знает полного состояния, но для кнопок и подсказок ему нужны допустимые действия.
// Здесь из «вида» игрока собирается псевдо-состояние: скрытые карты заменены заглушками нужной длины.
// Окончательную проверку всё равно делает движок у хозяина.
import { CARD_TYPES } from './data.js';
import { legalActions, claimOptions } from './actions.js';

const emptyHand = () => Object.fromEntries(CARD_TYPES.map((k) => [k, 0]));
const stub = (n) => Array(n).fill('?');

export function stateFromView(v) {
  const me = v.me;
  const hands = v.players.map((_, i) => (i === me && v.hand ? v.hand : emptyHand()));
  const discard = [];
  for (const [c, k] of Object.entries(v.discardCounts || {})) for (let i = 0; i < k; i++) discard.push(c);
  const pend = [];
  if (v.pending) {
    const p = { ...v.pending };
    if (p.kind === 'keepTickets') { p.offer = p.offer || []; p.postOffer = p.postOffer || []; }
    pend.push(p);
  }
  const setup = { tickets: {}, postcards: {}, depotOrder: v.setup?.depotOrder || [] };
  if (v.setup?.tickets) setup.tickets[me] = v.setup.tickets;
  if (v.setup?.postcards) setup.postcards[me] = v.setup.postcards;
  return {
    v: v.v, cfg: v.cfg, n: v.n, players: v.players, phase: v.phase, turn: v.turn, turnNo: v.turnNo, seq: v.seq,
    deck: stub(v.deckCount), discard, faceUp: v.faceUp, hands,
    trains: v.trains, stationsLeft: v.stationsLeft, stationsAt: v.stationsAt, score: v.score, claims: v.claims,
    tickets: v.tickets.map((t, i) => t || stub(v.ticketCounts[i])), ticketDeck: stub(v.ticketDeckCount), ticketRow: v.ticketRow,
    postcards: v.postcards.map((t, i) => t || stub(v.postcardCounts[i])),
    routeCards: v.routeCards.map((t, i) => t || stub(v.routeCardCounts[i])), routeCardDeck: stub(v.routeCardDeckCount),
    flags: v.flags, warehouses: v.warehouseCounts.map(stub), depotsHome: v.depotsHome, depots: v.depots,
    neighbors: v.neighbors, terminus: v.terminus, chain: v.chain, goals: { ids: v.goals.open, open: v.goals.open.length, race: v.goals.race },
    pend, ts: v.ts, setup, removed: v.removed || {}, endAfterTurnNo: v.endAfterTurnNo, passes: 0, result: v.result,
  };
}

export function legalFromView(M, v) {
  if (v.me < 0) return [];
  return legalActions(M, stateFromView(v), v.me);
}

export function claimOptionsFromView(M, v, routeId, use) {
  return claimOptions(M, stateFromView(v), v.me, routeId, use);
}
