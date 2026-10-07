// Главная: имя, создание комнаты, вход по коду, игра с ботами, возврат в партию.
import { h, clear, toast, confirmBox, modal } from './dom.js';
import { APP_VERSION } from '../version.js';
import { langSelect } from './lang.js';
import { supabaseConfigured, backend } from '../net/client.js';
import { listSessions, dropSession, patchSession, loadOffline, clearOffline, getPref, setPref } from '../net/sessions.js';
import { noTr, tr } from '../i18n.js';

export function renderHome(root, app, { joinCode = '', joinBackend = null } = {}) {
  const hasSb = supabaseConfigured();
  let backendKind = joinBackend || (hasSb ? getPref('backend', 'supabase') : 'demo');
  if (!hasSb) backendKind = 'demo';
  const name = h('input', { value: getPref('name', ''), maxlength: 20, placeholder: 'Как вас зовут', 'aria-label': 'Ваше имя' });
  name.addEventListener('change', () => setPref('name', name.value.trim()));
  const needName = () => { const n = name.value.trim(); if (!n) { toast('Введите имя', 'err'); name.focus(); return null; } setPref('name', n); return n; };
  const serverSel = hasSb ? h('select', { onchange: (e) => { backendKind = e.target.value; setPref('backend', backendKind); } },
    h('option', { value: 'supabase', selected: backendKind === 'supabase' }, 'Интернет (Supabase)'),
    h('option', { value: 'demo', selected: backendKind === 'demo' }, 'Демо-сеть: вкладки этого браузера')) : null;
  const code = h('input.code', { value: joinCode, maxlength: 6, placeholder: 'КОД', style: { width: '120px', textTransform: 'uppercase' }, 'aria-label': 'Код комнаты' });
  const busy = async (btn, f) => { btn.disabled = true; try { await f(); } catch (e) { toast(e.message, 'err', 7000); } finally { btn.disabled = false; } };

  const create = h('button.primary', { onclick: () => { const n = needName(); if (n) busy(create, () => app.createRoom(backendKind, n)); } }, 'Создать комнату');
  const join = h('button', { onclick: () => { const n = needName(); if (!n) return; if (code.value.trim().length !== 6) return toast('Код комнаты — 6 символов', 'err'); busy(join, () => app.joinRoom(backendKind, code.value.trim(), n)); } }, 'Войти');
  code.addEventListener('keydown', (e) => { if (e.key === 'Enter') join.click(); });

  const saved = loadOffline();
  const sessions = listSessions();
  const retRoom = h('input.code', { maxlength: 6, placeholder: 'КОД', style: { width: '110px', textTransform: 'uppercase' } });
  const retCode = h('input.code', { maxlength: 12, placeholder: '2-ABCD2345', style: { width: '150px', textTransform: 'uppercase' } });
  const retBtn = h('button', { onclick: () => busy(retBtn, () => app.claimSeat(backendKind, retRoom.value.trim(), retCode.value.trim(), name.value.trim())) }, 'Вернуться');

  const sameName = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
  const forgetDialog = (s0) => {
    // удалить партию для всех может только тот, кто её создал: хозяин комнаты с тем же именем, что указано сейчас
    const s = { ...s0, host: Boolean(s0.host && sameName(s0.name, name.value)) };
    const redraw = () => renderHome(root, app);
    modal({ title: `Партия ${s.code}`,
      body: h('p', s.host ? 'Вы хозяин этой партии. Удалить её на сервере для всех игроков или только убрать из списка на этом устройстве?' : 'Убрать партию из списка на этом устройстве? Удалить её для всех может только хозяин.'),
      buttons: [
        { text: 'Отмена', onClick: (c) => c() },
        { text: 'Убрать из списка', primary: !s.host, onClick: (c) => { c(); dropSession(s.backend, s.room_id); redraw(); } },
        ...(s.host ? [{ text: 'Удалить для всех', primary: true, onClick: async (c) => {
          c();
          try {
            const api = await backend(s.backend);
            await api.rpc('delete_room', { p_room: s.room_id });
            toast('Партия удалена', 'ok');
          } catch (e) {
            if (!/не найден|not found/i.test(e.message)) { toast('Не удалось удалить на сервере: ' + e.message, 'err', 8000); return; }
          }
          dropSession(s.backend, s.room_id); redraw();
        } }] : []),
      ] });
  };
  const dateOf = (t) => (t ? new Date(t).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null);
  const metaEls = new Map();
  const metaText = (s) => [s.created ? `создана ${dateOf(s.created)}` : null, s.players ? `игроков: ${s.players}` : null, s.gone ? 'на сервере уже нет' : null].filter(Boolean).join(' · ') || '…';
  const sessionRow = (s) => {
    const meta = h('span.smeta', metaText(s)); metaEls.set(s.backend + s.room_id, meta);
    const mineToDelete = s.host && sameName(s.name, name.value);
    return h('li',
      h('span.code', s.code),
      h('span.sinfo', h('span', `${s.name || ''} · место ${Number(s.seat) + 1}${s.host ? ' · хозяин' : ''}${s.backend === 'demo' ? ' · демо-сеть' : ''}`), meta),
      h('button.small', { onclick: (e) => busy(e.target, () => app.openRoom(s.backend, s.room_id)) }, 'Открыть'),
      h('button.link.small', { title: mineToDelete ? 'Удалить партию' : 'Убрать из списка', onclick: () => forgetDialog(s) }, '×'));
  };
  clear(root).append(h('div.screen.homescreen',
    h('div.langbar', langSelect()),
    h('div.hero', h('h1', 'Чыгунка'), h('p', 'Железнодорожная игра по карте Беларуси — по сети с друзьями и с ботами')),
    !hasSb ? h('div.notice', 'Сервер Supabase ещё не подключён (файл config.js). Доступны игра с ботами и ', h('b', 'демо-сеть'), ': откройте страницу в нескольких вкладках этого браузера — и каждая вкладка станет отдельным игроком.') : null,
    h('div.homegrid',
      h('div.homecol',
        h('div.panel',
          h('h2', 'Партия по сети'),
          h('div.frow', h('label.field.grow', h('span', 'Ваше имя'), name), serverSel ? h('label.field', h('span', 'Сервер'), serverSel) : null),
          h('div.frow.split',
            h('div', create, h('p.small.muted', 'Отправьте друзьям код или ссылку. Ботов можно добавить в лобби.')),
            h('div.joinbox', h('span.small.muted', 'или войти по коду'), h('div.row', code, join)))),
        h('div.panel',
          h('h2', 'С ботами без сети'),
          h('p.small', 'Вы и от 1 до 4 ботов в этом браузере. Интернет не нужен после загрузки страницы.'),
          h('div.row', h('button.primary', { onclick: () => app.go('#/offline') }, 'Новая партия с ботами'),
            saved?.state && saved.state.phase !== 'over' ? h('button', { onclick: () => app.go('#/offline/game') }, `Продолжить (ход ${saved.state.turnNo})`) : null,
            saved?.state ? h('button.link', { onclick: async () => { if (await confirmBox('Удалить сохранение', 'Удалить сохранённую партию с ботами?')) { clearOffline(); renderHome(root, app); } } }, 'удалить') : null))),
      h('div.panel.sesspanel',
        h('h2', 'Вернуться в партию', sessions.length ? h('span.badge', { style: { marginLeft: '8px' } }, sessions.length) : null),
        sessions.length ? h('ul.sessions', sessions.map(sessionRow)) : h('p.small.muted', 'В этом браузере сохранённых партий нет.'),
        h('details.otherdev', h('summary', 'С другого устройства'),
          h('p.small.muted', 'Код возврата выдаётся при входе в комнату (например «2-ABCD2345»: номер места и код).'),
          h('div.row', retRoom, retCode, retBtn)))),
    h('p.small.muted.homefoot', { style: { textAlign: 'center', marginTop: '28px' } }, `Версия ${APP_VERSION} · карта: 69 городов, 123 перегона · `, h('a', { href: '#/', onclick: (e) => { e.preventDefault(); import('./rules.js').then((r) => { r.initRules(app.E.M); r.showRules(); }); } }, 'полные правила'), ' · ', h('a', { href: '#/', onclick: (e) => { e.preventDefault(); import('./dialogs.js').then((d) => d.helpDialog()); } }, 'памятка'))));
  homeSecrets(root);
  // дата создания и число игроков — с сервера (для партий, сохранённых раньше, и чтобы число было свежим)
  (async () => {
    for (const s of sessions) {
      if (!root.isConnected) return;
      try {
        const api = await backend(s.backend);
        const [room] = await api.select('rooms', { id: s.room_id });
        const patch = room ? { created: Date.parse(room.created_at) || s.created, players: (await api.select('seats', { room_id: s.room_id })).filter((x) => x.kind !== 'closed').length, gone: false } : { gone: true };
        patchSession(s.backend, s.room_id, patch);
        const el = metaEls.get(s.backend + s.room_id);
        if (el) el.textContent = tr(metaText({ ...s, ...patch }));
      } catch { /* нет сети — остаётся то, что сохранено в браузере */ }
    }
  })();
  if (joinCode) name.value ? join.focus() : name.focus();
}

// ---------- секреты главной страницы: василёк и часы на фоновой картинке ----------
const BG = { w: 1408, h: 768, flower: [205, 228, 40], clock: [1296, 392, 52] };   // координаты на img/home_bg.jpg
function homeSecrets(root) {
  document.querySelectorAll('.bgspot').forEach((x) => x.remove());
  const flower = h('div.bgspot', { ondblclick: showLove });
  const clock = h('div.bgspot', { onclick: () => {
    const on = getPref('love', '0') !== '1';
    setPref('love', on ? '1' : '0');
    noTr(() => toast(on ? 'В новых партиях на поле будет надпись «Сделано с любовью для Коти» ♥' : 'Надпись на поле выключена', 'ok', 4500));
  } });
  const place = () => {
    if (!flower.isConnected) { window.removeEventListener('resize', place); return; }
    const vw = window.innerWidth, vh = window.innerHeight, k = Math.max(vw / BG.w, vh / BG.h), ox = (vw - BG.w * k) / 2;   // фон: cover, center top, fixed
    for (const [el, [x, y, r]] of [[flower, BG.flower], [clock, BG.clock]]) Object.assign(el.style, { left: `${ox + (x - r) * k}px`, top: `${(y - r) * k}px`, width: `${2 * r * k}px`, height: `${2 * r * k}px` });
  };
  (root.querySelector('.homescreen') || root).append(flower, clock);
  window.addEventListener('resize', place);
  requestAnimationFrame(place);
}
function showLove() {
  document.querySelector('.love-over')?.remove();
  const hearts = Array.from({ length: 26 }, (_, i) => h('span.lheart', { style: { left: `${4 + Math.random() * 92}%`, fontSize: `${18 + Math.random() * 34}px`, animationDelay: `${(i * 0.37) % 6}s`, animationDuration: `${4.5 + Math.random() * 3.5}s` } }, '♥'));
  const over = noTr(() => h('div.love-over', { onclick: () => over.remove() },
    h('figure.love-card', h('img', { src: 'img/love.jpg', alt: '' }), h('figcaption', 'С любовью для Коти ', h('span.heart', '♥'))), hearts));
  document.body.append(over);
  setTimeout(() => over.remove(), 10000);
}
