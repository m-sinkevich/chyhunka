// Точка входа: загрузка данных, маршрутизация по #адресу, запуск экранов.
import { makeEngine } from './engine/index.js';
import { newSeed } from './engine/rng.js';
import { backend } from './net/client.js';
import { createRoom, joinRoom, claimSeat, Lobby } from './net/room.js';
import { HostGame } from './net/host.js';
import { GuestGame } from './net/guest.js';
import { LocalGame } from './net/local.js';
import { listSessions, saveSession, loadOffline, getPref } from './net/sessions.js';
import { h, clear, toast } from './ui/dom.js';
import { renderHome } from './ui/home.js';
import { renderLobby, renderOffline } from './ui/lobby.js';
import { GameScreen } from './ui/game.js';
import { PUBLIC_URL } from '../config.js';
import { APP_VERSION } from './version.js';

const root = document.getElementById('app');

const app = {
  E: null, svgText: '', layout: null, screen: null, route: null,
  go(hash) { if (location.hash === hash) this.route(); else location.hash = hash; },
  inviteLink(code) {
    const base = PUBLIC_URL || location.href.split('#')[0];
    return `${base}#/join/${code}${this.backendKind === 'demo' ? '?demo' : ''}`;
  },
  closeScreen() { try { this.screen?.close?.(); } catch (e) { console.warn(e); } this.screen = null; },

  async createRoom(kind, name) {
    const api = await backend(kind);
    const r = await createRoom(api, name, {});
    this.go(`#/room/${kind}/${r.room_id}`);
  },
  async joinRoom(kind, code, name) {
    const api = await backend(kind);
    const r = await joinRoom(api, code, name);
    this.go(`#/room/${kind}/${r.room_id}`);
  },
  async claimSeat(kind, code, ret, name) {
    const m = String(ret).toUpperCase().replace(/\s/g, '').match(/^([1-5])-?([A-Z0-9]{8})$/);
    if (!m) throw new Error('Код возврата выглядит так: 2-ABCD2345 (номер места и 8 символов)');
    if (String(code).trim().length !== 6) throw new Error('Введите код комнаты (6 символов)');
    const api = await backend(kind);
    const r = await claimSeat(api, code, Number(m[1]) - 1, m[2], name);
    this.go(`#/room/${kind}/${r.room_id}`);
  },
  openRoom(kind, id) { this.go(`#/room/${kind}/${id}`); },

  async showRoom(kind, roomId) {
    this.backendKind = kind;
    const api = await backend(kind);
    const lobby = new Lobby(api, roomId);
    try { await lobby.start(); } catch (e) { lobby.close(); throw new Error('Нет доступа к комнате. Если вы играли на другом устройстве — войдите по коду возврата.'); }
    const s0 = listSessions().find((s) => s.backend === kind && s.room_id === roomId);
    const session = { backend: kind, room_id: roomId, code: lobby.room.code, seat: lobby.mySeat, name: lobby.seats.find((x) => x.uid === api.uid)?.name, host: lobby.isHost, ...(s0 || {}) };
    session.seat = lobby.mySeat ?? session.seat;
    saveSession(session);
    if (lobby.room.status === 'lobby') {
      this.screen = lobby;
      renderLobby(root, this, lobby, session);
      return;
    }
    const room = { id: roomId, code: lobby.room.code };
    const seats = lobby.seats; const isHost = lobby.isHost; const my = lobby.mySeat;
    lobby.close();
    if (my == null && !isHost) throw new Error('Вы не участвуете в этой партии');
    let ctrl;
    if (isHost) { ctrl = await HostGame.resume(this.E, api, room, seats); }
    else { ctrl = new GuestGame(this.E, api, room, my); }
    ctrl.room = room; ctrl.backendKind = kind;
    ctrl.returnCode = session.return_code ? `${Number(session.seat) + 1}-${session.return_code}` : null;
    await ctrl.start();
    if (!ctrl.view) throw new Error('Партия ещё не загружена. Попробуйте обновить страницу.');
    this.screen = new GameScreen(root, this, ctrl);
  },

  async startHosted(session, lobby, cfg) {
    const api = await backend(session.backend);
    const room = { id: lobby.roomId, code: lobby.room.code };
    const host = await HostGame.create(this.E, api, room, lobby.seats, cfg);
    this.closeScreen();
    host.room = room; host.backendKind = session.backend;
    host.returnCode = session.return_code ? `${Number(session.seat) + 1}-${session.return_code}` : null;
    await host.start();
    this.screen = new GameScreen(root, this, host);
  },

  startOffline(me, bots, cfg) {
    const names = ['Янка', 'Алеся', 'Язэп', 'Паўлінка'];
    let seats = [{ name: me.name, color: me.color, bot: null }, ...bots.map((b, i) => ({ name: `${names[i]} (бот)`, color: b.color, bot: b.level }))];
    if (cfg.randomOrder) for (let i = seats.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [seats[i], seats[j]] = [seats[j], seats[i]]; }
    const st = this.E.init(cfg, seats, newSeed());
    const kinds = seats.map((p) => (p.bot ? { kind: 'bot', level: p.bot } : { kind: 'human' }));
    this.pendingOffline = new LocalGame(this.E, st, kinds);
    this.pendingOffline.seat = seats.findIndex((p) => !p.bot);
    this.go('#/offline/game');
  },
  openOffline() {
    let ctrl = this.pendingOffline;
    this.pendingOffline = null;
    if (!ctrl) {
      const saved = loadOffline();
      if (!saved?.state) { this.go('#/offline'); return; }
      ctrl = new LocalGame(this.E, saved.state, saved.kinds, saved.log || []);
      ctrl.seat = saved.kinds.findIndex((k) => k.kind === 'human');
    }
    ctrl.view = this.E.view(ctrl.state, ctrl.seat);
    this.screen = new GameScreen(root, this, ctrl);
    ctrl.start();
  },

  async rematch(G) {
    const c = G.ctrl; const st = c.state;
    if (c.mode === 'local') {
      const me = st.players[c.seat];
      const bots = st.players.map((p, i) => ({ ...p, i })).filter((p) => p.i !== c.seat).map((p) => ({ level: c.kinds[p.i].level, color: p.color }));
      G.close();
      this.startOffline({ name: me.name, color: me.color }, bots, st.cfg);
      return;
    }
    const api = await backend(c.backendKind);
    const info = c.seatsInfo();
    const myName = info[c.seat]?.name || getPref('name', 'Хозяин');
    const cfg = { ...st.cfg }; delete cfg.players; delete cfg.duelOn; delete cfg.rulesVersion;
    const r = await createRoom(api, myName, cfg);
    const seatsPayload = [];
    const byDb = [...info].sort((a, b) => a.dbSeat - b.dbSeat);
    let k = 1;
    for (const p of byDb) {
      if (p.dbSeat === st.players[c.seat].dbSeat) { seatsPayload.push({ seat: 0, color: p.color }); continue; }
      seatsPayload.push({ seat: k++, kind: p.kind === 'bot' ? 'bot' : 'human', bot_level: p.level, color: p.color, name: p.kind === 'bot' ? p.name : undefined });
    }
    while (k < 5) seatsPayload.push({ seat: k++, kind: 'closed' });
    await api.rpc('update_lobby', { p_room: r.room_id, p_config: cfg, p_seats: seatsPayload });
    c.presence?.send('rematch', { backend: c.backendKind, code: r.code });
    G.close();
    this.go(`#/room/${c.backendKind}/${r.room_id}`);
  },
  async followRematch(G, m) {
    try {
      const name = G.ctrl.seatsInfo()[G.ctrl.seat]?.name || getPref('name', 'Игрок');
      G.close();
      await this.joinRoom(m.backend, m.code, name);
      toast('Реванш! Вы в новом лобби', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  },
};

async function route() {
  const hash = location.hash || '#/';
  document.body.classList.toggle('home', hash === '#/' || hash === '#' || /^#\/join\//.test(hash));
  app.closeScreen();
  try {
    let m;
    if ((m = hash.match(/^#\/room\/(supabase|demo)\/([\w-]+)/))) {
      clear(root).append(h('div.loading', 'Подключение…'));
      await app.showRoom(m[1], m[2]);
    } else if ((m = hash.match(/^#\/join\/([A-Za-z0-9]{6})(\?demo)?/))) {
      renderHome(root, app, { joinCode: m[1].toUpperCase(), joinBackend: m[2] ? 'demo' : null });
    } else if (hash === '#/offline') {
      renderOffline(root, app);
    } else if (hash === '#/offline/game') {
      app.openOffline();
    } else renderHome(root, app);
  } catch (e) {
    console.error(e);
    renderHome(root, app);
    toast(e.message, 'err', 8000);
  }
}
app.route = route;

async function boot() {
  try {
    const [map, layout, svgText] = await Promise.all([
      fetch('data/map.json?v=' + APP_VERSION).then((r) => r.json()), fetch('data/layout.json?v=' + APP_VERSION).then((r) => r.json()),
      fetch('img/board.svg?v=' + APP_VERSION).then((r) => r.text()).then((t) => t.replace('img/board_bg.jpg', 'img/board_bg.jpg?v=' + APP_VERSION)),
    ]);
    app.E = makeEngine(map); app.layout = layout; app.svgText = svgText;
  } catch (e) {
    clear(root).append(h('div.screen', h('div.notice.err', h('b', 'Не удалось загрузить данные игры. '),
      location.protocol === 'file:' ? 'Страницу нужно открывать через веб-сервер, а не двойным щелчком по файлу: например, GitHub Pages или команда «python3 -m http.server» в папке игры (см. README.md).' : e.message)));
    return;
  }
  window.addEventListener('hashchange', route);
  route();
}
window.__app = app; // для отладки в консоли
boot();
