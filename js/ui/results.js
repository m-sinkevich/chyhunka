// Итоги партии: таблица очков по статьям, маршруты игроков, реванш, журнал.
import { h, modal } from './dom.js';
import { tr } from '../i18n.js';
import { pdot } from './cards.js';
import { playerColor } from '../net/room.js';
import { ruleLink } from './rules.js';

const PARTS = [['routes', 'Перегоны'], ['tickets', 'Маршруты'], ['goals', 'Цели'], ['stations', 'Станции'], ['postcards', 'Открытки'], ['depots', 'Депо'], ['neighbors', 'Соседи'], ['terminus', 'Конечные']];
const PART_RULE = { routes: 'scoring', tickets: 'tickets', goals: 'goals', stations: 'stations', postcards: 'm-tourism', depots: 'm-depots', neighbors: 'm-neighbors', terminus: 'm-terminus' };
const PART_TIP = {
  routes: 'Начислено во время игры: очки за длину перегонов, сквозной экспресс, электрификация',
  tickets: 'Выполненные маршруты — плюс, невыполненные — минус (с учётом станций)',
  goals: 'Очки открытых целей партии', stations: '+3 за каждую неиспользованную станцию',
  postcards: 'Открытки: + цена, если сеть касается города, иначе −', depots: '+10 у кого больше всех неиспользованных депо',
  neighbors: 'По числу стран, соединённых вашей сетью через Беларусь (на пути между странами — не меньше 2 перегонов внутри Беларуси): 2 — 12, 3 — 20, 4 — 30, 5 — 42', terminus: '3 очка за каждый жетон конечной станции',
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
    body: [table, h('p.small.muted', 'При равенстве: больше выполненных маршрутов, затем меньше станций, затем больше целей.'), scoreChart(v, M), ...details,
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

/** График: очки на треке по ходам и итог с бонусами в конце. */
/**
 * По журналу захватов — история каждого маршрута игрока:
 *   cut      — соперник занял перегон с текущего кратчайшего пути (маршрут ещё строится в разумных пределах);
 *   blocked  — без станции уже не построить (или только очень длинным обходом), но станция спасает;
 *   impossible — не построить даже со станцией разумным числом вагонов;
 *   done     — маршрут соединён своими перегонами.
 * «Разумно» — путь не длиннее max(1,5 × кратчайший на пустом поле, кратчайший + 4 вагона).
 */
function ticketTimeline(v, M) {
  const log = v.claimLog || [];
  if (!log.length) return [];
  const claims = {}; const out = [];
  const usable = (r) => !v.removed?.[r.id];
  // Дейкстра по длине пути; jump — можно взять один чужой перегон (станция). Возвращает {len, path:Set(routeId)} или null
  const shortest = (s, a, b, mode) => {
    const key = (c, j) => c + '|' + j;
    const dist = new Map([[key(a, 0), 0]]), prev = new Map(); const q = [[0, a, 0]]; const done = new Set();
    while (q.length) {
      let bi = 0; for (let i = 1; i < q.length; i++) if (q[i][0] < q[bi][0]) bi = i;
      const [d, u, j] = q.splice(bi, 1)[0]; const k = key(u, j);
      if (done.has(k)) continue; done.add(k);
      if (u === b) { const path = new Set(); let x = k; while (prev.has(x)) { const [px, rid] = prev.get(x); path.add(rid); x = px; } return { len: d, path }; }
      for (const r of M.adj[u]) {
        if (!usable(r)) continue;
        const owner = claims[r.id]; let nj = j;
        if (owner != null && owner !== s) { if (mode !== 'jump' || j) continue; nj = 1; }
        if (mode === 'own' && owner !== s) continue;
        const o = M.other(r, u), nk = key(o, nj), nd = d + r.length;
        if (nd < (dist.get(nk) ?? Infinity)) { dist.set(nk, nd); prev.set(nk, [k, r.id]); q.push([nd, o, nj]); }
      }
    }
    return null;
  };
  const tickets = v.result.rows.map((r) => r.ticketRows.map((t) => t.id));
  const base = {}; for (const ids of tickets) for (const id of ids) { const t = M.tickets[id]; base[id] = shortest(-1, t.from, t.to, 'free')?.len || 99; }
  const st = tickets.map((ids) => Object.fromEntries(ids.map((id) => [id, { status: 'ok', path: null }])));
  const limit = (id) => Math.max(base[id] * 1.5, base[id] + 4);
  const update = (s, id, i, by, rid) => {
    const x = st[s][id]; if (x.status === 'done' || x.status === 'impossible') return;
    const t = M.tickets[id];
    if (shortest(s, t.from, t.to, 'own')) { x.status = 'done'; out.push({ i, seat: s, id, kind: 'done' }); return; }
    const norm = shortest(s, t.from, t.to, 'free');
    let status = 'ok';
    if (!norm || norm.len > limit(id)) { const j = shortest(s, t.from, t.to, 'jump'); status = j && j.len <= limit(id) ? 'blocked' : 'impossible'; }
    if (status !== 'ok' && status !== x.status) out.push({ i, seat: s, id, kind: status, by });
    else if (status === 'ok' && by != null && x.path?.has(rid)) out.push({ i, seat: s, id, kind: 'cut', by });
    x.status = status === 'ok' ? 'ok' : status; x.path = norm?.path || null;
  };
  tickets.forEach((ids, s) => ids.forEach((id) => update(s, id, 0, null, null)));
  for (const [i, seat, rid] of log) {
    claims[rid] = seat;
    tickets.forEach((ids, s) => ids.forEach((id) => update(s, id, i, seat === s ? null : seat, rid)));
  }
  for (const [i, seat, gid] of v.goalLog || []) out.push({ i, seat, gid, kind: 'goal' });
  return out;
}

function scoreChart(v, M) {
  const hist = v.scoreHist || [];
  if (hist.length < 2) return null;
  const n = v.players.length, res = v.result;
  const W = 640, H = 230, L = 34, R = 92, T = 12, B = 26;
  const maxY = Math.max(...res.rows.map((r) => r.total), ...hist.flat(), 10);
  const step = Math.max(1, Math.ceil(hist.length / 120));   // не больше ~120 точек на линию
  const pts = hist.filter((_, i) => i % step === 0 || i === hist.length - 1);
  const x = (i) => L + (i / (pts.length - 1)) * (W - L - R - 40), y = (val) => T + (1 - val / maxY) * (H - T - B);
  const xEnd = W - R - 10;
  const NS = 'http://www.w3.org/2000/svg';
  const el = (t, a, p) => { const e = document.createElementNS(NS, t); for (const [k, val] of Object.entries(a)) e.setAttribute(k, val); p?.append(e); return e; };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'scorechart', role: 'img', 'aria-label': 'Очки по ходам' });
  for (let g = 0; g <= 4; g++) {
    const val = Math.round((maxY * g) / 4), yy = y(val);
    el('line', { x1: L, x2: xEnd, y1: yy, y2: yy, stroke: '#D9CFBA', 'stroke-width': 1 }, svg);
    el('text', { x: L - 6, y: yy + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#7A6C58' }, svg).textContent = val;
  }
  const rounds = Math.ceil(hist.length / n);
  for (let k = 0; k <= 4; k++) { const i = Math.round(((pts.length - 1) * k) / 4); el('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', 'font-size': 11, fill: '#7A6C58' }, svg).textContent = `${Math.round((rounds * k) / 4)}`; }
  el('text', { x: xEnd, y: H - 8, 'text-anchor': 'end', 'font-size': 11, fill: '#7A6C58' }, svg).textContent = 'итог';
  const labels = [];
  for (let s = 0; s < n; s++) {
    const col = playerColor(v.players[s].color);
    const d = pts.map((row, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(row[s]).toFixed(1)}`).join(' ');
    el('path', { d, fill: 'none', stroke: col, 'stroke-width': 2.4, 'stroke-linejoin': 'round' }, svg);
    const lx = x(pts.length - 1), ly = y(pts[pts.length - 1][s]), fy = y(res.rows[s].total);
    el('path', { d: `M${lx} ${ly} L${xEnd} ${fy}`, fill: 'none', stroke: col, 'stroke-width': 2, 'stroke-dasharray': '4 3' }, svg);   // бонусы конца партии
    el('circle', { cx: xEnd, cy: fy, r: 4.5, fill: col, stroke: '#fff', 'stroke-width': 1.5 }, svg);
    labels.push({ y: fy, text: `${res.rows[s].name} ${res.rows[s].total}`, col });
  }
  // отметки: ✓ — маршрут выполнен, ✕ — путь перекрыт (кем — в подсказке)
  const marks = ticketTimeline(v, M);
  const xh = (i) => L + (Math.min(i, hist.length - 1) / (hist.length - 1)) * (W - L - R - 40);
  for (const m of marks) {
    const i = Math.min(m.i, hist.length - 1), cx = xh(i), cy = y(hist[i][m.seat]);
    const col = playerColor(v.players[m.seat].color);
    const g = el('g', { class: 'cmark' }, svg);
    const who = res.rows[m.seat].name, by = m.by != null ? res.rows[m.by].name : '';
    let tip;
    if (m.kind === 'goal') {
      const G = M.goals[m.gid];
      el('path', { d: `M${cx} ${cy - 8} L${cx + 2.4} ${cy - 2.6} L${cx + 8} ${cy - 2.4} L${cx + 3.6} ${cy + 1.4} L${cx + 5} ${cy + 7} L${cx} ${cy + 4} L${cx - 5} ${cy + 7} L${cx - 3.6} ${cy + 1.4} L${cx - 8} ${cy - 2.4} L${cx - 2.4} ${cy - 2.6}Z`, fill: '#E8B400', stroke: '#7A5A00', 'stroke-width': 1 }, g);
      tip = `${who}: цель «${G.name}» (+${G.points})`;
    } else {
      const t = M.tickets[m.id], name = `${M.cities[t.from].name} — ${M.cities[t.to].name} (${t.points})`;
      if (m.kind === 'done') { el('circle', { cx, cy, r: 5, fill: '#fff', stroke: col, 'stroke-width': 2.4 }, g); tip = `${who}: выполнен маршрут ${name}`; }
      else if (m.kind === 'cut') { el('path', { d: `M${cx} ${cy - 6} L${cx + 6} ${cy + 5} L${cx - 6} ${cy + 5}Z`, fill: '#F2A93B', stroke: '#fff', 'stroke-width': 1 }, g); tip = `${who}: маршрут ${name} перекрыт — ${by} занял перегон с кратчайшего пути, придётся объезжать`; }
      else if (m.kind === 'blocked') { el('circle', { cx, cy, r: 6, fill: '#B3262E', stroke: '#fff', 'stroke-width': 1.2 }, g); el('path', { d: `M${cx - 2.6} ${cy - 2.6} L${cx + 2.6} ${cy + 2.6} M${cx + 2.6} ${cy - 2.6} L${cx - 2.6} ${cy + 2.6}`, stroke: '#fff', 'stroke-width': 1.6 }, g); tip = `${who}: маршрут ${name} заблокирован — без станции не построить${by ? ` (последним перекрыл ${by})` : ''}`; }
      else { el('rect', { x: cx - 5.5, y: cy - 5.5, width: 11, height: 11, fill: '#222', stroke: '#fff', 'stroke-width': 1.2 }, g); el('path', { d: `M${cx - 2.6} ${cy - 2.6} L${cx + 2.6} ${cy + 2.6} M${cx + 2.6} ${cy - 2.6} L${cx - 2.6} ${cy + 2.6}`, stroke: '#fff', 'stroke-width': 1.6 }, g); tip = `${who}: маршрут ${name} стал невозможным — не построить даже со станцией${by ? ` (последним перекрыл ${by})` : ''}`; }
    }
    el('title', {}, g).textContent = tr(tip);
  }
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
  for (const l of labels) el('text', { x: xEnd + 8, y: l.y + 4, 'font-size': 11.5, 'font-weight': 700, fill: l.col }, svg).textContent = l.text;
  const KIND = { cut: 'перекрыт', blocked: 'заблокирован', impossible: 'невозможен' };
  const rows = marks.filter((m) => KIND[m.kind]).map((m) => { const t = M.tickets[m.id]; return h('li', h('b', res.rows[m.seat].name), `: ${M.cities[t.from].name} — ${M.cities[t.to].name} ${KIND[m.kind]} на ${Math.floor(m.i / n) + 1}-м круге`, m.by != null ? [' — ', h('b', res.rows[m.by].name)] : ''); });
  const legend = h('div.chartlegend', h('span', h('i.lg.done'), 'выполнен'), h('span', h('i.lg.cut'), 'перекрыт — придётся объезжать'), h('span', h('i.lg.blocked'), 'заблокирован — спасёт только станция'), h('span', h('i.lg.imp'), 'невозможен'), h('span', h('i.lg.goal'), 'цель взята (дуэль)'));
  return h('div.chartbox', h('div.small.muted', 'Очки по кругам: сплошная линия — очки на треке во время игры, пунктир — маршруты, цели и бонусы в конце. Наведите на отметку, чтобы увидеть подробности.'), svg, legend,
    rows.length ? h('details.blockedlist', h('summary', `Перекрытые и заблокированные маршруты: ${rows.length}`), h('ul.small', rows)) : null);
}
