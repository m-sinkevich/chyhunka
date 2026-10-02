// Отрисовка карт, маршрутов и подписей к перегонам.
import { h } from './dom.js';
import { COLOR_NAMES, COLORS } from '../engine/data.js';
import { playerColor } from '../net/room.js';

const LIGHT = new Set(['white', 'yellow', 'grey']);
const LOCO_SVG = '<svg viewBox="0 0 16 8" class="ico"><path d="M1 6.2V2.4h6.2V1h3.6v1.4H12l2.6 2.4v1.4z" fill="currentColor"/><circle cx="3.6" cy="6.8" r="1.1" fill="currentColor"/><circle cx="7.6" cy="6.8" r="1.1" fill="currentColor"/><circle cx="11.6" cy="6.8" r="1.1" fill="currentColor"/></svg>';

export function cardEl(M, c, { n, onclick, off, chosen, title } = {}) {
  const loco = c === 'loco';
  const e = h('div.card' + (loco ? '.loco' : LIGHT.has(c) ? '.light' : '.dark') + (onclick && !off ? '.pick' : '') + (off ? '.off' : '') + (chosen ? '.chosen' : ''),
    { style: loco ? {} : { background: M.colors[c] }, title: title || COLOR_NAMES[c], onclick: off ? null : onclick, role: onclick ? 'button' : null, tabindex: onclick && !off ? 0 : null },
    n != null ? h('span.n', n) : null, loco ? 'Локомотив' : COLOR_NAMES[c]);
  if (loco) e.insertAdjacentHTML('afterbegin', LOCO_SVG);
  if (onclick && !off) e.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onclick(); } });
  return e;
}
export function backEl(text, { onclick, off, title } = {}) {
  return h('div.card.back' + (onclick && !off ? '.pick' : '') + (off ? '.off' : ''), { onclick: off ? null : onclick, title, role: 'button', tabindex: 0 }, text);
}

export function chip(M, c, n) {
  const bg = c === 'loco' ? 'linear-gradient(90deg,#D7263D,#F2C230,#2E9E4F,#2F6FD6,#8E44AD)' : M.colors[c] || '#ccc';
  return h('span.chip', { style: { background: bg, color: LIGHT.has(c) ? '#2B2B2B' : '#fff' } }, `${n} × ${c === 'loco' ? 'Локомотив' : COLOR_NAMES[c]}`);
}
export function payChips(M, pay) {
  const out = [];
  if (pay.n > 0) out.push(chip(M, pay.color, pay.n));
  if (pay.loco > 0) out.push(chip(M, 'loco', pay.loco));
  return out;
}

export const pdot = (color) => h('span.dot', { style: { background: playerColor(color) } });

export function routeFeatures(M, r, v = null) {
  const cfg = v?.cfg; const narrow = v && (v.n <= 3 || cfg?.duelOn);
  const f = [];
  f.push(`${r.length} ${r.length === 1 ? 'вагон' : r.length < 5 ? 'вагона' : 'вагонов'}`);
  f.push(r.color === 'grey' ? 'серый — любой один цвет' : COLOR_NAMES[r.color]);
  if (r.electrified && !r.ghost) f.push('⚡ электрифицирован: +1 очко');
  if (r.tunnel) f.push('погранпереход: погранконтроль');
  if (r.ghost) f.push(`призрачная ветка${r.ghostType === 'fantasy' ? ' (фантазийная)' : ''}: +1 обязательный Локомотив`);
  if (r.mountain) f.push('горный: нужен хотя бы 1 Локомотив');
  if (r.double) f.push(narrow ? 'двойной: в этой партии после захвата одного ряда второй закрывается' : 'двойной перегон: один игрок может занять только один ряд');
  if (r.event && (!cfg || cfg.modules.routeCards)) f.push('«?» путевая карта: после захвата берёте карту');
  if (r.ring) f.push('окружная');
  return f;
}

export function routeTipHtml(M, v, rid) {
  const r = M.routes[rid];
  const owner = v.claims[rid];
  const pts = M.scoreFor(r.length) + (r.electrified && !r.ghost ? 1 : 0);
  let s = `<b>${M.routeName(r)}</b><br>${routeFeatures(M, r, v).join('<br>')}<br>Очки: ${pts}`;
  if (owner != null) s += `<br><i>Занят: ${escapeHtml(v.players[owner].name)}</i>`;
  if (v.removed?.[rid]) s += '<br><i>Убран (строгий исторический режим)</i>';
  if (owner == null && (v.n <= 3 || v.cfg.duelOn) && M.siblings[rid].some((x) => v.claims[x] != null)) s += '<br><i>Второй ряд закрыт — занять можно только с путевой картой «Ремонтная бригада»</i>';
  return s;
}
export function cityTipHtml(M, v, cid) {
  const c = M.cities[cid];
  let s = `<b>${escapeHtml(c.name)}</b>`;
  if (c.type === 'ext') s += `<br>зарубежный пункт (${escapeHtml(c.country || '')})`;
  if (c.terminus && v.cfg.modules.terminus) s += v.terminus?.[cid] != null ? `<br>конечная станция — жетон у игрока ${escapeHtml(v.players[v.terminus[cid]].name)}` : '<br>конечная станция: жетон 3 очка первому, кто займёт перегон сюда';
  const st = v.stationsAt?.[cid];
  if (st?.length) s += `<br>Станции: ${st.map((x) => escapeHtml(v.players[x].name)).join(', ')}`;
  if (v.depots?.[cid] != null) s += `<br>Депо: ${escapeHtml(v.players[v.depots[cid]].name)}`;
  s += '<br><span style="opacity:.7">двойной клик — о городе</span>';
  return s;
}
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function ticketEl(M, id, { done, onenter, onleave, onclick, sel, extra } = {}) {
  const t = M.tickets[id];
  const long = ['long', 'transit'].includes(t.set);
  return h('div.ticket' + (done ? '.done' : '') + (long ? '.long' : '') + (sel ? '.sel' : ''),
    { onmouseenter: onenter, onmouseleave: onleave, onclick, title: long ? 'Длинный маршрут' : '' },
    done ? '✓' : null, `${M.cities[t.from].name} — ${M.cities[t.to].name}`, extra, h('span.pts', t.points));
}
/** Мини-открытка: фото достопримечательности (img/cities/<id>.jpg), город и цена на «марке». Нет фото — бумажная заглушка. */
export function postcardEl(M, id, { done, onenter, onleave, onclick } = {}) {
  const p = M.postcards[id];
  const name = M.cities[p.city].name;
  const el = h('div.pcard' + (done ? '.done' : ''), { onmouseenter: onenter, onmouseleave: onleave, onclick, tabindex: 0,
    title: `Открытка «${name}»: ${done ? '+' : '±'}${p.points} очк. — ${done ? 'ваша сеть уже касается города' : 'дотяните сеть до города, иначе в конце −' + p.points}. Двойной клик — о городе` },
  h('img', { src: `img/cities/${p.city}.jpg`, alt: '', loading: 'lazy', onerror: (e) => { e.target.remove(); el.classList.add('noimg'); } }),
  h('span.stamp', p.points), done ? h('span.pdone', '✓') : null, h('span.pname', name));
  return el;
}
export const allColors = COLORS;
