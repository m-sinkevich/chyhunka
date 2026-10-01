// Лобби сетевой партии и подготовка офлайн-партии с ботами.
import { h, clear, toast, copyText } from './dom.js';
import { settingsForm, DEFAULT_CFG } from './settings.js';
import { PLAYER_COLORS, PLAYER_COLOR_NAMES, playerColor } from '../net/room.js';
import { BOTS } from '../bots/index.js';
import { getPref } from '../net/sessions.js';

const COLOR_KEYS = Object.keys(PLAYER_COLORS);
const colorSelect = (value, disabled, onchange) => h('select', { disabled, onchange: (e) => onchange(e.target.value), style: { minWidth: '110px' } },
  COLOR_KEYS.map((c) => h('option', { value: c, selected: c === value }, PLAYER_COLOR_NAMES[c])));
const swatch = (c) => h('span.dot', { style: { background: c ? playerColor(c) : '#ccc', width: '16px', height: '16px' } });

/** Лобби: хозяин настраивает места и модули, гости видят настройки и ждут старта. */
export function renderLobby(root, app, lobby, session) {
  const M = app.E.M;
  let form = null; let saveT = null; let formPlayers = 0; let renderStart = () => {};
  const saveCfg = (cfg) => { clearTimeout(saveT); saveT = setTimeout(() => lobby.save(cfg, null).catch((e) => toast(e.message, 'err')), 400); };
  const BOT_NAMES = ['Янка', 'Алеся', 'Язэп', 'Паўлінка', 'Кастусь'];
  const botName = (seat) => `${BOT_NAMES[seat % 5]} (бот)`;
  const seatPayload = (s, patch) => ({ seat: s.seat, kind: s.kind, bot_level: s.bot_level, color: s.color, name: s.kind === 'bot' ? botName(s.seat) : undefined, ...patch });
  const setSeat = async (s, patch) => {
    if (patch.kind === 'bot' && !s.bot_level) patch.bot_level = 'medium';
    if (patch.bot_level || patch.kind === 'bot') patch.name = botName(s.seat);
    const list = [seatPayload(s, patch)];
    if (patch.color) { // поменяться цветом, если он занят
      const other = lobby.seats.find((x) => x.seat !== s.seat && x.kind !== 'closed' && x.color === patch.color);
      if (other) list.push(seatPayload(other, { color: s.color || freeColor(other.seat) }));
    }
    if (patch.kind && patch.kind !== 'closed' && !s.color) list[0].color = freeColor(s.seat);
    try { await lobby.save(null, list); } catch (e) { toast(e.message, 'err'); }
  };
  const freeColor = (except) => COLOR_KEYS.find((c) => !lobby.seats.some((x) => x.seat !== except && x.kind !== 'closed' && x.color === c)) || 'violet';

  const render = () => {
    const room = lobby.room; const isHost = lobby.isHost; const me = lobby.mySeat;
    if (!room) return;
    if (room.status !== 'lobby') { app.openRoom(session.backend, room.id); return; }
    const active = lobby.seats.filter((s) => s.kind !== 'closed');
    const waitingHumans = active.filter((s) => s.kind === 'human' && !s.uid);
    const rows = lobby.seats.map((s) => {
      const mine = s.seat === me;
      const online = s.kind === 'bot' || lobby.online.has(s.seat) || mine;
      let who;
      if (s.kind === 'closed') who = h('span.muted', 'закрыто');
      else if (s.kind === 'bot') who = h('span', '🤖 ', s.name || 'Бот');
      else if (s.uid) who = mine ? h('input', { value: s.name || '', maxlength: 20, style: { width: '140px' }, onchange: (e) => lobby.setMe(e.target.value, null).catch((x) => toast(x.message, 'err')) }) : h('span', s.name || 'Игрок', ' ', h('span.on' + (online ? '.yes' : ''), { class: 'dot', style: { width: '8px', height: '8px', background: online ? '#3BB54A' : '#aaa' } }));
      else who = h('span.muted', 'ждём игрока…');
      const kindSel = isHost && s.seat !== 0 ? h('select', { onchange: (e) => setSeat(s, { kind: e.target.value }) },
        h('option', { value: 'human', selected: s.kind === 'human' }, 'Человек'), h('option', { value: 'bot', selected: s.kind === 'bot' }, 'Бот'), h('option', { value: 'closed', selected: s.kind === 'closed' }, 'Закрыто')) : null;
      const lvlSel = isHost && s.kind === 'bot' ? h('select', { onchange: (e) => setSeat(s, { bot_level: e.target.value }) }, Object.entries(BOTS).map(([k, b]) => h('option', { value: k, selected: s.bot_level === k }, b.name))) : null;
      const col = s.kind === 'closed' ? null : (isHost || mine) ? colorSelect(s.color, false, (c) => (mine && !isHost ? lobby.setMe(null, c) : setSeat(s, { color: c }))) : swatch(s.color);
      return h('tr', h('td', s.seat + 1), h('td', s.kind !== 'closed' ? swatch(s.color) : null), h('td', who, s.seat === 0 ? h('span.badge', 'хозяин') : null, mine ? h('span.badge.gold', 'вы') : null), h('td', kindSel, ' ', lvlSel), h('td', col));
    });
    if (isHost && (!form || formPlayers !== active.length)) {
      const base = form ? form.getConfig() : room.config && Object.keys(room.config).length ? room.config : DEFAULT_CFG;
      form = settingsForm(M, base, { editable: true, players: active.length, onChange: (c) => { saveCfg(c); renderStart(); } });
      formPlayers = active.length;
    } else if (!isHost) form = settingsForm(M, room.config, { editable: false, players: active.length });
    const link = app.inviteLink(room.code);
    const startBtn = h('button.primary', { onclick: () => start(startBtn) }, 'Начать партию');
    const startInfo = h('div.small');
    renderStart = () => {
      const problems = [];
      if (active.length < 2) problems.push('нужно хотя бы 2 игрока');
      if (waitingHumans.length) problems.push(`ждём игроков: ${waitingHumans.length} (или закройте место / поставьте бота)`);
      if (form && !form.valid()) problems.push('выберите ровно 3 цели');
      startBtn.disabled = problems.length > 0;
      startInfo.textContent = problems.length ? 'Чтобы начать: ' + problems.join('; ') : 'Всё готово.';
    };
    renderStart();
    clear(root).append(h('div.screen',
      h('div.row', h('button.link', { onclick: () => app.go('#/') }, '← на главную'), h('span.grow'), h('span.small.muted', session.backend === 'demo' ? 'Демо-сеть: игроки — другие вкладки этого браузера' : 'Сервер: Supabase')),
      h('div.lobby-grid',
        h('div.panel',
          h('h2', 'Комната ', h('span.code.bigcode', room.code)),
          h('div.row', h('button.small', { onclick: () => copyText(link) }, 'Скопировать ссылку-приглашение'), h('button.small', { onclick: () => copyText(room.code) }, 'Скопировать код')),
          h('p.small.muted', 'Друзья открывают ссылку или вводят код на главной странице.' + (session.backend === 'demo' ? ' В демо-сети — откройте ссылку в новой вкладке этого же браузера.' : '')),
          h('h3', 'Места'), h('table.seats', rows),
          session.return_code ? h('div.notice', 'Ваш код возврата: ', h('b.code', `${Number(session.seat) + 1}-${session.return_code}`), ' — сохраните его, чтобы продолжить партию с другого устройства. ', h('button.link.small', { onclick: () => copyText(`${Number(session.seat) + 1}-${session.return_code}`) }, 'копировать')) : null),
        h('div.panel',
          h('h2', 'Настройки партии'), isHost ? null : h('p.small.muted', 'Настройки меняет хозяин.'),
          form, isHost ? h('div.col', startBtn, startInfo) : h('div.notice', 'Ждём, когда хозяин начнёт партию…')))));
  };
  const start = async (btn) => {
    btn.disabled = true;
    try {
      const cfg = form.getConfig();
      await lobby.save(cfg, null);
      await lobby.load();
      await app.startHosted(session, lobby, cfg);
    } catch (e) { toast(e.message, 'err', 7000); btn.disabled = false; }
  };
  lobby.on(render);
  render();
}

/** Подготовка партии с ботами (без сети). */
export function renderOffline(root, app) {
  const M = app.E.M;
  const me = { name: getPref('name', '') || 'Игрок', color: 'pink' };
  const bots = [{ level: 'medium', color: 'cyan' }, { level: 'medium', color: 'lime' }];
  let cfg = { ...DEFAULT_CFG };
  const box = h('div');
  const render = () => {
    const form = settingsForm(M, cfg, { players: bots.length + 1, online: false, onChange: (c) => { cfg = c; } });
    const used = () => [me.color, ...bots.map((b) => b.color)];
    const nextColor = () => COLOR_KEYS.find((c) => !used().includes(c));
    clear(box).append(h('div.screen',
      h('button.link', { onclick: () => app.go('#/') }, '← на главную'),
      h('div.lobby-grid',
        h('div.panel',
          h('h2', 'Игроки'),
          h('table.seats',
            h('tr', h('td', '1'), h('td', swatch(me.color)), h('td', h('input', { value: me.name, maxlength: 20, onchange: (e) => { me.name = e.target.value.trim() || 'Игрок'; } }), h('span.badge.gold', 'вы')), h('td'), h('td', colorSelect(me.color, false, (c) => { const o = bots.find((b) => b.color === c); if (o) o.color = me.color; me.color = c; render(); }))),
            bots.map((b, i) => h('tr', h('td', i + 2), h('td', swatch(b.color)), h('td', '🤖 Бот'),
              h('td', h('select', { onchange: (e) => { b.level = e.target.value; } }, Object.entries(BOTS).map(([k, x]) => h('option', { value: k, selected: b.level === k }, x.name)))),
              h('td', colorSelect(b.color, false, (c) => { const o = [me, ...bots].find((x) => x !== b && x.color === c); if (o) o.color = b.color; b.color = c; render(); }), ' ',
                h('button.small', { disabled: bots.length <= 1, onclick: () => { bots.splice(i, 1); render(); }, title: 'Убрать бота' }, '×'))))),
          h('div.row', h('button.small', { disabled: bots.length >= 4, onclick: () => { bots.push({ level: 'medium', color: nextColor() }); render(); } }, '+ бот')),
          h('p.small.muted', 'Лёгкий — делает ошибки; Средний — строит кратчайшие пути к маршрутам; Магистральщик — собирает магистрали сквозным экспрессом; Сильный — планирует общую сеть, копит нужные карты, гонится за модулями и бонусами; Эксперт — то же, плюс сравнивает несколько планов, подбирает лучшие наборы маршрутов и перекрывает соперникам ключевые перегоны.')),
        h('div.panel', h('h2', 'Настройки партии'), form,
          h('button.primary', { onclick: () => { if (!form.valid()) return toast('Выберите ровно 3 цели', 'err'); app.startOffline(me, bots, form.getConfig()); } }, 'Начать партию')))));
  };
  render();
  clear(root).append(box);
}
