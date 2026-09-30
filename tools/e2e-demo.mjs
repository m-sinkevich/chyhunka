// Проверка в настоящем браузере: две вкладки играют по «демо-сети» (хозяин + гость + бот),
// обе перезагружаются посреди партии, партия доигрывается до конца.
// Запуск: python3 -m http.server 8080 (в папке игры), затем: npx playwright install chromium && node tools/e2e-demo.mjs
import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const errs = [];
const watch = (p, tag) => { p.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('ERR_TUNNEL')) errs.push(tag + ' ' + m.type() + ': ' + m.text()); }); p.on('pageerror', (e) => errs.push(tag + ' PAGEERROR ' + e.message + '\n' + e.stack)); };
const A = await ctx.newPage(); watch(A, 'A');
await A.goto('http://localhost:8080/'); await A.evaluate(async () => { localStorage.clear(); await new Promise((r) => { const q = indexedDB.deleteDatabase('bnr-demo-db'); q.onsuccess = q.onerror = q.onblocked = r; }); });
await A.goto('http://localhost:8080/');
await A.fill('input[aria-label="Ваше имя"]', 'Михаил');
await A.click('button:has-text("Создать комнату")');
await A.waitForSelector('.bigcode');
const code = (await A.textContent('.bigcode')).trim();
console.log('code', code);
const B = await ctx.newPage(); watch(B, 'B');
await B.goto('http://localhost:8080/#/join/' + code + '?demo');
await B.waitForTimeout(500);
await B.fill('input[aria-label="Ваше имя"]', 'Анна');
await B.click('button:has-text("Войти")');
await B.waitForSelector('.bigcode');
await A.waitForTimeout(800);
// хозяин: место 3 — бот
await A.selectOption('table.seats tr:nth-child(3) select', 'bot');
await A.waitForTimeout(800);
await A.screenshot({ path: './lobbyA.png', fullPage: true });
await B.screenshot({ path: './lobbyB.png', fullPage: true });
await A.click('button.primary:has-text("Начать партию")');
await A.waitForSelector('.topbar');
await B.waitForSelector('.topbar', { timeout: 10000 });
await A.waitForTimeout(1000);
for (const P of [A, B]) { if (await P.$('button:has-text("Оставить выбранные")')) await P.click('button:has-text("Оставить выбранные")'); }
await A.waitForTimeout(2500);
await B.screenshot({ path: './netB1.png' });
console.log('A:', await A.textContent('.topbar .status'), '| B:', await B.textContent('.topbar .status'));
// оба игрока «передают управление» ботам-автоматам через консоль, чтобы проверить длинную партию
const auto = async (P) => P.evaluate(async () => {
  const { legalFromView } = await import('/js/engine/viewstate.js');
  const { BOTS } = await import('/js/bots/index.js');
  const { makeRng } = await import('/js/engine/rng.js');
  const rng = makeRng(7);
  window.__auto = setInterval(async () => {
    const s = window.__app.screen; if (!s || !s.view || s.busy) return;
    const v = s.view; const legal = legalFromView(s.M, v);
    if (!legal.length || v.phase === 'over') return;
    s.busy = true;
    try { document.querySelectorAll('.modal-back').forEach((m) => m.remove()); const a = BOTS.medium.move(s.app.E, v, legal, rng); const r = await s.ctrl.submit(a); if (!r.ok) console.warn('rej', r.error); } finally { s.busy = false; }
  }, 120);
});
await auto(A); await auto(B);
await A.waitForTimeout(8000);
// гость перезагружает страницу посреди партии
await B.reload(); await B.waitForSelector('.topbar', { timeout: 10000 }); await auto(B);
console.log('B после перезагрузки:', await B.textContent('.topbar .status'));
await A.waitForTimeout(5000);
// хозяин перезагружает страницу
await A.reload(); await A.waitForSelector('.topbar', { timeout: 10000 }); await auto(A);
console.log('A после перезагрузки:', await A.textContent('.topbar .status'));
for (let i = 0; i < 150; i++) { const ph = await B.evaluate(() => window.__app.screen?.view?.phase); if (ph === 'over') break; await B.waitForTimeout(1000); }
await B.waitForTimeout(1500);
console.log('phase B', await B.evaluate(() => window.__app.screen?.view?.phase), 'turn', await B.evaluate(() => window.__app.screen?.view?.turnNo));
await B.screenshot({ path: './netB_end.png' });
await A.screenshot({ path: './netA_end.png' });
console.log(errs.slice(0, 25).join('\n'));
await b.close();
