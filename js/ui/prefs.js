// Настройки отображения (хранятся в этом браузере): анимации, подсветка ходов, звук.
import { h, modal } from './dom.js';
import { langSelect } from './lang.js';
import { getPref, setPref } from '../net/sessions.js';

const ANIM = { off: 0, fast: 300, normal: 600, slow: 1000 };
export const prefs = {
  get anim() { return getPref('anim', 'normal'); },
  get animMs() { return ANIM[this.anim] ?? 600; },
  get flashSec() { return Number(getPref('flash', '5')); },
  get sound() { return getPref('sound', '1') === '1'; },
  get flashMode() { return getPref('flashMode', 'all'); }, // all — пульс, табличка и паровозик; pulse — только пульс
};

export function settingsDialog(onChange) {
  const sel = (key, def, opts) => h('select', { onchange: (e) => { setPref(key, e.target.value); onChange?.(); } },
    opts.map(([v, t]) => h('option', { value: v, selected: getPref(key, def) === v }, t)));
  modal({
    title: 'Настройки отображения',
    body: h('div.col',
      h('label.field', h('span', 'Язык'), langSelect()),
      h('label.field', h('span', 'Анимации (карты, маршруты, станции)'), sel('anim', 'normal', [['off', 'выключены'], ['fast', 'быстрые (0,3 с)'], ['normal', 'обычные (0,6 с)'], ['slow', 'медленные (1 с)']])),
      h('label.field', h('span', 'Подсветка ходов соперников на поле'), sel('flash', '5', [['0', 'выключена'], ['3', '3 секунды'], ['5', '5 секунд'], ['8', '8 секунд'], ['12', '12 секунд']])),
      h('label.field', h('span', 'Как подсвечивать'), sel('flashMode', 'all', [['all', 'пульсация + табличка с очками + паровозик'], ['label', 'пульсация + табличка'], ['pulse', 'только пульсация']])),
      h('label.field', h('span', 'Звук «ваш ход»'), sel('sound', '1', [['1', 'включён'], ['0', 'выключен']])),
      h('p.small.muted', 'Наведите мышь на строку журнала — перегон или город подсветится на поле.')),
    buttons: [{ text: 'Готово', primary: true, onClick: (c) => c() }],
  });
}
