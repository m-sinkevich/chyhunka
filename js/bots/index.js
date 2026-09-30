// Боты работают в браузере хозяина. Интерфейс: chooseAction(E, view, legal, rng) → действие.
import { easyMove } from './easy.js';
import { mediumMove } from './medium.js';
import { mainlineMove } from './mainline.js';

export const BOTS = {
  easy: { name: 'Лёгкий', move: easyMove },
  medium: { name: 'Средний', move: mediumMove },
  mainline: { name: 'Магистральщик', move: mainlineMove },
};

/** Ход бота с защитой: если бот ошибся, берётся простое допустимое действие. */
export function botAction(E, st, seat, level, rng) {
  const legal = E.legal(st, seat);
  if (!legal.length) return null;
  const v = E.view(st, seat);
  const t0 = Date.now();
  let a = null;
  try { a = (BOTS[level] || BOTS.medium).move(E, v, legal, rng); } catch (e) { console.warn('бот ошибся', e); }
  const ms = Date.now() - t0;
  if (ms > 300) console.warn(`бот думал ${ms} мс`);
  if (!a || a.template) a = fallback(legal, seat);
  return { ...a, seat };
}

export function fallback(legal, seat) {
  const plain = legal.filter((a) => !a.template);
  const draw = plain.find((a) => a.type === 'draw' && a.source === 'deck' && (a.wh == null || a.wh === seat));
  return draw || plain.find((a) => a.type === 'draw') || plain.find((a) => a.type === 'claim') || plain.find((a) => a.type === 'tickets') || plain[0] || null;
}
