// Настройки партии: наборы маршрутов, модули, цели, дуэль. Общая форма для лобби и игры с ботами.
import { h, fill, modal } from './dom.js';
import { TICKET_SETS, MODULES, PRESETS } from '../engine/index.js';

export const DEFAULT_CFG = { tickets: 'base', goals: 'random', modules: { routeCards: true, terminus: true }, trains: 45, chain: true, strictHistorical: false, quick: false, fairDeal: true, duel: 'auto', randomOrder: true, turnTimer: 0 };

export function settingsForm(M, cfgIn, { editable = true, players = 2, onChange, online = true } = {}) {
  const cfg = JSON.parse(JSON.stringify({ ...DEFAULT_CFG, ...cfgIn, modules: { ...DEFAULT_CFG.modules, ...(cfgIn?.modules || {}) } }));
  const box = h('div.col');
  const set = (patch) => { Object.assign(cfg, patch); onChange?.(cfg); render(); };
  const dis = !editable;
  const render = () => {
    const goalMode = Array.isArray(cfg.goals) ? 'pick' : cfg.goals;
    const presetOn = (p) => {
      const c = PRESETS[p].cfg;
      return c.tickets === cfg.tickets && Object.keys(MODULES).every((k) => Boolean(c.modules[k]) === Boolean(cfg.modules[k]));
    };
    fill(box,
      h('div.presets', Object.entries(PRESETS).filter(([k]) => k !== 'duel' || players === 2).map(([k, p]) => h('button.small' + (presetOn(k) ? '.on' : ''), { disabled: dis, onclick: () => set({ ...JSON.parse(JSON.stringify(p.cfg)), duel: k === 'duel' ? 'auto' : cfg.duel }) }, p.name))),
      h('div.frow',
        h('label.field.grow', h('span', 'Набор маршрутов'), h('select', { disabled: dis, onchange: (e) => set({ tickets: e.target.value }) },
          Object.entries(TICKET_SETS).map(([k, t]) => h('option', { value: k, selected: cfg.tickets === k }, `${t} — ${SET_SHORT[k]}`)))),
        h('button.small', { type: 'button', onclick: () => setsDialog(M, cfg.tickets), title: 'Чем отличаются наборы маршрутов' }, 'Сравнить наборы')),
      h('div.small.muted.setabout', SET_INFO[cfg.tickets]?.about || ''),
      h('div.opts', h('span.small.muted', 'Модули'), Object.entries(MODULES).map(([k, m]) => h('label.opt',
        h('input', { type: 'checkbox', disabled: dis, checked: Boolean(cfg.modules[k]), onchange: (e) => {
          const modules = { ...cfg.modules, [k]: e.target.checked };
          const patch = { modules };
          if (k === 'tourism' && !e.target.checked && Array.isArray(cfg.goals) && cfg.goals.includes('g_tourist')) patch.goals = 'random';
          set(patch);
        } }),
        h('span', m.name, h('small', m.hint))))),
      h('label.field', h('span', 'Цели'), h('select', { disabled: dis, onchange: (e) => set({ goals: e.target.value === 'pick' ? pickDefault(M, cfg) : e.target.value }) },
        h('option', { value: 'random', selected: goalMode === 'random' }, '3 случайные из 9 (2 сразу, третья позже)'),
        h('option', { value: 'pick', selected: goalMode === 'pick' }, 'Выбрать 3 цели'),
        h('option', { value: 'off', selected: goalMode === 'off' }, 'Без целей'))),
      goalMode === 'pick' ? h('div.opts', M.map.goals.map((g) => {
        const off = (g.requires && !cfg.modules[g.requires]) || (g.id === 'g_ring' && players === 2 && cfg.duel !== 'off');
        const on = cfg.goals.includes(g.id);
        return h('label.opt', h('input', { type: 'checkbox', disabled: dis || off || (!on && cfg.goals.length >= 3), checked: on, onchange: (e) => {
          const goals = e.target.checked ? [...cfg.goals, g.id] : cfg.goals.filter((x) => x !== g.id);
          set({ goals });
        } }), h('span', `${g.name} · ${g.points}`, h('small', g.rule + (off ? (g.id === 'g_ring' ? ' (в дуэли окружная закрыта)' : ' (нужен модуль «Туризм»)') : ''))));
      }), Array.isArray(cfg.goals) && cfg.goals.length !== 3 ? h('div.small', { style: { color: 'var(--acc)' } }, `Выбрано ${cfg.goals.length} из 3`) : null) : null,
      h('div.row',
        (() => { const duelNow = players === 2 && cfg.duel !== 'off'; const shown = cfg.quick ? 30 : duelNow ? Math.min(cfg.trains, 40) : cfg.trains;
          return h('label.field', { title: duelNow ? 'В дуэли — не больше 40 вагонов' : cfg.quick ? 'В быстрой партии — 30 вагонов' : null }, h('span', 'Вагонов у игрока'), h('select', { disabled: dis || cfg.quick, onchange: (e) => set({ trains: Number(e.target.value) }) },
            [30, 35, 40, 45].filter((n) => (n === 30 ? cfg.quick : !duelNow || n <= 40)).map((n) => h('option', { value: n, selected: shown === n }, n)))); })(),
        h('label.field', h('span', 'Порядок хода'), h('select', { disabled: dis, onchange: (e) => set({ randomOrder: e.target.value === '1' }) }, h('option', { value: '1', selected: cfg.randomOrder }, 'случайный'), h('option', { value: '0', selected: !cfg.randomOrder }, 'по местам'))),
        online && h('label.field', h('span', 'Таймер хода'), h('select', { disabled: dis, onchange: (e) => set({ turnTimer: Number(e.target.value) }) }, [0, 1, 2, 3, 5].map((n) => h('option', { value: n, selected: cfg.turnTimer === n }, n ? `${n} мин` : 'выключен'))))),
      h('div.opts',
        h('label.opt', h('input', { type: 'checkbox', disabled: dis, checked: cfg.chain, onchange: (e) => set({ chain: e.target.checked }) }), h('span', 'Сквозной экспресс', h('small', 'Перегоны подряд идущими ходами одним цветом считаются одной цепочкой (до 10 вагонов).'))),
        h('label.opt', h('input', { type: 'checkbox', disabled: dis, checked: cfg.strictHistorical, onchange: (e) => set({ strictHistorical: e.target.checked }) }), h('span', 'Строгий исторический режим', h('small', 'Без фантазийных веток: Лепель — Борисов, Хойники — Чернигов, Горки — Могилёв.'))),
        players === 2 && h('label.opt', h('input', { type: 'checkbox', disabled: dis, checked: cfg.duel !== 'off', onchange: (e) => set({ duel: e.target.checked ? 'auto' : 'off' }) }), h('span', 'Дуэльные правила для двоих', h('small', 'Открытый ряд из 4 маршрутов, Минск — одна станция, один невыполненный маршрут не вычитается, цели — гонка. 40 вагонов, окружная закрыта, на старте без длинных маршрутов.'))),
        h('label.opt', h('input', { type: 'checkbox', disabled: dis, checked: cfg.fairDeal !== false, onchange: (e) => set({ fairDeal: e.target.checked }) }), h('span', 'Честная раздача маршрутов', h('small', 'Стартовые маршруты подбираются так, чтобы сумма очков у всех была примерно равной (±10%).'))),
        h('label.opt', h('input', { type: 'checkbox', disabled: dis, checked: cfg.quick, onchange: (e) => set({ quick: e.target.checked }) }), h('span', 'Быстрая партия', h('small', '30 вагонов, 2 станции, на старте 3 обычных маршрута без длинного.')))),
      h('div.summary', summary(cfg, players)),
    );
  };
  render();
  box.getConfig = () => cfg;
  box.valid = () => !(Array.isArray(cfg.goals) && cfg.goals.length !== 3);
  return box;
}

function pickDefault(M, cfg) {
  return M.map.goals.filter((g) => !g.requires || cfg.modules[g.requires]).slice(0, 3).map((g) => g.id);
}

export function summary(cfg, n) {
  const mods = Object.entries(MODULES).filter(([k]) => cfg.modules?.[k]).map(([, m]) => m.name);
  const trains = cfg.quick ? 30 : cfg.trains;
  const stations = cfg.quick ? 2 : 3;
  const duel = n === 2 && cfg.duel !== 'off';
  return `${n} ${n < 5 ? 'игрока' : 'игроков'}: по ${duel ? Math.min(trains, 40) : trains} вагонов и ${stations} станции; ${duel ? 'оба получают по 5 карт' : 'первый игрок получает 4 карты, остальные — по 5'}. ` +
    `Маршруты: «${TICKET_SETS[cfg.tickets]}». Модули: ${mods.length ? mods.join(', ') : 'нет'}. ` +
    (cfg.goals === 'off' ? 'Без целей. ' : 'Цели: 3 (две открыты сразу). ') + (duel ? 'Дуэльные правила включены.' : '');
}

// ---------- сравнение наборов маршрутов ----------
const SET_SHORT = { base: 'классика, для первых партий', extended: 'больше маршрутов, к малым городам и границе', bigcities: 'только крупные узлы, дорогие маршруты', mega: 'всё сразу, самая длинная партия' };
const SET_INFO = {
  base: { decks: ['base'], longs: ['long'], start: '3 обычных + 1 длинный, оставить не меньше 2 (длинный — не больше 1)', about: 'Классика для первых партий: короткие и средние маршруты между городами, у каждого один длинный маршрут через всю страну.' },
  extended: { decks: ['base', 'extended'], longs: ['long'], start: '3 обычных + 1 длинный, оставить не меньше 2', about: 'Базовый набор плюс маршруты к малым городам, озёрам и границе. Карта используется шире, маршрутов в колоде больше — можно чаще добирать.' },
  bigcities: { decks: ['bigcities'], longs: [], start: '4 маршрута между крупными городами, оставить не меньше 2; длинных нет', about: 'Только крупные узлы: дорогие маршруты, острая борьба за центр и магистрали. При 4–5 игроках добавляются маршруты расширенного набора, иначе на всех не хватит.' },
  mega: { decks: ['base', 'extended', 'bigcities'], longs: ['long', 'transit'], start: '3 обычных + 2 длинных или транзитных', about: 'Всё сразу: все маршруты и транзитные через всю страну. Самая длинная и рискованная партия.' },
};
export function setsDialog(M, current) {
  const T = M.map.tickets;
  const stat = (sets) => { const p = T.filter((t) => sets.includes(t.set)).map((t) => t.points); return p.length ? { n: p.length, min: Math.min(...p), max: Math.max(...p), avg: (p.reduce((a, b) => a + b, 0) / p.length).toFixed(1) } : null; };
  const list = (sets) => T.filter((t) => sets.includes(t.set)).sort((a, b) => b.points - a.points)
    .map((t) => h('span.tk', `${M.cities[t.from].name} — ${M.cities[t.to].name} `, h('b', t.points)));
  const head = ['', ...Object.keys(SET_INFO).map((k) => h('span' + (k === current ? '.cur' : ''), TICKET_SETS[k]))];
  const row = (label, f) => h('tr', h('th', label), Object.entries(SET_INFO).map(([k, x]) => h('td' + (k === current ? '.cur' : ''), f(x, k))));
  modal({
    title: 'Наборы маршрутов', wide: true, cls: 'setsdlg',
    body: h('div',
      h('table.rtable.setstable', h('tr', head.map((x) => h('th', x))),
        row('Суть', (x) => x.about),
        row('Обычные маршруты', (x) => { const s = stat(x.decks); return `${s.n} шт., ${s.min}–${s.max} очк. (в среднем ${s.avg})`; }),
        row('Длинные', (x) => { const s = stat(x.longs); return s ? `${s.n} шт., ${s.min}–${s.max} очк.` : 'нет'; }),
        row('На старте', (x) => x.start)),
      Object.entries(SET_INFO).map(([k, x]) => h('details.setlist', { open: k === current }, h('summary', `${TICKET_SETS[k]}: все маршруты`),
        h('div.tks', list(x.decks)), x.longs.length ? [h('div.small.muted', 'Длинные и транзитные:'), h('div.tks', list(x.longs))] : null))),
    buttons: [{ text: 'Закрыть', primary: true, onClick: (c) => c() }],
  });
}
