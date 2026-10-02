// Игровое поле: то же SVG, что и печатная версия, плюс слой с поездами игроков, станциями, депо и треком очков.
// Масштаб колёсиком/щипком, перетаскивание, клик по перегону или городу.
import { tr, trHtml, trDom } from '../i18n.js';
import { playerColor } from '../net/room.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
};

export class Board {
  constructor(container, svgText, layout, M, handlers = {}) {
    this.c = container; this.L = layout; this.M = M; this.on = handlers;
    container.innerHTML = svgText;
    trDom(container);
    const svg = (this.svg = container.querySelector('svg'));
    svg.removeAttribute('width'); svg.removeAttribute('height');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const [W, H] = layout.size;
    this.full = [0, 0, W, H];
    this.vb = [...this.full];
    this.root = svg.querySelector(':scope > g');
    this.routeEls = {};
    for (const g of svg.querySelectorAll('g[data-r]')) this.routeEls[g.dataset.r] = g;
    this.trackEls = {};
    for (const t of svg.querySelectorAll('[data-t]')) this.trackEls[t.dataset.t] = t;
    this.gClaims = el('g', { 'pointer-events': 'none' }, this.root);
    this.gHl = el('g', { 'pointer-events': 'none' }, this.root);
    this.gHits = el('g', {}, this.root);
    this.gMarks = el('g', { 'pointer-events': 'none' }, this.root); // значки над зонами городов: у них свои подсказки
    this.gScore = el('g', { 'pointer-events': 'none' }, this.root);
    this.gFx = el('g', { 'pointer-events': 'none' }, this.root);
    for (const [id, [x, y, r]] of Object.entries(layout.cities)) {
      el('circle', { cx: x, cy: y, r: Math.max(r + 2.5, 8), class: 'hitc', 'data-c': id }, this.gHits);
    }
    this.tip = document.createElement('div');
    this.tip.className = 'tip hidden';
    container.append(this.tip);
    this.bindInput();
    this.apply();
    if (typeof ResizeObserver !== 'undefined') { this.ro = new ResizeObserver(() => this.apply()); this.ro.observe(svg); }
  }

  // ---------- масштаб и перемещение ----------
  apply() {
    // вид всегда в пропорциях окна; отдалять не дальше «всё поле целиком», поле не уводить за край
    const [fx, fy, fw, fh] = this.full;
    const r = this.svg.getBoundingClientRect();
    const ca = r.width > 0 && r.height > 0 ? r.width / r.height : fw / fh;
    let [x, y, w, hh] = this.vb;
    const cx = x + w / 2, cy = y + hh / 2;
    w = Math.max(w, hh * ca); // вписать текущий вид в пропорции окна
    w = Math.min(w, Math.max(fw, fh * ca)); hh = w / ca;
    x = cx - w / 2; y = cy - hh / 2;
    x = w >= fw ? fx + (fw - w) / 2 : Math.min(Math.max(x, fx), fx + fw - w);
    y = hh >= fh ? fy + (fh - hh) / 2 : Math.min(Math.max(y, fy), fy + fh - hh);
    this.vb = [x, y, w, hh];
    this.svg.setAttribute('viewBox', this.vb.map((v) => v.toFixed(2)).join(' '));
  }
  toSvg(cx, cy) {
    const pt = this.svg.createSVGPoint(); pt.x = cx; pt.y = cy;
    const m = this.svg.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
  }
  zoomAt(f, cx, cy) {
    const [x, y, w, h] = this.vb;
    const nw = Math.min(this.full[2] * 3, Math.max(this.full[2] / 9, w / f));
    const k = nw / w;
    const p = cx == null ? { x: x + w / 2, y: y + h / 2 } : this.toSvg(cx, cy);
    this.vb = [p.x - (p.x - x) * k, p.y - (p.y - y) * k, w * k, h * k];
    this.apply();
  }
  fit() { this.vb = [...this.full]; this.apply(); }
  focus(cityIds) {
    const pts = cityIds.map((c) => this.L.cities[c]).filter(Boolean);
    if (!pts.length) return;
    const [ox, oy] = this.L.offset;
    const xs = pts.map((p) => p[0] + ox), ys = pts.map((p) => p[1] + oy);
    const pad = 80;
    let w = Math.max(...xs) - Math.min(...xs) + pad * 2, h = Math.max(...ys) - Math.min(...ys) + pad * 2;
    const ar = this.full[2] / this.full[3];
    if (w / h < ar) w = h * ar; else h = w / ar;
    if (w < this.full[2] / 3.5) { w = this.full[2] / 3.5; h = w / ar; }
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    this.vb = [cx - w / 2, cy - h / 2, w, h];
    this.apply();
  }
  bindInput() {
    const svg = this.svg;
    const ptrs = new Map();
    let drag = null, pinch = null;
    svg.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX, e.clientY); }, { passive: false });
    svg.addEventListener('pointerdown', (e) => {
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      svg.setPointerCapture?.(e.pointerId);
      if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, vb: [...this.vb], moved: false, target: e.target };
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; drag = null; }
    });
    svg.addEventListener('pointermove', (e) => {
      if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoomAt(d / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinch.d = d;
        return;
      }
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 5) { drag.moved = true; svg.classList.add('dragging'); this.hideTip(); }
        if (drag.moved) {
          const r = svg.getBoundingClientRect();
          const k = Math.max(drag.vb[2] / r.width, drag.vb[3] / r.height);
          this.vb = [drag.vb[0] - dx * k, drag.vb[1] - dy * k, drag.vb[2], drag.vb[3]];
          this.apply();
        }
        return;
      }
      this.hover(e);
    });
    const up = (e) => {
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (drag && !drag.moved && e.type === 'pointerup') this.click(drag.target);
      drag = null; svg.classList.remove('dragging');
    };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    svg.addEventListener('pointerleave', () => this.hideTip());
  }
  click(target) {
    const c = target.closest?.('[data-c]');
    if (c) return this.on.city?.(c.dataset.c);
    const r = target.closest?.('[data-r]');
    if (r) return this.on.route?.(r.dataset.r);
  }
  hover(e) {
    const t = e.target;
    const r = t.closest?.('[data-r]'), c = t.closest?.('[data-c]');
    const m = t.closest?.('[data-tip]');
    const text = m ? m.dataset.tip : r ? this.on.routeTip?.(r.dataset.r) : c ? this.on.cityTip?.(c.dataset.c) : null;
    if (!text) return this.hideTip();
    this.tip.innerHTML = trHtml(text);
    this.tip.classList.remove('hidden');
    const box = this.c.getBoundingClientRect();
    let x = e.clientX - box.left + 14, y = e.clientY - box.top + 14;
    if (x + 290 > box.width) x -= 300;
    this.tip.style.left = x + 'px'; this.tip.style.top = y + 'px';
  }
  hideTip() { this.tip.classList.add('hidden'); }

  // ---------- состояние партии на поле ----------
  update(v, { can = new Set(), sel = null, hl = [], pickCities = null, stationRoutes = [] } = {}) {
    const { M, L } = this;
    const col = (s) => playerColor(v.players[s].color);
    const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const pname = (s) => `<span style="color:${col(s)}">●</span> ${esc(v.players[s].name)}${s === v.me ? ' (вы)' : ''}`;
    if (!this.modesApplied) { this.modesApplied = true; this.applyModes(v.cfg); }
    for (const [rid, g] of Object.entries(this.routeEls)) {
      g.classList.toggle('can', can.has(rid));
      g.classList.toggle('sel', rid === sel);
      g.classList.toggle('removed', Boolean(v.removed && v.removed[rid]));
      g.classList.toggle('claimed', v.claims[rid] != null);
      // при 2–3 игроках и в дуэли второй ряд двойного перегона закрывается — убираем его с поля
      const closed = (v.n <= 3 || v.cfg.duelOn) && v.claims[rid] == null && M.siblings[rid].some((x) => v.claims[x] != null);
      // с путевой картой «Ремонтная бригада» закрытый второй ряд можно занять — тогда он виден и доступен
      const repair = closed && v.me >= 0 && (v.routeCards?.[v.me] || []).includes('e1');
      g.classList.toggle('closedlane', closed && !repair);
      g.classList.toggle('repairlane', repair);
      this.trackEls[rid]?.classList.toggle('closedlane', closed && !repair);
    }
    // поезда игроков
    this.gClaims.replaceChildren();
    for (const [rid, s] of Object.entries(v.claims)) {
      const cars = L.routes[rid];
      if (!cars) continue;
      const [cl, cw] = L.car;
      cars.forEach(([x, y, a], i) => {
        const t = `rotate(${a} ${x} ${y})`;
        const g = el('g', { transform: t }, this.gClaims);
        // «пластиковый вагончик» игрока: тень, корпус его цвета, светлая крыша и окна
        el('rect', { x: x - cl / 2 - 1.2, y: y - cw / 2 - 1.2, width: cl + 2.4, height: cw + 2.4, rx: 2.6, fill: '#fff', opacity: 0.9 }, g);
        el('rect', { x: x - cl / 2 + 0.2, y: y - cw / 2 + 1.1, width: cl - 0.4, height: cw - 0.4, rx: 1.8, fill: '#000', opacity: 0.35 }, g);
        el('rect', { x: x - cl / 2 + 0.3, y: y - cw / 2 + 0.3, width: cl - 0.6, height: cw - 0.6, rx: 1.8, fill: col(s), stroke: '#111', 'stroke-width': 0.9 }, g);
        el('rect', { x: x - cl / 2 + 1.6, y: y - cw / 2 + 1.2, width: cl - 3.2, height: 1.3, rx: 0.6, fill: '#fff', opacity: 0.35 }, g);
        for (let k = 0; k < 4; k++) el('rect', { x: x - cl / 2 + 3.2 + k * 4.9, y: y - 0.6, width: 3.2, height: 2.4, rx: 0.4, fill: '#fff', opacity: 0.8 }, g);
        void i;
      });
    }
    // станции, депо, жетоны конечных станций — в свободных местах у города, не поверх вагонов и подписей
    this.gMarks.replaceChildren();
    this.slotsUsed = {};
    for (const [city, seats] of Object.entries(v.stationsAt || {})) {
      seats.forEach((s) => {
        const [cx, cy] = this.spot(city, 10, 13);
        const g = el('g', { transform: `translate(${cx - 4.5} ${cy - 6})`, class: 'mark', 'data-tip': `<b>Станция</b> · ${pname(s)}<br>${M.cities[city].name}. В конце партии позволяет использовать один чужой перегон из этого города. Неиспользованная станция — +4 очка.` }, this.gMarks);
        el('path', { d: 'M0 5.5 L4.5 1 L9 5.5 V12 H0Z', fill: col(s), stroke: '#fff', 'stroke-width': 1 }, g);
        el('path', { d: 'M0 5.5 L4.5 1 L9 5.5 V12 H0Z', fill: 'none', stroke: '#2b2b2b', 'stroke-width': 0.45 }, g);
      });
    }
    for (const [city, s] of Object.entries(v.depots || {})) {
      const [cx, cy] = this.spot(city, 10, 10);
      const g = el('g', { transform: `translate(${cx - 4.5} ${cy - 4.5})`, class: 'mark', 'data-tip': `<b>Депо</b> · ${pname(s)}<br>${M.cities[city].name}` }, this.gMarks);
      el('rect', { width: 9, height: 9, rx: 1, fill: col(s), stroke: '#fff', 'stroke-width': 0.9 }, g);
      const t = el('text', { x: 4.5, y: 6.8, 'text-anchor': 'middle', 'font-size': 6.4, 'font-weight': 700, fill: '#111', 'font-family': 'PT Sans, Arial' }, g);
      t.textContent = tr('Д');
    }
    for (const [city, s] of Object.entries(v.terminus || {})) {
      if (s == null) continue;
      const [cx, cy] = this.spot(city, 9, 9);
      el('circle', { cx, cy, r: 3.8, fill: col(s), stroke: '#fff', 'stroke-width': 1, class: 'mark', 'data-tip': `<b>Жетон конечной станции</b> · ${pname(s)}<br>«${M.cities[city].name}» — +3 очка в конце партии. Достаётся первому, кто проложил перегон в эту станцию.` }, this.gMarks);
    }
    // перегоны, которые «берут» станции (для своих станций — текущий лучший выбор; в конце — у всех)
    for (const { route, seat } of stationRoutes) {
      const cars = L.routes[route];
      if (!cars) continue;
      const [cl, cw] = L.car;
      const g = el('g', { class: 'st-borrow' }, this.gMarks);
      for (const [x, y, a] of cars) el('rect', { x: x - cl / 2 - 2, y: y - cw / 2 - 2, width: cl + 4, height: cw + 4, rx: 3, fill: 'none', stroke: col(seat), 'stroke-width': 1.8, 'stroke-dasharray': '3 2', transform: `rotate(${a} ${x} ${y})` }, g);
    }
    // подсветка городов маршрута и выбор города
    this.gHl.replaceChildren();
    const hp = hl.map((c) => L.cities[c]).filter(Boolean);
    if (hp.length === 2) {
      el('line', { x1: hp[0][0], y1: hp[0][1], x2: hp[1][0], y2: hp[1][1], class: 'hl-line-under' }, this.gHl);
      el('line', { x1: hp[0][0], y1: hp[0][1], x2: hp[1][0], y2: hp[1][1], class: 'hl-line' }, this.gHl);
    }
    for (const p of hp) {
      el('circle', { cx: p[0], cy: p[1], r: p[2] + 4.5, class: 'hl-under' }, this.gHl);
      el('circle', { cx: p[0], cy: p[1], r: p[2] + 5, class: 'hl-glow' }, this.gHl);
      el('circle', { cx: p[0], cy: p[1], r: p[2] + 4.5, class: 'hl' }, this.gHl);
      el('circle', { cx: p[0], cy: p[1], r: p[2] + 4.5, class: 'hl-wave' }, this.gHl);
    }
    for (const hc of this.gHits.children) hc.classList.toggle('pickable', Boolean(pickCities && pickCities.has(hc.dataset.c)));
    // фишки на треке очков
    this.gScore.replaceChildren();
    const byCell = {};
    v.score.forEach((sc, s) => { const i = ((sc % 100) + 100) % 100; (byCell[i] ||= []).push(s); });
    for (const [i, seats] of Object.entries(byCell)) {
      const cell = L.track[i];
      if (!cell) continue;
      const [x, y, w, h] = cell;
      seats.forEach((s, k) => {
        const cx = x + w * (0.28 + 0.44 * (k % 2)), cy = y + h * (0.22 + 0.28 * Math.floor(k / 2));
        el('circle', { cx, cy, r: Math.min(w, h) * 0.2, fill: col(s), stroke: '#fff', 'stroke-width': 0.8 }, this.gScore);
        if (v.score[s] >= 100) { const t = el('text', { x: cx, y: cy + 1.4, 'text-anchor': 'middle', 'font-size': 3.6, fill: '#fff', 'font-weight': 700 }, this.gScore); t.textContent = '+' + Math.floor(v.score[s] / 100) * 100; }
      });
    }
  }

  // ---------- подсветка ходов ----------
  /**
   * Подсветить перегон: пульсирующий контур цвета игрока, табличка «Имя: +7», паровозик вдоль пути.
   * sec — сколько секунд (Infinity — пока не вызовут stop), mode: all | label | pulse.
   */
  flashRoute(rid, color, label, sec = 5, mode = 'all') {
    const cars = this.L.routes[rid];
    if (!cars || !sec) return { stop() {} };
    const g = el('g', { class: 'fx' }, this.gFx);
    const [cl, cw] = this.L.car;
    for (const [x, y, a] of cars) {
      el('rect', { x: x - cl / 2 - 2.2, y: y - cw / 2 - 2.2, width: cl + 4.4, height: cw + 4.4, rx: 3.4, fill: 'none', stroke: color, 'stroke-width': 2.6, class: 'fx-pulse', transform: `rotate(${a} ${x} ${y})` }, g);
    }
    const mid = cars[Math.floor(cars.length / 2)];
    if (label && mode !== 'pulse') this.plate(g, mid[0], mid[1] - 14, label, color);
    const tr = this.L.tracks?.[rid];
    if (mode === 'all' && tr && tr.length > 1) {
      const d = 'M' + tr.map((p) => p.join(',')).join('L');
      const loco = el('g', {}, g);
      el('circle', { r: 8, fill: color, stroke: '#fff', 'stroke-width': 1.6 }, loco);
      el('use', { href: '#loco', x: -6, y: -3.3, width: 12, height: 6.6, color: '#111' }, loco);
      const mo = el('animateMotion', { dur: `${Math.min(2.4, Math.max(1.2, cars.length * 0.4))}s`, repeatCount: Number.isFinite(sec) ? Math.max(1, Math.floor(sec / 2.4)) : 'indefinite', path: d, rotate: '0', fill: 'freeze' }, loco);
      mo.beginElement?.();
    }
    return this.fxTimer(g, sec);
  }
  flashCity(city, color, label, sec = 5, mode = 'all') {
    const p = this.L.cities[city];
    if (!p || !sec) return { stop() {} };
    const g = el('g', { class: 'fx' }, this.gFx);
    el('circle', { cx: p[0], cy: p[1], r: p[2] + 6, fill: 'none', stroke: color, 'stroke-width': 3, class: 'fx-pulse' }, g);
    el('circle', { cx: p[0], cy: p[1], r: p[2] + 6, fill: 'none', stroke: color, 'stroke-width': 2, class: 'fx-wave' }, g);
    if (label && mode !== 'pulse') this.plate(g, p[0], p[1] - p[2] - 16, label, color);
    return this.fxTimer(g, sec);
  }
  plate(g, x, y, text, color) {
    text = tr(text);
    const w = Math.max(34, text.length * 6.1 + 12);
    const pg = el('g', { class: 'fx-plate' }, el('g', { transform: `translate(${x} ${y - 4})` }, g));
    el('path', { d: `M-5 9 L0 15 L5 9Z`, fill: color }, pg);
    el('rect', { x: -w / 2, y: -10, width: w, height: 20, rx: 4, fill: '#2B2B2B', stroke: color, 'stroke-width': 2.4 }, pg);
    const t = el('text', { x: 0, y: 4.2, 'text-anchor': 'middle', 'font-size': 11.5, 'font-weight': 700, fill: '#fff', 'font-family': 'PT Sans, Arial, sans-serif' }, pg);
    t.textContent = text;
  }
  fxTimer(g, sec) {
    const stop = () => { g.classList.add('fx-out'); setTimeout(() => g.remove(), 450); };
    if (Number.isFinite(sec)) setTimeout(stop, sec * 1000);
    return { stop };
  }
  /** Экранные координаты центра перегона/города (для анимаций карт). */
  screenPoint(kind, id) {
    let p;
    if (kind === 'route') { const cars = this.L.routes[id]; if (!cars) return null; const m = cars[Math.floor(cars.length / 2)]; p = [m[0], m[1]]; }
    else { const c = this.L.cities[id]; if (!c) return null; p = [c[0], c[1]]; }
    const pt = this.svg.createSVGPoint(); pt.x = p[0]; pt.y = p[1];
    const m = this.root.getScreenCTM();
    if (!m) return null;
    const q = pt.matrixTransform(m);
    const r = this.c.getBoundingClientRect();
    return { x: Math.min(Math.max(q.x, r.left + 20), r.right - 20), y: Math.min(Math.max(q.y, r.top + 20), r.bottom - 20) };
  }

  // ---------- свободные места для значков ----------
  /** Препятствия для значков: вагоны (повёрнутые прямоугольники), кружки городов, подписи. */
  obstacles() {
    if (this._obst) return this._obst;
    const [cl, cw] = this.L.car;
    const cars = [];
    for (const list of Object.values(this.L.routes)) for (const [x, y, a] of list) {
      const t = (a * Math.PI) / 180; cars.push([x, y, Math.cos(t), Math.sin(t), cl / 2 + 1, cw / 2 + 1]);
    }
    const circles = Object.values(this.L.cities).map(([x, y, r]) => [x, y, r + 1.8]);
    const boxes = [];
    for (const t of this.root.querySelectorAll('text')) {
      if (t.closest('g[data-r]') || t.closest('#map-geo')) continue;   // подписи рек можно слегка закрывать
      try { const bb = t.getBBox(); if (bb.width) boxes.push([bb.x - 1, bb.y - 1, bb.x + bb.width + 1, bb.y + bb.height + 1]); } catch { /* нет разметки */ }
    }
    return (this._obst = { cars, circles, boxes });
  }
  /** Место для значка w×h рядом с городом: ближайшее, где он ничего не закрывает (или закрывает меньше всего). */
  spot(city, w, h) {
    const used = (this.slotsUsed.all ||= []);
    const [x, y, r] = this.L.cities[city];
    const { cars, circles, boxes } = this.obstacles();
    const R = 90;
    const near = cars.filter(([cx, cy]) => Math.abs(cx - x) < R && Math.abs(cy - y) < R);
    const nearC = circles.filter(([cx, cy]) => Math.abs(cx - x) < R && Math.abs(cy - y) < R);
    const nearB = boxes.filter(([a0, b0, a1, b1]) => a1 > x - R && a0 < x + R && b1 > y - R && b0 < y + R);
    const hit = (px, py) => {
      for (const [cx, cy, c, s, hl, hw] of near) {
        const dx = px - cx, dy = py - cy;
        if (Math.abs(dx * c + dy * s) <= hl && Math.abs(-dx * s + dy * c) <= hw) return 1;
      }
      for (const [cx, cy, cr] of nearC) if ((px - cx) ** 2 + (py - cy) ** 2 <= cr * cr) return 1;
      for (const [a0, b0, a1, b1] of nearB) if (px >= a0 && px <= a1 && py >= b0 && py <= b1) return 1;
      for (const [ux, uy, uw, uh] of used) if (Math.abs(px - ux) <= uw / 2 + 1 && Math.abs(py - uy) <= uh / 2 + 1) return 1;
      return 0;
    };
    const cost = (cx, cy) => {
      let n = 0;
      for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) n += hit(cx - w / 2 + (w * i) / 4, cy - h / 2 + (h * j) / 4);
      return n;
    };
    let best = null;
    for (let d = r + Math.max(w, h) / 2 + 2; d < r + 60; d += 1.5) {
      for (let k = 0; k < 36; k++) {
        const ang = (-60 + k * 10) * Math.PI / 180;
        const cx = x + Math.cos(ang) * d, cy = y + Math.sin(ang) * d;
        const c = cost(cx, cy);
        if (c === 0) { used.push([cx, cy, w, h]); return [cx, cy]; }
        const score = c * 10 + d;
        if (!best || score < best[0]) best = [score, cx, cy];
      }
    }
    used.push([best[1], best[2], w, h]); return [best[1], best[2]];
  }

  /** Убрать с поля обозначения выключенных модулей: «?» путевых карт и «| 3» конечных станций. */
  applyModes(cfg) {
    if (!cfg.modules.routeCards) {
      for (const c of this.root.querySelectorAll('g[data-r] circle[fill="#F2E3A0"]')) {
        c.style.display = 'none';
        const t = c.nextElementSibling;
        if (t && t.tagName === 'text' && t.textContent.trim() === '?') t.style.display = 'none';
      }
    }
    if (!cfg.modules.terminus) {
      for (const r of this.root.querySelectorAll('rect[fill="#E8C35A"]')) {
        const t = r.nextElementSibling;
        if (!t || t.tagName !== 'text' || !t.querySelector('tspan')) continue;
        for (const ts of t.querySelectorAll('tspan')) ts.style.display = 'none';
        r.setAttribute('fill', '#F6F1E4'); r.setAttribute('stroke', 'none'); r.setAttribute('opacity', '0.8');
      }
    }
  }
}
