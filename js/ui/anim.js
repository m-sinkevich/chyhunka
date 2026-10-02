// Анимации: карта летит из колоды/ряда в руку или к игроку, карты оплаты — к перегону, значки — к городу.
// Длительность берётся из настроек (prefs.animMs); 0 — анимации выключены.
import { prefs } from './prefs.js';

const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
const rectOf = (x) => (x instanceof Element ? x.getBoundingClientRect() : x && 'left' in x ? x : x ? { left: x.x - 1, top: x.y - 1, width: 2, height: 2 } : null);

/** Перелёт готового элемента node из from в to (Element | DOMRect | {x,y}). */
export function fly(node, from, to, { ms = prefs.animMs, delay = 0, scaleTo = 0.6, hold = 0, holdOffset = null } = {}) {
  const a = rectOf(from), b = rectOf(to);
  if (!ms || !a || !b) return Promise.resolve();
  const ca = center(a), cb = center(b);
  node.classList.add('flyer');
  Object.assign(node.style, { left: ca.x + 'px', top: ca.y + 'px' });
  document.body.append(node);
  const frames = [{ transform: 'translate(-50%, -50%) scale(1)', opacity: 0.2, offset: 0 }];
  if (hold) {
    const o = holdOffset || { x: -26, y: -14 };
    frames.push({ transform: `translate(calc(-50% + ${o.x}px), calc(-50% + ${o.y}px)) scale(1.08)`, opacity: 1, offset: hold / (hold + ms) });
    frames.push({ transform: `translate(calc(-50% + ${o.x}px), calc(-50% + ${o.y}px)) scale(1.08)`, opacity: 1, offset: (hold + ms * 0.15) / (hold + ms) });
  } else frames.push({ transform: 'translate(-50%, -50%) scale(1.05)', opacity: 1, offset: 0.15 });
  frames.push({ transform: `translate(calc(-50% + ${cb.x - ca.x}px), calc(-50% + ${cb.y - ca.y}px)) scale(${scaleTo})`, opacity: 0.9, offset: 1 });
  const anim = node.animate(frames, { duration: ms + hold, delay, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' });
  return anim.finished.catch(() => {}).then(() => node.remove());
}

/** Небольшая «вспышка» у элемента, куда прилетело. */
export function bump(el) {
  if (!el || !prefs.animMs) return;
  el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 350 });
}

export const animOn = () => prefs.animMs > 0;

/** Крупная карточка по центру области box: появляется, держится hold мс и улетает к элементу to. */
export function splash(node, box, to, { hold = 2600, delay = 0 } = {}) {
  const b = box?.getBoundingClientRect?.();
  if (!b) return Promise.resolve();
  node.style.cssText += `;position:fixed;left:${b.left + b.width / 2}px;top:${b.top + b.height / 2}px;z-index:900;pointer-events:none;opacity:0;transform:translate(-50%,-50%) scale(.2)`;
  return new Promise((done) => setTimeout(() => {
    document.body.append(node);
    const t = to?.getBoundingClientRect?.();
    const dx = t ? t.left + t.width / 2 - (b.left + b.width / 2) : 0, dy = t ? t.top + t.height / 2 - (b.top + b.height / 2) : 0;
    const total = 450 + hold + 550;
    const a = node.animate([
      { opacity: 0, transform: 'translate(-50%,-50%) scale(.2) rotate(-8deg)', offset: 0 },
      { opacity: 1, transform: 'translate(-50%,-50%) scale(1.08) rotate(2deg)', offset: 350 / total },
      { opacity: 1, transform: 'translate(-50%,-50%) scale(1) rotate(0)', offset: 450 / total },
      { opacity: 1, transform: 'translate(-50%,-50%) scale(1) rotate(0)', offset: (450 + hold) / total },
      { opacity: 0, transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.15)`, offset: 1 },
    ], { duration: total, easing: 'ease-out' });
    a.onfinish = () => { node.remove(); if (to instanceof Element) bump(to); done(); };
  }, delay));
}
