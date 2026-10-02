// Языки интерфейса: русский (исходный), белорусский, английский.
// Весь код пишет строки по-русски; перевод подставляется при выводе на экран (см. h() в ui/dom.js):
//   1) точное совпадение со словарём; 2) шаблон с подстановками («Ходит {0}»); 3) замена известных слов и названий внутри строки.
// Поэтому журнал ходов, который ведёт компьютер хозяина, каждый игрок видит на своём языке.
// Словарь — js/i18n/dict.js (собирается из tools/i18n_dict.json; новые строки находит tools/i18n_extract.mjs).
import { DICT } from './i18n/dict.js';

export const LANGS = { ru: 'Русский', be: 'Беларуская', en: 'English' };
const KEY = 'chyhunka.lang';
const store = typeof localStorage !== 'undefined' ? localStorage : null;
function detect() {
  try { const s = store?.getItem(KEY); if (s && LANGS[s]) return s; } catch { /* приватный режим */ }
  const n = (typeof navigator !== 'undefined' && navigator.language || 'ru').toLowerCase();
  return n.startsWith('be') ? 'be' : n.startsWith('ru') || n.startsWith('uk') || n.startsWith('kk') ? 'ru' : n.startsWith('en') ? 'en' : 'ru';
}
let lang = detect();
export const getLang = () => lang;
export function setLang(l) {
  if (!LANGS[l] || l === lang) return;
  try { store?.setItem(KEY, l); } catch { /* не сохранилось — действует до перезагрузки */ }
  lang = l;
  if (typeof location !== 'undefined') location.reload();
}

let paused = 0;
/** Выполнить без перевода (полные правила и памятка пока только на русском). */
export const noTr = (fn) => { paused++; try { return fn(); } finally { paused--; } };

const CYR = /[а-яёА-ЯЁ]/;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let exact = null, patterns = null, wordsRe = null;
const cache = new Map();
function build() {
  const i = lang === 'en' ? 0 : 1;
  exact = new Map(); patterns = [];
  for (const [k, v] of Object.entries(DICT)) {
    if (!/\{\d+\}/.test(k)) { exact.set(k, v[i]); continue; }
    const lit = k.replace(/\{\d+\}/g, '');
    if (lit.replace(/[^а-яёА-ЯЁ]/g, '').length < 2) continue;
    const order = [];
    const re = new RegExp('^' + k.split(/(\{\d+\})/).map((p) => { const m = /^\{(\d+)\}$/.exec(p); if (m) { order.push(+m[1]); return '((?:(?![.!?]\\s)[\\s\\S])*?)'; } return esc(p); }).join('') + '$');
    patterns.push({ re, order, to: v[i], w: lit.length });
  }
  patterns.sort((a, b) => b.w - a.w);
  const words = [...exact.keys()].filter((k) => k.length >= 3 && k.length <= 60).sort((a, b) => b.length - a.length);
  wordsRe = new RegExp('(?<![а-яёА-ЯЁ])(' + words.map(esc).join('|') + ')(?![а-яёА-ЯЁ])', 'g');
}
function core(s, depth) {
  const hit = exact.get(s);
  if (hit != null) return hit;
  if (depth < 3) {
    for (const p of patterns) {
      const m = p.re.exec(s);
      if (!m) continue;
      const g = {};
      p.order.forEach((n, j) => { g[n] = tr1(m[j + 1], depth + 1); });
      return p.to.replace(/\{(\d+)\}/g, (_, n) => g[n] ?? '');
    }
  }
  if (depth < 3) {   // строка склеена из нескольких предложений — переводим по частям
    const parts = s.split(/(\s+·\s+|(?<=[.!?])\s+)/);
    if (parts.length > 1) return parts.map((x) => (/^\s*·?\s*$/.test(x) ? x : core(x, depth + 1))).join('');
  }
  return s.replace(wordsRe, (w) => exact.get(w) ?? w);
}
function tr1(s, depth) {
  if (!s || !CYR.test(s)) return s;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  return m[1] + core(m[2], depth) + m[3];
}
/** Перевести строку на выбранный язык (для русского — без изменений). */
export function tr(s) {
  if (lang === 'ru' || paused || typeof s !== 'string' || !CYR.test(s)) return s;
  if (!exact) build();
  let r = cache.get(s);
  if (r === undefined) { r = tr1(s, 0); if (cache.size > 4000) cache.clear(); cache.set(s, r); }
  return r;
}
/** То же для HTML-строки: переводится только текст между тегами. */
export const trHtml = (html) => (lang === 'ru' || paused || typeof html !== 'string' ? html : html.replace(/(^|>)([^<]+)/g, (_, a, t) => a + tr(t)));
/** Перевести подписи внутри готового SVG или DOM-дерева (поле: города, легенда, реки). */
export function trDom(root) {
  if (lang === 'ru') return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
  for (const n of nodes) { const t = tr(n.nodeValue); if (t !== n.nodeValue) n.nodeValue = t; }
}
