// Мелкие помощники для DOM: создание элементов, всплывающие сообщения, модальные окна.

/** h('div.cls#id', {attr, onclick}, ...children) */
export function h(sel, attrs, ...kids) {
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) { kids.unshift(attrs); attrs = {}; }
  const m = sel.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };
/** Заменить содержимое элемента, пропуская null/false. */
export const fill = (el, ...kids) => { clear(el); append(el, kids); return el; };
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function toast(text, kind = 'info', ms = 4200) {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div#toasts'); document.body.append(box); }
  const t = h('div.toast.' + kind, text);
  box.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

/** Модальное окно. Возвращает {el, close}. opts: {title, body, buttons:[{text, primary, onClick, disabled}], wide, closable} */
/**
 * Модальное окно. dock:true — окно не закрывает поле: без затемнения, справа, поле остаётся доступным.
 * Любое окно можно перетащить за заголовок.
 */
export function modal({ title, body, buttons = [], wide = false, closable = true, onClose, cls = '', dock = false }) {
  const back = h('div.modal-back' + (dock ? '.dock' : ''));
  const box = h('div.modal' + (wide ? '.wide' : '') + (cls ? '.' + cls : ''), { role: 'dialog', 'aria-modal': 'true' });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape' && closable) close(); };
  const head = h('div.modal-head', h('span.grip', { 'aria-hidden': 'true' }, '⠿'), h('h3', title || ''), closable ? h('button.icon.close', { onclick: close, title: 'Закрыть', 'aria-label': 'Закрыть' }, '×') : null);
  const bodyEl = h('div.modal-body', body);
  const foot = h('div.modal-foot');
  const btnEls = buttons.map((b) => h('button' + (b.primary ? '.primary' : ''), { disabled: b.disabled, onclick: () => b.onClick?.(close) }, b.text));
  foot.append(...btnEls);
  box.append(head, bodyEl);
  if (buttons.length) box.append(foot);
  back.append(box);
  if (closable && !dock) back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  draggable(box, head);
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  setTimeout(() => (box.querySelector('input,button.primary') || box).focus?.(), 30);
  return { el: box, body: bodyEl, buttons: btnEls, close };
}

export function confirmBox(title, text, okText = 'Да') {
  return new Promise((res) => {
    modal({ title, body: h('p', text), buttons: [{ text: 'Отмена', onClick: (c) => { res(false); c(); } }, { text: okText, primary: true, onClick: (c) => { res(true); c(); } }], onClose: () => res(false) });
  });
}

export function copyText(text) {
  try { navigator.clipboard.writeText(text); toast('Скопировано'); } catch { prompt('Скопируйте:', text); }
}

export function plural(n, a, b, c) { const m = n % 10, t = n % 100; return m === 1 && t !== 11 ? a : m >= 2 && m <= 4 && (t < 10 || t >= 20) ? b : c; }

/** Перетаскивание окна за заголовок (мышь и палец). */
export function draggable(box, handle) {
  handle.style.cursor = 'move';
  handle.title = handle.title || 'Перетащите окно, чтобы открыть поле';
  let st = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = box.getBoundingClientRect();
    st = { x: e.clientX, y: e.clientY, l: r.left, t: r.top };
    box.style.position = 'fixed'; box.style.left = r.left + 'px'; box.style.top = r.top + 'px'; box.style.margin = '0'; box.style.right = 'auto';
    handle.setPointerCapture?.(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!st) return;
    const l = Math.min(Math.max(-box.offsetWidth + 80, st.l + e.clientX - st.x), innerWidth - 80);
    const t = Math.min(Math.max(0, st.t + e.clientY - st.y), innerHeight - 40);
    box.style.left = l + 'px'; box.style.top = t + 'px';
  });
  const end = () => { st = null; };
  handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
}
