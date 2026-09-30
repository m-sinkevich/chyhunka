// Диалоги действий: выбор маршрутов, оплата перегона, погранконтроль, сброс, станция, смена состава и т. д.
import { h, modal, plural } from './dom.js';
import { cardEl, chip, payChips, routeFeatures, ticketEl, postcardEl, pdot } from './cards.js';
import { CARD_TYPES, COLORS, COLOR_NAMES } from '../engine/data.js';
import { claimOptionsFromView } from '../engine/viewstate.js';
import { ruleLink } from './rules.js';

/** Выбор маршрутов (старт и действие «Взять маршруты») и открыток. */
export function ticketsDialog(G, { title, offer, min, maxLong = 9, postOffer = [], postMin = 0, onDone, closable = false }) {
  const { M } = G;
  const keep = new Set(offer.filter((id) => !['long', 'transit'].includes(M.tickets[id].set)).slice(0, Math.max(min, 0)));
  const keepP = new Set(postMin ? postOffer.slice(0, postMin) : []);
  const info = h('div.small.muted');
  const list = h('div.col');
  const plist = h('div.col');
  let dlg;
  const render = () => {
    list.replaceChildren(...offer.map((id) => {
      const t = M.tickets[id];
      const cb = h('input', { type: 'checkbox', checked: keep.has(id), onchange: (e) => { e.target.checked ? keep.add(id) : keep.delete(id); render(); } });
      return h('label.row', cb, ticketEl(M, id, { onenter: () => G.highlight([t.from, t.to], true), onleave: () => G.highlight([]) }));
    }));
    plist.replaceChildren(...postOffer.map((id) => {
      const cb = h('input', { type: 'checkbox', checked: keepP.has(id), onchange: (e) => { e.target.checked ? keepP.add(id) : keepP.delete(id); render(); } });
      return h('label.row', cb, postcardEl(M, id, { onenter: () => G.highlight([M.postcards[id].city], true), onleave: () => G.highlight([]) }));
    }));
    const longs = [...keep].filter((id) => ['long', 'transit'].includes(M.tickets[id].set)).length;
    const okT = keep.size >= min && longs <= maxLong;
    const okP = keepP.size >= postMin;
    info.textContent = `Оставьте не меньше ${min} ${plural(min, 'маршрута', 'маршрутов', 'маршрутов')}` + (maxLong < 9 && offer.some((id) => ['long', 'transit'].includes(M.tickets[id].set)) ? `, длинный — не больше ${maxLong}` : '') +
      '. Невыполненный маршрут в конце вычитается. Наведите на маршрут — города подсветятся на поле.';
    if (dlg) dlg.buttons[0].disabled = !(okT && okP);
  };
  render();
  dlg = modal({ dock: true,
    title, closable, wide: false,
    body: [info, list, postOffer.length ? h('h4', 'Туристические открытки', postMin ? ` (оставьте хотя бы ${postMin})` : ' (можно не брать)') : null, postOffer.length ? h('div.small.muted', 'В конце: +цена, если ваша сеть касается города, иначе −цена.') : null, plist],
    buttons: [{ text: 'Оставить выбранные', primary: true, onClick: (close) => { close(); G.highlight([]); onDone([...keep], [...keepP]); } }],
  });
  render();
  return dlg;
}

/** Захват перегона: варианты оплаты, путевые карты, склады 1921. */
export function claimDialog(G, rid) {
  const { M } = G;
  const v = G.view;
  const r = M.routes[rid];
  const use = {};
  const raid = new Set();
  const me = v.me;
  const mine = v.routeCards[me] || [];
  const rc = [];
  const sibClaimed = M.siblings[rid].some((s) => v.claims[s] != null);
  if (mine.includes('e1') && sibClaimed) rc.push(['e1', 'Ремонтная бригада — занять второй ряд']);
  if (mine.includes('e2') && r.color !== 'grey') rc.push(['e2', 'Перекраска — оплатить как серый']);
  if (mine.includes('e5') && r.tunnel && !r.ghost) rc.push(['e5', 'Дипломатический коридор — без погранконтроля']);
  if (mine.includes('e6')) rc.push(['e6', 'Запасной локомотив — +1 Локомотив']);
  const depotCities = v.cfg.modules.depots ? [r.from, r.to].filter((c) => v.depots[c] != null) : [];
  let chosen = 0;
  const optsBox = h('div.pay-opts');
  const note = h('div.small');
  let dlg;
  const render = () => {
    const { block, options } = claimOptionsFromView(M, v, rid, use);
    chosen = Math.min(chosen, Math.max(0, options.length - 1));
    optsBox.replaceChildren(...(block ? [h('div.notice.err', block)] : options.map((p, i) => {
      const bonus = chainBonus(G, r, p);
      return h('div.pay-opt' + (i === chosen ? '.on' : ''), { onclick: () => { chosen = i; render(); } },
        h('input', { type: 'radio', name: 'pay', checked: i === chosen }), ...payChips(M, p),
        bonus > 0 ? h('span.badge.gold', { title: 'Перегон продолжает вашу цепочку прошлого хода тем же цветом' }, `сквозной экспресс +${bonus}`) : null, bonus > 0 ? ruleLink('chain') : null);
    })));
    const extra = v.flags[me]?.extraCard ? '«Выгиб рельсов»: перегон стоит на 1 карту больше. ' : '';
    note.textContent = extra + (r.tunnel && !r.ghost && !use.e5 ? `После оплаты откроются ${v.score[me] === Math.max(...v.score) && v.score.filter((x) => x === v.score[me]).length === 1 && v.cfg.leader4 ? 4 : 3} карты колоды: за каждую карту вашего цвета или Локомотив — доплата.` : '');
    if (dlg) dlg.buttons[1].disabled = Boolean(block) || !options.length;
    dlg && (dlg.opts = options);
  };
  const pts = M.scoreFor(r.length) + (r.electrified && !r.ghost ? 1 : 0);
  const body = [
    h('div.small', routeFeatures(M, r, v).join(' · ')),
    h('div.scorebox', h('div', `За ${r.length} ${plural(r.length, 'вагон', 'вагона', 'вагонов')}: `, h('b', M.scoreFor(r.length)), ' ', ruleLink('scoring', 'Таблица очков')),
      r.electrified && !r.ghost ? h('div', 'Электрификация ⚡: ', h('b', '+1'), ' ', ruleLink('electric')) : null,
      r.tunnel && !r.ghost ? h('div.small', 'Погранпереход: после оплаты — погранконтроль ', ruleLink('tunnel')) : null,
      r.ghost ? h('div.small', 'Призрачная ветка: +1 обязательный Локомотив ', ruleLink('ghost')) : null,
      r.mountain ? h('div.small', 'Горный перегон: нужен хотя бы 1 Локомотив ', ruleLink('mountain')) : null,
      h('div', 'Всего: ', h('b', pts), ' (без учёта экспресса)')),
    h('h4', 'Оплата'), optsBox, note,
    rc.length ? h('h4', 'Путевые карты') : null,
    ...rc.map(([k, label]) => h('label.row', h('input', { type: 'checkbox', onchange: (e) => { use[k] = e.target.checked; render(); } }), label)),
    depotCities.length ? h('h4', 'Склады (1921)') : null,
    ...depotCities.map((c) => {
      const o = v.depots[c];
      return h('label.row', h('input', { type: 'checkbox', disabled: v.depotsHome[me] < 1, onchange: (e) => { e.target.checked ? raid.add(c) : raid.delete(c); } }),
        `Сбросить своё депо и забрать склад игрока `, pdot(v.players[o].color), ` ${v.players[o].name} (${v.warehouseCounts[o]} карт) — депо в городе ${M.cities[c].name}`);
    }),
  ];
  dlg = modal({ dock: true, cls: 'claim',
    title: M.routeName(r), body,
    buttons: [{ text: 'Отмена', onClick: (c) => c() }, {
      text: 'Занять перегон', primary: true, onClick: (close) => {
        const p = dlg.opts[chosen];
        if (!p) return;
        close();
        const u = Object.fromEntries(Object.entries(use).filter(([, x]) => x));
        G.act({ type: 'claim', route: rid, pay: p, use: Object.keys(u).length ? u : undefined, raid: raid.size ? [...raid] : undefined });
      },
    }],
    onClose: () => { if (G.claimDlg === dlg) G.claimDlg = null; G.select(null); },
  });
  dlg.route = rid;
  G.claimDlg = dlg;
  render();
  return dlg;
}

function chainBonus(G, r, p) {
  const v = G.view; const ch = v.chain[v.me];
  if (!v.cfg.chain || !ch || !(ch.ends.includes(r.from) || ch.ends.includes(r.to))) return 0;
  const col = p.n > 0 ? p.color : null;
  if (col && ch.color && col !== ch.color) return 0;
  if (ch.len + r.length > 10) return 0;
  return G.M.scoreFor(ch.len + r.length) - G.M.scoreFor(ch.len) - G.M.scoreFor(r.length);
}

export function tunnelDialog(G) {
  const { M } = G;
  const p = G.view.pending;
  const legal = G.legal.filter((a) => a.type === 'tunnelPay' && !a.decline);
  const r = M.routes[p.route];
  return modal({ dock: true,
    title: `Погранконтроль: ${M.routeName(r)}`, closable: false,
    body: [
      h('p', 'Открыты карты колоды: ', ruleLink('tunnel', 'Погранконтроль в правилах')), h('div.market', p.revealed.map((c) => cardEl(M, c))),
      h('p', `Доплата: `, h('b', p.extra), ` ${plural(p.extra, 'карта', 'карты', 'карт')} ${p.pay.n > 0 ? `цвета «${COLOR_NAMES[p.pay.color]}» или Локомотивы` : '— Локомотивы'}.`),
      legal.length ? null : h('div.notice.err', 'Доплатить нечем — перегон не будет занят, карты вернутся в руку.'),
    ],
    buttons: [
      { text: 'Отказаться', onClick: (c) => { c(); G.act({ type: 'tunnelPay', decline: true }); } },
      ...legal.map((a) => ({ text: ['Доплатить: ', ...payChips(M, { color: p.pay.color, n: a.pay.n, loco: a.pay.loco }).map((x) => x.textContent)].join(' '), primary: true, onClick: (c) => { c(); G.act({ type: 'tunnelPay', pay: a.pay }); } })),
    ],
  });
}

/** Выбор карт из руки/сброса степперами. */
function cardPicker(M, source, { total, max, exact, types = CARD_TYPES, onChange }) {
  const pick = Object.fromEntries(types.map((c) => [c, 0]));
  const box = h('div.col');
  const sum = () => Object.values(pick).reduce((a, b) => a + b, 0);
  const render = () => {
    box.replaceChildren(...types.filter((c) => (source[c] || 0) > 0).map((c) => h('div.row',
      cardEl(M, c, { n: source[c] }),
      h('span.stepper',
        h('button.small', { disabled: pick[c] <= 0, onclick: () => { pick[c]--; render(); } }, '−'),
        h('b', pick[c]),
        h('button.small', { disabled: pick[c] >= source[c] || sum() >= max, onclick: () => { pick[c]++; render(); } }, '+')))));
    onChange?.(sum(), pick);
  };
  render();
  return { el: box, pick, sum, ok: () => (exact != null ? sum() === exact : sum() >= 1 && sum() <= max) };
}

export function discardDialog(G) {
  const { M } = G; const p = G.view.pending;
  let dlg;
  const cp = cardPicker(M, G.view.hand, { max: p.count, exact: p.count, onChange: (s) => { if (dlg) dlg.buttons[0].disabled = s !== p.count; } });
  dlg = modal({ dock: true, title: `Сбросьте ${p.count} ${plural(p.count, 'карту', 'карты', 'карт')}`, closable: false, body: [h('p', `Путевая карта ${p.reason}.`), cp.el], buttons: [{ text: 'Сбросить', primary: true, disabled: true, onClick: (c) => { c(); G.act({ type: 'discard', cards: nz(cp.pick) }); } }] });
  return dlg;
}

export function swapDialog(G) {
  const { M } = G;
  let dlg;
  const cp = cardPicker(M, G.view.hand, { max: 5, onChange: (s) => { if (dlg) dlg.buttons[1].disabled = s < 1; } });
  dlg = modal({ dock: true, title: 'Сменить состав', body: [h('p.small', 'Сбросьте от 1 до 5 карт и возьмите столько же из закрытой колоды. Это весь ваш ход.'), cp.el], buttons: [{ text: 'Отмена', onClick: (c) => c() }, { text: 'Сменить', primary: true, disabled: true, onClick: (c) => { c(); G.act({ type: 'swap', cards: nz(cp.pick) }); } }] });
}

export function fromDiscardDialog(G) {
  const { M } = G; const v = G.view;
  const need = Math.min(3, v.discardCount);
  let dlg;
  const cp = cardPicker(M, v.discardCounts, { max: need, exact: need, onChange: (s) => { if (dlg) dlg.buttons[1].disabled = s !== need; } });
  dlg = modal({ dock: true, title: '«Со склада»: карты из сброса', body: [h('p.small', `Выберите ${need} карты из сброса. Ход после этого продолжается.`), cp.el], buttons: [{ text: 'Отмена', onClick: (c) => c() }, { text: 'Взять', primary: true, disabled: true, onClick: (c) => { c(); G.act({ type: 'fromDiscard', cards: nz(cp.pick) }); } }] });
}

export function vitrinaDialog(G) {
  const { M } = G; const v = G.view;
  const need = Math.min(3, v.faceUp.length);
  const chosen = new Set();
  const row = h('div.market');
  let dlg;
  const render = () => {
    row.replaceChildren(...v.faceUp.map((c, i) => cardEl(M, c, { chosen: chosen.has(i), onclick: () => { chosen.has(i) ? chosen.delete(i) : chosen.size < need && chosen.add(i); render(); } })));
    if (dlg) dlg.buttons[1].disabled = chosen.size !== need;
  };
  render();
  dlg = modal({ dock: true, title: '«Витрина»', body: [h('p.small', `Вместо обычного набора возьмите ${need} открытые карты (Локомотивы тоже).`), row], buttons: [{ text: 'Отмена', onClick: (c) => c() }, { text: 'Взять', primary: true, disabled: true, onClick: (c) => { c(); G.act({ type: 'vitrina', picks: [...chosen] }); } }] });
  render();
}

export function stationDialog(G, city, cost) {
  const { M } = G; const hd = G.view.hand;
  const opts = [];
  if (hd.loco >= cost) opts.push({ color: null, n: 0, loco: cost });
  for (const c of COLORS) if (hd[c] > 0 && hd[c] + hd.loco >= cost) { const n = Math.min(hd[c], cost); opts.push({ color: c, n, loco: cost - n }); }
  let chosen = 0;
  const box = h('div.pay-opts');
  const render = () => box.replaceChildren(...(opts.length ? opts.map((p, i) => h('div.pay-opt' + (i === chosen ? '.on' : ''), { onclick: () => { chosen = i; render(); } }, h('input', { type: 'radio', checked: i === chosen }), ...payChips(M, p))) : [h('div.notice.err', `Нужно ${cost} карт(ы) одного цвета`)]));
  render();
  modal({ dock: true,
    title: `Станция: ${M.cities[city].name}`,
    body: [h('p.small', `Станция № ${G.view.cfg.stations - G.view.stationsLeft[G.view.me] + 1} стоит ${cost} ${plural(cost, 'карту', 'карты', 'карт')} одного цвета. В конце партии она позволит использовать для ваших маршрутов один чужой перегон из этого города. Неиспользованная станция — +4 очка.`), box],
    buttons: [{ text: 'Отмена', onClick: (c) => c() }, { text: 'Поставить', primary: true, disabled: !opts.length, onClick: (c) => { c(); G.act({ type: 'station', city, pay: opts[chosen] }); } }],
  });
}

export function helpDialog() {
  const li = (t) => h('li', t);
  modal({
    title: 'Памятка', wide: true,
    body: [
      h('p', 'В свой ход — одно действие:'),
      h('ol', li('Взять 2 карты (открытый Локомотив — только одной картой).'), li('Занять перегон: карты одного цвета по его длине; серый — любой один цвет; Локомотив заменяет любую карту.'), li('Взять 3 маршрута и оставить хотя бы один.'), li('Поставить станцию (1, 2, 3 карты одного цвета).'), li('Сменить состав: сбросить 1–5 карт и взять столько же из колоды.')),
      h('p', h('b', 'Очки за перегон: '), '1 — 1, 2 — 2, 3 — 4, 4 — 7, 5 — 10, 6 — 15; ⚡ электрификация +1.'),
      h('p', h('b', 'Сквозной экспресс: '), 'занимаете перегоны подряд идущими ходами, продолжая предыдущий и платя тем же цветом — цепочка считается одним перегоном (7 ваг. — 18, 8 — 21, 9 — 24, 10 — 27). Любой ход без захвата обрывает цепочку.'),
      h('p', h('b', 'Погранпереход: '), 'после оплаты открываются 3 карты колоды (4, если вы единоличный лидер); за каждую карту вашего цвета или Локомотив — доплата. Можно отказаться.'),
      h('p', h('b', 'Призрачная ветка: '), 'длина + 1 обязательный Локомотив, без погранконтроля и электрификации. ', h('b', 'Горный перегон: '), 'нужен хотя бы 1 Локомотив.'),
      h('p', h('b', 'Двойные перегоны: '), 'при 2–3 игроках второй ряд закрывается; при 4–5 оба открыты, но не для одного игрока. В Минске до 3 станций разных игроков (в дуэли — 1).'),
      h('p', h('b', 'Конец: '), 'когда у кого-то осталось 2 вагона или меньше, каждый делает ещё один ход. Затем: маршруты ±, цели, неиспользованные станции +4, модули.'),
      h('p', h('b', 'Цели: '), 'в партии 3 цели, 2 открыты сразу, третья — когда у кого-то останется 15 вагонов. В дуэли цели — гонка: кто первый выполнил, тот и получил.'),
    ],
    buttons: [{ text: 'Полные правила', onClick: (c) => { c(); import('./rules.js').then((r) => r.showRules()); } }, { text: 'Понятно', primary: true, onClick: (c) => c() }],
  });
}

export function phrasesDialog(G) {
  const P = ['Хороший ход!', 'Сейчас вернусь', 'Думаю…', 'Ой!', 'Спасибо за игру!', 'Ещё партию?', 'Ну держись!', 'Удачи всем'];
  modal({ title: 'Короткая фраза', body: h('div.phrases', P.map((t) => h('button', { onclick: (e) => { G.ctrl.say?.(t); e.target.closest('.modal-back').remove(); } }, t))) });
}

const nz = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v > 0));
export { chip };
