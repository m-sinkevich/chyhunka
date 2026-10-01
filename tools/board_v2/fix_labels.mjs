// Шаг 3 (при необходимости). Раскладывает подписи городов так, чтобы они не закрывали вагоны, кружки городов и таблички.
// Нужен запущенный сервер игры (python3 -m http.server 8080) и Playwright. Результат — src/label_fix.json;
// потом ещё раз: python3 tools/board_v2/decorate.py (он применит сдвиги).
// Запуск: node tools/board_v2/fix_labels.mjs [http://localhost:8080]
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://localhost:8080';
const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
await p.goto(base + '/#/offline'); await p.waitForTimeout(1200);
await p.getByRole('button', { name: 'Начать партию' }).click(); await p.waitForTimeout(2000);
const out = await p.evaluate(() => {
  const G = window.__app.screen; const B = G.board; const L = B.L; const [cl, cw] = L.car;
  const byName = {}; for (const c of Object.values(G.M.cities)) byName[c.name] = c.id;
  const cars = []; for (const list of Object.values(L.routes)) for (const [x, y, a] of list) { const t = a * Math.PI / 180; cars.push([x, y, Math.cos(t), Math.sin(t)]); }
  const circles = Object.values(L.cities);
  const rects = [];   // таблички конечных станций, легенда, таблица очков
  for (const r of B.root.querySelectorAll(':scope > rect[fill="#E8C35A"], #legend, #score-table')) { const bb = r.getBBox(); const m = r.getCTM && r.transform?.baseVal?.consolidate?.(); rects.push(r.id ? (() => { const q = r.getBoundingClientRect(); const a = B.toSvg(q.left, q.top), z = B.toSvg(q.right, q.bottom); return [a.x, a.y, z.x, z.y]; })() : [bb.x, bb.y, bb.x + bb.width, bb.y + bb.height]); void m; }
  const labels = [...B.root.querySelectorAll(':scope > text')].filter((t) => byName[t.textContent.trim()]);
  const boxOf = (t) => { const bb = t.getBBox(); return [bb.x, bb.y + 1, bb.x + bb.width, bb.y + bb.height - 1]; };
  const hits = (bx, self) => {
    let n = 0;
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 4; j++) {
      const px = bx[0] + (bx[2] - bx[0]) * i / 10, py = bx[1] + (bx[3] - bx[1]) * j / 4;
      for (const [x, y, c, s] of cars) { const dx = px - x, dy = py - y; if (Math.abs(dx * c + dy * s) <= cl / 2 + 0.6 && Math.abs(-dx * s + dy * c) <= cw / 2 + 0.6) { n++; break; } }
      for (const [x, y, r] of circles) if ((px - x) ** 2 + (py - y) ** 2 <= (r + 0.8) ** 2) { n++; break; }
      for (const q of rects) if (px >= q[0] && px <= q[2] && py >= q[1] && py <= q[3]) { n++; break; }
      for (const o of labels) if (o !== self) { const ob = boxOf(o); if (px >= ob[0] - 0.5 && px <= ob[2] + 0.5 && py >= ob[1] - 0.5 && py <= ob[3] + 0.5) { n++; break; } }
    }
    return n;
  };
  const fixes = {};
  for (const t of labels) {
    const name = t.textContent.trim(); const [cx, cy, r] = L.cities[byName[name]];
    const orig = { x: t.getAttribute('x'), y: t.getAttribute('y'), a: t.getAttribute('text-anchor') || 'start' };
    if (hits(boxOf(t), t) === 0) continue;
    const fs = parseFloat(t.getAttribute('font-size'));
    const cand = [];
    for (const g of [1.6, 3.5, 6]) {
      cand.push(['start', cx + r + g, cy + fs * 0.35], ['end', cx - r - g, cy + fs * 0.35],
        ['middle', cx, cy - r - g], ['middle', cx, cy + r + g + fs * 0.75],
        ['start', cx + r * 0.7 + g, cy - r * 0.7 - g], ['end', cx - r * 0.7 - g, cy - r * 0.7 - g],
        ['start', cx + r * 0.7 + g, cy + r * 0.7 + g + fs * 0.7], ['end', cx - r * 0.7 - g, cy + r * 0.7 + g + fs * 0.7]);
    }
    let best = null;
    for (const [a, x, y] of cand) {
      t.setAttribute('text-anchor', a); t.setAttribute('x', x.toFixed(2)); t.setAttribute('y', y.toFixed(2));
      const h = hits(boxOf(t), t);
      const d = Math.hypot(x - parseFloat(orig.x), y - parseFloat(orig.y));
      const score = h * 100 + d;
      if (!best || score < best[0]) best = [score, a, x, y, h];
    }
    t.setAttribute('text-anchor', best[1]); t.setAttribute('x', best[2].toFixed(2)); t.setAttribute('y', best[3].toFixed(2));
    fixes[name] = { anchor: best[1], x: +best[2].toFixed(2), y: +best[3].toFixed(2), left: best[4] };
  }
  return fixes;
});
writeFileSync(new URL('./src/label_fix.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(Object.entries(out).map(([k, v]) => `${k}${v.left ? ' (осталось ' + v.left + ')' : ''}`).join(', ') || 'всё чисто');
await b.close();
