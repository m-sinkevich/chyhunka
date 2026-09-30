// Подготовка статических данных карты: индексы, смежность, группы двойных перегонов.
// Карта (data/map.json) меняется только правкой JSON — код от неё не зависит.

export const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'white', 'black'];
export const CARD_TYPES = [...COLORS, 'loco'];
export const COLOR_NAMES = {
  red: 'красный', orange: 'оранжевый', yellow: 'жёлтый', green: 'зелёный', blue: 'синий',
  purple: 'фиолетовый', white: 'белый', black: 'чёрный', grey: 'серый', loco: 'Локомотив',
};
export const POLESIE = ['pinsk', 'luninets', 'kalinkovichi', 'mozyr', 'khoiniki'];
export const NEIGHBOR_CARDS = [10, 7, 4, 2];
export const TERMINUS_POINTS = 3;
export const DEPOT_BONUS = 10;
export const STATION_BONUS = 4;

/** Пороги целей в режиме «гонка» (дуэль). */
export const RACE_THRESHOLDS = {
  g_express: 15, g_ring: 10, g_globe: 4, g_tourist: 3, g_local: 15,
  g_capital: 3, g_border: 3, g_polesie: 8, g_vilnius: 2,
};

export function prepare(map) {
  const M = {
    map,
    scoring: Object.fromEntries(Object.entries(map.scoring).map(([k, v]) => [Number(k), v])),
    cities: {}, routes: {}, adj: {}, siblings: {}, tickets: {}, postcards: {}, events: {}, goals: {},
    routeList: map.routes, cityList: map.cities,
    country: {}, colors: map.colors,
  };
  for (const c of map.cities) {
    M.cities[c.id] = c;
    M.adj[c.id] = [];
    if (c.type === 'ext') M.country[c.id] = (c.country || c.id).split(' ')[0];
  }
  const groups = {};
  for (const r of map.routes) {
    M.routes[r.id] = r;
    M.adj[r.from].push(r);
    M.adj[r.to].push(r);
    (groups[r.group] ||= []).push(r.id);
  }
  for (const ids of Object.values(groups)) for (const id of ids) M.siblings[id] = ids.filter((x) => x !== id);
  for (const t of map.tickets) M.tickets[t.id] = t;
  for (const p of map.tourist) M.postcards[p.id] = p;
  for (const e of map.events) M.events[e.id] = e;
  for (const g of map.goals) M.goals[g.id] = g;
  M.isBorder = (r) => (M.cities[r.from].type === 'ext') !== (M.cities[r.to].type === 'ext');
  M.other = (r, c) => (r.from === c ? r.to : r.from);
  M.routeName = (r) => `${M.cities[r.from].name} — ${M.cities[r.to].name}`;
  M.scoreFor = (len) => M.scoring[Math.min(len, 10)] ?? 0;
  return M;
}
