// Итоги партии: таблица очков по статьям, маршруты игроков, реванш, журнал.
import { h, modal } from './dom.js';
import { pdot } from './cards.js';
import { ruleLink } from './rules.js';

const PARTS = [['routes', 'Перегоны'], ['tickets', 'Маршруты'], ['goals', 'Цели'], ['stations', 'Станции'], ['postcards', 'Открытки'], ['depots', 'Депо'], ['neighbors', 'Соседи'], ['terminus', 'Конечные']];
const PART_RULE = { routes: 'scoring', tickets: 'tickets', goals: 'goals', stations: 'stations', postcards: 'm-tourism', depots: 'm-depots', neighbors: 'm-neighbors', terminus: 'm-terminus' };
const PART_TIP = {
  routes: 'Начислено во время игры: очки за длину перегонов, сквозной экспресс, электрификация',
  tickets: 'Выполненные маршруты — плюс, невыполненные — минус (с учётом станций)',
  goals: 'Очки открытых целей партии', stations: '+4 за каждую неиспользованную станцию',
  postcards: 'Открытки: + цена, если сеть касается города, иначе −', depots: '+10 у кого больше всех неиспользованных депо',
  neighbors: 'Карты стран за соединение соседей', terminus: '3 очка за каждый жетон конечной станции',
};

export function showResults(G) {
  const v = G.view; const M = G.M; const res = v.result;
  if (!res) return;
  const used = PARTS.filter(([k]) => res.rows.some((r) => r.parts[k]));
  const order = res.order.map((s) => res.rows[s]);
  const table = h('table.results',
    h('tr', h('th', '№'), h('th', 'Игрок'), used.map(([k, t]) => h('th', { title: PART_TIP[k] }, t, ' ', ruleLink(PART_RULE[k], PART_TIP[k]))), h('th', 'Итого')),
    order.map((r, i) => h('tr' + (i === 0 ? '.win' : ''), h('td', i + 1), h('td', pdot(v.players[r.seat].color), ' ', r.name), used.map(([k]) => h('td', r.parts[k])), h('td.total', r.total))));
  const details = order.map((r) => h('details', h('summary', `${r.name}: маршрутов выполнено ${r.ticketsDone} из ${r.ticketRows.length}` + (r.goals.length ? `, цели: ${r.goals.map((g) => M.goals[g.id].name).join(', ')}` : '')),
    h('div.tlist', r.ticketRows.map((t) => h('div.ticket' + (t.done ? '.done' : ''), t.done ? '✓ ' : '✗ ', `${M.cities[M.tickets[t.id].from].name} — ${M.cities[M.tickets[t.id].to].name}`, r.forgiven === t.id ? ' (списан)' : '', h('span.pts', (t.done || r.forgiven === t.id ? '+' : '−') + t.points)))),
    r.postcardRows.length ? h('div.small', 'Открытки: ', r.postcardRows.map((p) => `${M.cities[M.postcards[p.id].city].name} ${p.done ? '+' : '−'}${p.points}`).join(', ')) : null,
    r.stationRoutes.routes.some(Boolean) ? h('div.small', 'Станции использовали: ', r.stationRoutes.routes.filter(Boolean).map((id) => M.routeName(M.routes[id])).join(', ')) : null));
  const w = order[0];
  const canRematch = G.ctrl.mode !== 'guest';
  modal({
    title: `Побеждает ${w.name}!`, wide: true,
    body: [table, h('p.small.muted', 'При равенстве: больше выполненных маршрутов, затем меньше станций, затем больше целей.'), ...details,
      G.ctrl.mode === 'guest' ? h('p.small.muted', 'Реванш запускает хозяин — вы попадёте в новое лобби автоматически.') : null],
    buttons: [
      { text: 'Скачать журнал (JSON)', onClick: () => downloadLog(G) },
      { text: 'На главную', onClick: (c) => { c(); G.exit(); } },
      canRematch ? { text: 'Реванш', primary: true, onClick: (c) => { c(); G.app.rematch(G); } } : { text: 'Закрыть', primary: true, onClick: (c) => c() },
    ],
  });
}

function downloadLog(G) {
  const v = G.view;
  const data = { game: 'Чыгунка', rulesVersion: v.v, date: new Date().toISOString(), config: v.cfg, seed: v.seed, players: v.players, result: v.result, events: G.ctrl.events, finalState: G.ctrl.state || null };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  a.download = `chyhunka-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
