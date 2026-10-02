// Главная: имя, создание комнаты, вход по коду, игра с ботами, возврат в партию.
import { h, clear, toast, confirmBox, modal } from './dom.js';
import { APP_VERSION } from '../version.js';
import { langSelect } from './lang.js';
import { supabaseConfigured, backend } from '../net/client.js';
import { listSessions, dropSession, loadOffline, clearOffline, getPref, setPref } from '../net/sessions.js';

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

  const forgetDialog = (s) => {
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
  clear(root).append(h('div.screen',
    h('div.langbar', langSelect()),
    h('div.hero', h('h1', 'Чыгунка'), h('p', 'Железнодорожная игра по карте Беларуси — по сети с друзьями и с ботами')),
    !hasSb ? h('div.notice', 'Сервер Supabase ещё не подключён (файл config.js). Доступны игра с ботами и ', h('b', 'демо-сеть'), ': откройте страницу в нескольких вкладках этого браузера — и каждая вкладка станет отдельным игроком.') : null,
    h('div.cards',
      h('div.panel',
        h('h2', 'Партия по сети'),
        h('label.field', h('span', 'Ваше имя'), name),
        serverSel ? h('label.field', h('span', 'Сервер'), serverSel) : null,
        h('div.row', create),
        h('p.small.muted', 'Создайте комнату и отправьте друзьям код или ссылку. Ботов можно добавить в лобби.'),
        h('h3', 'Войти по коду'),
        h('div.row', code, join)),
      h('div.panel',
        h('h2', 'С ботами без сети'),
        h('p.small', 'Вы и от 1 до 4 ботов в этом браузере. Интернет не нужен после загрузки страницы.'),
        h('div.row', h('button.primary', { onclick: () => app.go('#/offline') }, 'Новая партия с ботами'),
          saved?.state && saved.state.phase !== 'over' ? h('button', { onclick: () => app.go('#/offline/game') }, `Продолжить (ход ${saved.state.turnNo})`) : null,
          saved?.state ? h('button.link', { onclick: async () => { if (await confirmBox('Удалить сохранение', 'Удалить сохранённую партию с ботами?')) { clearOffline(); renderHome(root, app); } } }, 'удалить') : null)),
      h('div.panel',
        h('h2', 'Вернуться в партию'),
        sessions.length ? h('ul.sessions', sessions.map((s) => h('li',
          h('span.code', s.code), h('span.small.grow', `${s.name || ''} · место ${Number(s.seat) + 1}${s.host ? ' · хозяин' : ''} · ${s.backend === 'demo' ? 'демо-сеть' : 'интернет'}`),
          h('button.small', { onclick: (e) => busy(e.target, () => app.openRoom(s.backend, s.room_id)) }, 'Открыть'),
          h('button.link.small', { title: s.host ? 'Удалить партию' : 'Убрать из списка', onclick: () => forgetDialog(s) }, '×')))) : h('p.small.muted', 'В этом браузере сохранённых партий нет.'),
        h('h3', 'С другого устройства'),
        h('p.small.muted', 'Код возврата выдаётся при входе в комнату (например «2-ABCD2345»: номер места и код).'),
        h('div.row', retRoom, retCode, retBtn))),
    h('p.small.muted.homefoot', { style: { textAlign: 'center', marginTop: '28px' } }, `Версия ${APP_VERSION} · карта: 69 городов, 123 перегона · `, h('a', { href: '#/', onclick: (e) => { e.preventDefault(); import('./rules.js').then((r) => { r.initRules(app.E.M); r.showRules(); }); } }, 'полные правила'), ' · ', h('a', { href: '#/', onclick: (e) => { e.preventDefault(); import('./dialogs.js').then((d) => d.helpDialog()); } }, 'памятка'))));
  if (joinCode) name.value ? join.focus() : name.focus();
}
