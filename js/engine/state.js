// Настройки партии и начальное состояние.
import { COLORS, CARD_TYPES, NEIGHBOR_CARDS } from './data.js';
import { shuffle } from './rng.js';

export const RULES_VERSION = '0.3.0';

export const TICKET_SETS = {
  base: 'Базовая Беларусь',
  extended: 'Беларусь расширенная',
  bigcities: 'Большие города',
  mega: 'Мега-Беларусь',
};

export const MODULES = {
  depots: { name: 'Склады и депо (1921)', hint: 'Взяв карту из колоды, кладёте ещё одну на любой склад; заняв перегон в город с депо, можно забрать склад.' },
  tourism: { name: 'Туризм', hint: 'Открытки с городами: в конце +цена, если сеть касается города, иначе −цена.' },
  routeCards: { name: 'Путевые карты', hint: 'Заняв перегон со значком «?», берёте путевую карту: бонус себе или удар по лидеру.' },
  neighbors: { name: 'Соседи', hint: 'Соедините своей сетью пункты разных стран через Беларусь (на пути — не меньше 2 перегонов внутри страны, окружная не в счёт): 2 страны — 12 очков, 3 — 20, 4 — 30, 5 — 42.' },
  terminus: { name: 'Конечные станции', hint: 'Первый, кто занял перегон в конечную станцию, получает жетон 3 очка.' },
};

export const PRESETS = {
  first: { name: 'Первая партия', cfg: { tickets: 'base', goals: 'random', modules: {} } },
  standard: { name: 'Стандарт', cfg: { tickets: 'base', goals: 'random', modules: { routeCards: true, terminus: true } } },
  all: { name: 'Всё включено', cfg: { tickets: 'extended', goals: 'random', modules: { depots: true, tourism: true, routeCards: true, neighbors: true, terminus: true } } },
  duel: { name: 'Дуэль', cfg: { tickets: 'base', goals: 'random', modules: { terminus: true } } },
};

/** Дополняет настройки значениями по умолчанию и проверяет их. */
export function normalizeConfig(cfg = {}, n) {
  const c = {
    rulesVersion: RULES_VERSION,
    trains: 45, stations: 3, tickets: 'base', goals: 'random',
    chain: true, leader4: true, strictHistorical: false, quick: false,
    duel: 'auto', turnTimer: 0,
    ...cfg,
    modules: { depots: false, tourism: false, routeCards: false, neighbors: false, terminus: false, ...(cfg.modules || {}) },
  };
  c.players = n;
  if (!(n >= 2 && n <= 5)) throw new Error('В партии должно быть от 2 до 5 игроков');
  if (!TICKET_SETS[c.tickets]) throw new Error('Неизвестный набор маршрутов');
  c.duelOn = n === 2 && c.duel !== 'off';
  if (c.quick) { c.trains = Math.min(c.trains, 30); c.stations = Math.min(c.stations, 2); }
  c.trains = Math.max(10, Math.min(60, Number(c.trains) || 45));
  c.stations = Math.max(0, Math.min(3, Number(c.stations)));
  if (Array.isArray(c.goals)) {
    if (c.goals.length !== 3) throw new Error('Нужно выбрать ровно 3 цели');
    if (c.goals.includes('g_tourist') && !c.modules.tourism) throw new Error('Цель «Турист» требует модуль «Туризм»');
  } else if (!['random', 'off'].includes(c.goals)) c.goals = 'random';
  return c;
}

const emptyHand = () => Object.fromEntries(CARD_TYPES.map((k) => [k, 0]));

export function newDeck(st) {
  const d = [];
  for (const c of COLORS) for (let i = 0; i < 12; i++) d.push(c);
  for (let i = 0; i < 14; i++) d.push('loco');
  return shuffle(st, d);
}

/**
 * Начальное состояние. players: [{name, color, bot?}] в порядке хода.
 * Всё состояние — простой JSON: его можно сохранить в host_state и восстановить.
 */
export function initState(M, cfgIn, players, seed) {
  const n = players.length;
  const cfg = normalizeConfig(cfgIn, n);
  const st = {
    v: RULES_VERSION, cfg, seed: seed >>> 0, rng: seed >>> 0, n,
    players: players.map((p, i) => ({ name: p.name, color: p.color, bot: p.bot || null, dbSeat: p.dbSeat ?? i })),
    phase: 'setup', turn: 0, turnNo: 0, seq: 0, passes: 0,
    deck: [], discard: [], faceUp: [],
    hands: Array.from({ length: n }, emptyHand),
    trains: Array(n).fill(cfg.trains), stationsLeft: Array(n).fill(cfg.stations),
    stationsAt: {}, // city -> [seat]
    score: Array(n).fill(0), claims: {}, // routeId -> seat
    tickets: Array.from({ length: n }, () => []),
    ticketDeck: [], longDeck: [], ticketRow: [],
    postcards: Array.from({ length: n }, () => []), postcardDeck: [],
    goals: { ids: [], open: 0, race: {} },
    routeCardDeck: [], routeCards: Array.from({ length: n }, () => []),
    flags: Array.from({ length: n }, () => ({})), // эффекты путевых карт на следующий ход
    warehouses: Array.from({ length: n }, () => []), depotsHome: Array(n).fill(0), depots: {},
    neighbors: { stacks: {}, got: Array.from({ length: n }, () => []) },
    terminus: {},
    chain: Array(n).fill(null),
    stats: Array.from({ length: n }, () => ({ claims: 0, ticketsDrawn: 0 })),
    pend: [], ts: { drawn: 0, e4: false },
    endAfterTurnNo: null, result: null,
    removed: {}, // перегоны, убранные с поля (строгий исторический режим)
    setup: { tickets: {}, postcards: {}, depotOrder: [] },
  };
  if (cfg.strictHistorical) for (const r of M.routeList) if (r.ghostType === 'fantasy') st.removed[r.id] = true;

  // карты составов: первый игрок 4, остальные 5 (компенсация первого хода)
  st.deck = newDeck(st);
  for (let p = 0; p < n; p++) {
    const k = p === 0 ? 4 : 5;
    for (let i = 0; i < k; i++) st.hands[p][st.deck.pop()]++;
  }
  refillFaceUp(st);

  // маршруты
  const T = M.map.tickets;
  const bySet = (s) => T.filter((t) => s.includes(t.set)).map((t) => t.id);
  let startLong = 1, startMain = 3, keepMin = 2, maxLong = 1;
  if (cfg.tickets === 'base') { st.ticketDeck = bySet(['base']); st.longDeck = bySet(['long']); }
  if (cfg.tickets === 'extended') { st.ticketDeck = bySet(['base', 'extended']); st.longDeck = bySet(['long']); }
  if (cfg.tickets === 'bigcities') { st.ticketDeck = bySet(['bigcities']); st.longDeck = []; startLong = 0; startMain = 4; }
  if (cfg.tickets === 'mega') { st.ticketDeck = bySet(['base', 'extended', 'bigcities']); st.longDeck = bySet(['long', 'transit']); startLong = 2; }
  if (cfg.quick) { startLong = 0; startMain = 3; }
  shuffle(st, st.ticketDeck); shuffle(st, st.longDeck);
  for (let p = 0; p < n; p++) {
    const offer = [];
    for (let i = 0; i < startLong && st.longDeck.length; i++) offer.push(st.longDeck.pop());
    for (let i = 0; i < startMain && st.ticketDeck.length; i++) offer.push(st.ticketDeck.pop());
    st.setup.tickets[p] = { offer, min: Math.min(keepMin, offer.length), maxLong };
  }
  if (cfg.duelOn) for (let i = 0; i < 4 && st.ticketDeck.length; i++) st.ticketRow.push(st.ticketDeck.pop());

  // туризм
  if (cfg.modules.tourism) {
    st.postcardDeck = shuffle(st, M.map.tourist.map((p) => p.id));
    for (let p = 0; p < n; p++) st.setup.postcards[p] = { offer: st.postcardDeck.splice(-3), min: 1 };
  }
  // цели: 3 случайные (или выбранные хозяином), 2 открыты сразу
  if (cfg.goals !== 'off') {
    const pool = M.map.goals.filter((g) => !g.requires || cfg.modules[g.requires]).map((g) => g.id);
    st.goals.ids = Array.isArray(cfg.goals) ? [...cfg.goals] : shuffle(st, pool).slice(0, 3);
    st.goals.open = 2;
  }
  if (cfg.modules.routeCards) st.routeCardDeck = shuffle(st, M.map.events.map((e) => e.id));
  if (cfg.modules.depots) {
    st.depotsHome = Array(n).fill(4);
    for (let p = n - 1; p >= 0; p--) st.setup.depotOrder.push(p); // пятое депо: с последнего игрока против часовой
  }
  if (cfg.modules.neighbors) {
    for (const c of Object.values(M.country)) st.neighbors.stacks[c] = [...NEIGHBOR_CARDS];
  }
  if (cfg.modules.terminus) for (const c of M.cityList) if (c.terminus) st.terminus[c.id] = null;
  return st;
}

/** Взять карту из колоды; пустая колода → перемешать сброс; всё пусто → опустошить склады (1921). */
export function drawCard(st) {
  if (!st.deck.length && st.discard.length) {
    st.deck = shuffle(st, st.discard);
    st.discard = [];
  }
  if (!st.deck.length && st.cfg.modules.depots) {
    const all = st.warehouses.flat();
    if (all.length) {
      st.warehouses = st.warehouses.map(() => []);
      st.deck = shuffle(st, all);
    }
  }
  return st.deck.length ? st.deck.pop() : null;
}

/** Пополнить открытый ряд; три Локомотива → сбросить ряд и выложить заново. */
export function refillFaceUp(st) {
  for (let attempt = 0; attempt < 5; attempt++) {
    while (st.faceUp.length < 5) {
      const c = drawCard(st);
      if (!c) break;
      st.faceUp.push(c);
    }
    const locos = st.faceUp.filter((c) => c === 'loco').length;
    const pool = st.deck.length + st.discard.length;
    if (locos >= 3 && pool >= 5) {
      st.discard.push(...st.faceUp);
      st.faceUp = [];
    } else break;
  }
}

export const handSize = (h) => CARD_TYPES.reduce((s, k) => s + h[k], 0);
export const COLORS_ = COLORS;
