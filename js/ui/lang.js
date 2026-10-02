// Выбор языка интерфейса (главная страница и «Настройки»). Смена языка перезагружает страницу.
import { h } from './dom.js';
import { LANGS, getLang, setLang, noTr } from '../i18n.js';

export const langSelect = () => noTr(() => h('select.langsel', { 'aria-label': 'Language / Мова / Язык', title: 'Language / Мова / Язык', onchange: (e) => setLang(e.target.value) },
  Object.entries(LANGS).map(([k, name]) => h('option', { value: k, selected: k === getLang() }, name))));
