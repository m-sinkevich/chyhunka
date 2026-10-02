// Окно «О городе»: герб, справка, достопримечательность, железнодорожный факт и игровая информация.
// Тексты — data/cities_info.json. Картинки — img/cities/<id>.jpg и img/cities/arms/<id>.png
// (скачиваются скриптом tools/fetch_city_images.py); если файла нет, показывается рисованная заглушка.
import { h, modal } from './dom.js';
import { COLOR_NAMES } from '../engine/data.js';
import { playerColor } from '../net/room.js';

const raw = (s) => document.createTextNode(s || '');   // тексты о городах пока только на русском — не переводим кусками
let INFO = null, CREDITS = null, WIKI = null;
const load = () => (INFO ? Promise.resolve() : Promise.all([
  fetch('data/cities_info.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
  fetch('img/cities/credits.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
  fetch('data/cities_wiki.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
]).then(([i, c, w]) => { INFO = i; CREDITS = c; WIKI = w; }));

export const cityPhoto = (cid) => `img/cities/${cid}.jpg`;

/** Герб; если файла нет — щит с первой буквой. */
function arms(cid, name, note) {
  const ph = h('div.arms.ph', { 'aria-hidden': 'true' }, name[0]);
  const img = h('img.arms', { src: `img/cities/arms/${cid}.png`, alt: `Герб: ${name}`, title: note ? `Герб: ${note}` : `Герб: ${name}`, onerror: () => img.replaceWith(ph) });
  return img;
}

export async function cityDialog(G, cid) {
  await load();
  const M = G.M, v = G.view, c = M.cities[cid], I = INFO[cid] || {};
  const facts = [I.year ? (/^\d+$/.test(I.year) ? `первое упоминание — ${I.year} г.` : `известен с ${I.year}`) : null, I.pop ? `население ${I.pop}` : null].filter(Boolean);
  const photo = h('figure.cphoto', h('img', { src: cityPhoto(cid), alt: I.sight || c.name, loading: 'lazy', onerror: () => photo.classList.add('none') }),
    h('figcaption', raw(I.sight)));
  // игровая информация
  const owner = (r) => (v.claims[r.id] != null ? v.players[v.claims[r.id]] : null);
  const routes = M.adj[cid].map((r) => {
    const o = owner(r);
    return h('li', `${M.cities[M.other(r, cid)].name} — ${r.length} ваг., ${COLOR_NAMES[r.color] || r.color}`,
      r.ghost ? ' · призрачная ветка' : '', r.ring ? ' · окружная' : '', r.tunnel && !r.ghost ? ' · погранпереход' : '',
      o ? h('span.small', ' — ', h('span.tokdot', { style: { background: playerColor(o.color) } }), ' ', o.name) : '');
  });
  const pc = Object.values(M.postcards).find((p) => p.city === cid);
  const myT = (v.tickets[v.me] || []).map((id) => M.tickets[id]).filter((t) => t.from === cid || t.to === cid);
  const myPc = pc && (v.postcards[v.me] || []).includes(pc.id);
  const game = h('div.cgame', h('h4', 'В игре'),
    h('ul', routes),
    pc && v.cfg.modules.tourism ? h('p.small', `✉ Открытка: ${pc.points} очк.`, myPc ? h('b', ' — у вас в руке') : '') : null,
    c.terminus && v.cfg.modules.terminus ? h('p.small', 'Конечная станция: жетон 3 очка первому, кто дотянет сюда свою сеть.') : null,
    myT.length ? h('p.small', 'Ваши маршруты сюда: ', myT.map((t) => `${M.cities[t.from].name} — ${M.cities[t.to].name} (${t.points})`).join('; ')) : null);
  const cr = CREDITS[cid] || {};
  const credit = [cr.photo && `фото: ${cr.photo.author || 'Викисклад'}${cr.photo.license ? ', ' + cr.photo.license : ''}`, cr.arms && `герб: ${cr.arms.author || 'Викисклад'}${cr.arms.license ? ', ' + cr.arms.license : ''}`].filter(Boolean).join(' · ');
  const W = WIKI[cid];
  const paras = (t) => t.split('\n').filter(Boolean).map((x) => h('p', raw(x)));
  const wiki = W && (W.history || W.intro) ? h('details.cwiki', { open: true }, h('summary', W.history ? 'История' : 'О городе подробнее'),
    paras(W.history || W.intro),
    h('p.ccredit', 'Текст: ', h('a', { href: W.url, target: '_blank', rel: 'noopener' }, `Википедия — «${W.title}»`), ', лицензия CC BY-SA 4.0')) : null;
  modal({
    title: c.name, cls: 'citydlg',
    body: h('div.cinfo',
      h('div.chead', h('div.carms', arms(cid, c.name, cr.arms?.note), cr.arms?.note ? h('div.cnote', cr.arms.note) : null), h('div', h('div.cfacts', I.region || facts.length ? raw([I.region, ...facts].filter(Boolean).join(' · ')) : (c.type === 'ext' ? 'зарубежный пункт' : '')), h('p', raw(I.about)))),
      photo,
      I.rail ? h('p.crail', h('b', 'Железная дорога. '), raw(I.rail)) : null,
      wiki,
      game,
      credit ? h('p.ccredit', credit, ' (Википедия / Викисклад)') : null),
  });
}
