// Экран партии: поле, рынок карт, рука, маршруты, игроки, журнал. Один и тот же для офлайн, хозяина и гостя.
import { h, clear, fill, toast, modal, confirmBox, plural, copyText } from './dom.js';
import { Board } from './board.js';
import { cardEl, backEl, ticketEl, postcardEl, pdot, routeTipHtml, cityTipHtml } from './cards.js';
import { ticketsDialog, claimDialog, tunnelDialog, discardDialog, swapDialog, fromDiscardDialog, vitrinaDialog, stationDialog, helpDialog, phrasesDialog } from './dialogs.js';
import { showResults } from './results.js';
import { tr } from '../i18n.js';
import { cityDialog } from './cityinfo.js';
import { legalFromView, stateFromView } from '../engine/viewstate.js';
import { bestStationUse } from '../engine/scoring.js';
import { components } from '../engine/rules.js';
import { CARD_TYPES, COLOR_NAMES } from '../engine/data.js';
import { BOTS } from '../bots/index.js';
import { getPref, setPref, dropSession, clearOffline } from '../net/sessions.js';
import { icon } from './icons.js';
import { prefs, settingsDialog } from './prefs.js';
import { fly, bump, splash } from './anim.js';
import { showRules, ruleLink, initRules } from './rules.js';
import { playerColor } from '../net/room.js';

const KIND_ICON = { draw: 'cards', claim: 'wagon', tickets: 'ticket', keep: 'keep', station: 'station', swap: 'swap', tunnel: 'customs', routeCard: 'question', goal: 'trophy', lastRound: 'clock', over: 'finish', turn: 'arrow', depot: 'depot', warehouse: 'warehouse', raid: 'warehouse', terminus: 'flag', neighbors: 'neighbor', discard: 'cards', give: 'cards', pass: 'pass', chat: 'chat' };
const KIND_RULE = { draw: 'draw', claim: 'scoring', tunnel: 'tunnel', station: 'stations', tickets: 'tickets', keep: 'tickets', goal: 'goals', routeCard: 'm-routecards', lastRound: 'end', over: 'end', depot: 'm-depots', warehouse: 'm-depots', raid: 'm-depots', terminus: 'm-terminus', neighbors: 'm-neighbors', swap: 'swap' };

export class GameScreen {
  constructor(root, app, ctrl, opts = {}) {
    this.root = root; this.app = app; this.M = app.E.M; this.ctrl = ctrl; this.opts = opts;
    this.mode = null; this.selRoute = null; this.hl = []; this.hlPinned = false; this.dlgKey = null;
    this.whTarget = null; this.duelPicks = new Set(); this.sound = getPref('sound', '1') === '1';
    this.waitSince = Date.now(); this.lastWaitKey = ''; this.bubbles = {};
    this.seenEv = ctrl.events.length;
    initRules(this.M);
    this.build();
    this.off = ctrl.on((what) => this.onChange(what));
    this.timer = setInterval(() => this.tick(), 1000);
    this.onChange('view');
  }
  get view() { return this.ctrl.view; }

  build() {
    const r = clear(this.root);
    this.status = h('div.status', 'Загрузка…');
    this.timerEl = h('span.small');
    const top = h('div.topbar',
      h('span.title', 'Чыгунка'),
      this.ctrl.room ? h('button.small', { title: 'Код комнаты — скопировать ссылку-приглашение', onclick: () => copyText(this.app.inviteLink(this.ctrl.room.code)) }, 'Комната ', h('span.code', this.ctrl.room.code)) : h('span.badge', 'без сети'),
      this.status, this.timerEl,
      this.ctrl.say && this.ctrl.mode !== 'local' ? h('button.small.ib', { onclick: () => phrasesDialog(this), title: 'Короткие фразы' }, icon('chat')) : null,
      (this.soundBtn = h('button.small.ib', { onclick: () => this.toggleSound() })),
      h('button.small.ib', { onclick: () => settingsDialog(), title: 'Настройки: анимации, подсветка ходов, звук' }, icon('gear')),
      h('button.small.ib', { onclick: () => showRules(null, this.view?.cfg), title: 'Полные правила с примерами' }, icon('book'), ' Правила'),
      (this.resBtn = h('button.small.primary', { style: { display: 'none' }, onclick: () => showResults(this), title: 'Итоговая таблица: очки по статьям, маршруты, цели' }, icon('trophy', null, 15), ' Итоги')),
      h('button.small', { onclick: () => helpDialog(), title: 'Краткая памятка' }, 'Памятка'),
      h('button.small', { onclick: () => this.menu() }, 'Меню'));
    this.paintSound();
    this.left = h('div.side.left');
    this.right = h('div.side.right');
    this.bottom = h('div.bottom');
    this.boardBox = h('div.boardwrap');
    this.banner = h('div.modeBanner.hidden');
    r.append(h('div.game', top, this.left, this.boardBox, this.right, this.bottom));
    this.board = new Board(this.boardBox, this.app.svgText, this.app.layout, this.M, {
      route: (rid) => this.clickRoute(rid), city: (cid) => this.clickCity(cid),
      routeTip: (rid) => {
        if (!this.view) return null;
        const b = (this.stationRoutes || []).find((x) => x.route === rid);
        const r = this.M.routes[rid];
        const city = b ? [r.from, r.to].find((c) => (this.view.stationsAt[c] || []).includes(b.seat)) : null;
        return routeTipHtml(this.M, this.view, rid) + (b ? `<br><b>Используется станцией</b> ${this.view.players[b.seat].name}${city ? ' в городе ' + this.M.cities[city].name : ''} (пунктир)` : '');
      },
      cityTip: (cid) => (this.view ? cityTipHtml(this.M, this.view, cid) : null),
    });
    this.boardBox.append(this.banner, h('div.zoom',
      h('button', { onclick: () => this.board.zoomAt(1.3), title: 'Крупнее' }, '+'),
      h('button', { onclick: () => this.board.zoomAt(1 / 1.3), title: 'Мельче' }, '−'),
      h('button', { onclick: () => this.board.fit(), title: 'Отдалить до краёв поля' }, '⤢')));
  }

  onChange(what) {
    const v = this.view;
    if (!v) return;
    if (what === 'error' && this.ctrl.lastError) toast(this.ctrl.lastError, 'err');
    if (what === 'rematch' && this.ctrl.rematch) { this.app.followRematch(this, this.ctrl.rematch); return; }
    if (what === 'kk') return this.kkShow(this.ctrl.kk);
    if (what === 'chat') { const e = this.ctrl.events[this.ctrl.events.length - 1]; if (e?.seat != null) { this.bubbles[e.seat] = { text: e.text.split('«')[1]?.replace('»', '') || '', t: Date.now() }; } }
    if (what === 'status') {
      if (this.ctrl.status === 'conflict') toast('Партия открыта в другой вкладке как хозяин. Эта вкладка остановлена.', 'err', 9000);
      if (this.ctrl.status === 'deleted' && !this.deletedShown) {
        this.deletedShown = true;
        dropSession(this.ctrl.backendKind, this.ctrl.room?.id);
        document.querySelectorAll('.modal-back').forEach((m) => m.remove());
        modal({ title: 'Партия удалена', closable: false, body: h('p', 'Хозяин удалил эту партию. Она убрана из вашего списка.'), buttons: [{ text: 'На главную', primary: true, onClick: (c) => { c(); this.exit(); } }] });
      }
    }
    this.legal = legalFromView(this.M, v);
    const wasMine = this.isMine;
    this.isMine = this.legal.length > 0;
    if (this.isMine && !wasMine) this.notifyTurn();
    const wk = this.app.E.waitingFor ? JSON.stringify([v.turn, v.pending?.seat, v.phase, v.setup?.waiting]) : '';
    if (wk !== this.lastWaitKey) { this.lastWaitKey = wk; this.waitSince = Date.now(); }
    this.render();
    this.playEvents();
    this.autoDialogs();
    if (this.resBtn) this.resBtn.style.display = v.phase === 'over' ? '' : 'none';
    if (v.phase === 'over' && !this.shownResults) { this.shownResults = true; setTimeout(() => showResults(this), 600); }
  }

  toggleSound() { this.sound = !this.sound; setPref('sound', this.sound ? '1' : '0'); this.paintSound(); toast(this.sound ? 'Звук включён' : 'Звук выключен'); }
  paintSound() {
    this.soundBtn.replaceChildren(icon(this.sound ? 'bell' : 'bellOff'));
    this.soundBtn.classList.toggle('off', !this.sound);
    this.soundBtn.title = tr(this.sound ? 'Звук «ваш ход» включён — нажмите, чтобы выключить' : 'Звук выключен — нажмите, чтобы включить');
  }
  notifyTurn() {
    if (this.sound && navigator.userActivation?.hasBeenActive !== false) {
      try {
        const ac = (this.ac ||= new (window.AudioContext || window.webkitAudioContext)());
        const o = ac.createOscillator(), g = ac.createGain();
        o.frequency.value = 660; o.connect(g); g.connect(ac.destination);
        g.gain.setValueAtTime(0.08, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.35);
        o.start(); o.stop(ac.currentTime + 0.36);
      } catch { /* звук недоступен */ }
    }
  }

  // ---------- отрисовка ----------
  render() {
    const v = this.view; const M = this.M;
    const me = v.me;
    const has = (t) => this.legal.some((a) => a.type === t);
    // статус
    const st = this.statusText();
    this.status.textContent = tr(st.text);
    this.status.className = 'status' + (st.mine ? ' mine' : '');
    document.title = (st.mine ? '● ' : '') + 'Чыгунка';
    // поле
    const can = new Set();
    if (this.isMine && v.ts.drawn === 0 && v.phase === 'play' && !v.pending) for (const a of this.legal) if (a.type === 'claim') can.add(a.route);
    const pick = this.mode ? this.pickableCities() : null;
    this.computeStations();
    this.board.update(v, { can, sel: this.selRoute, hl: this.hl, pickCities: pick, stationRoutes: this.stationRoutes });
    this.renderLeft(); this.renderRight(); this.renderBottom();
    void has;
  }

  statusText() {
    const v = this.view; const me = v.me;
    const name = (s) => this.ctrl.seatsInfo()[s]?.name || v.players[s].name;
    if (v.phase === 'over') return { text: 'Партия окончена' };
    if (this.ctrl.status === 'offline') return { text: 'Нет связи с сервером — повторяем… ' + (this.ctrl.statusText || '') };
    if (this.ctrl.status === 'lost' || this.ctrl.status === 'deleted') return { text: this.ctrl.statusText };
    if (this.ctrl.mode === 'guest' && !this.ctrl.hostOnline && this.ctrl.presenceSeen) return { text: 'Стол хозяина не в сети — партия на паузе' };
    if (v.pending) {
      const p = v.pending;
      if (p.seat === me) return { mine: true, text: { tunnel: 'Погранконтроль: доплатите или откажитесь', keepTickets: 'Выберите, какие маршруты оставить', discard: 'Сбросьте карты' }[p.kind] };
      return { text: `Ждём решения: ${name(p.seat)}${p.kind === 'discard' ? ' (сброс карт)' : p.kind === 'tunnel' ? ' (погранконтроль)' : ' (выбор маршрутов)'}` };
    }
    if (v.phase === 'setup') {
      if (this.legal.some((a) => a.type === 'setupDepot')) return { mine: true, text: 'Поставьте своё пятое депо: щёлкните город на поле' };
      if (this.legal.length) return { mine: true, text: 'Подготовка: выберите стартовые маршруты' };
      const w = [...new Set([...(v.setup.waiting || []), ...(v.setup.depotOrder?.length ? [v.setup.depotOrder[0]] : [])])];
      return { text: 'Подготовка. Ждём: ' + w.map(name).join(', ') };
    }
    const last = v.endAfterTurnNo != null ? ` · последний круг (ещё ${Math.max(0, v.endAfterTurnNo - v.turnNo)} ${plural(Math.max(0, v.endAfterTurnNo - v.turnNo), 'ход', 'хода', 'ходов')})` : '';
    if (v.turn === me) {
      if (v.ts.drawn === 1) return { mine: true, text: 'Возьмите вторую карту' + last };
      if (this.mode === 'station') return { mine: true, text: 'Выберите город для станции' };
      const opts = ['карты', 'перегон'];
      if (this.legal.some((a) => a.type === 'tickets' || a.type === 'ticketRow')) opts.push('маршруты');
      if (this.legal.some((a) => a.type === 'station')) opts.push('станция');
      return { mine: true, text: 'Ваш ход: ' + opts.slice(0, -1).join(', ') + ' или ' + opts[opts.length - 1] + last };
    }
    return { text: `Ходит ${name(v.turn)}` + last };
  }

  renderLeft() {
    const myDone = this.view.me >= 0 && this.view.tickets ? [...this.doneTickets()] : [];
    const myPts = myDone.reduce((a, id) => a + this.M.tickets[id].points, 0);
    const myScore = (track) => h('span.score', { title: `Очки на треке: ${track}. Выполненные маршруты: +${myPts} (${myDone.length} шт.) — видите только вы, начислятся в конце партии. Невыполненные маршруты, цели и бонусы тоже считаются в конце.` },
      track, myPts ? h('small.tix', ` +${myPts}`) : null);
    const v = this.view; const M = this.M; const info = this.ctrl.seatsInfo();
    const waiting = new Set(v.pending ? [v.pending.seat] : v.phase === 'setup' ? v.setup.waiting : [v.turn]);
    const isHost = this.ctrl.mode === 'host';
    const stat = (ic, val, title) => h('span.st', { title }, icon(ic, title, 14), ' ', val);
    const top = Math.max(...v.score);
    const lead = v.phase === 'over' && v.result ? [v.result.order[0]] : top > 0 ? v.score.map((x, i) => (x === top ? i : -1)).filter((i) => i >= 0) : [];
    const botBadge = (level) => {
      const B = BOTS[level] || { name: 'бот', rank: 0, desc: '' };
      const tip = `Бот «${B.name}»` + (B.rank ? ` — уровень ${B.rank} из 4` : '') + (B.desc ? `: ${B.desc}` : '');
      return h('span.botlv', { title: tip, 'aria-label': tip }, icon(BOTS[level] ? 'bot_' + level : 'bot', null, 20));
    };
    const wonGoals = (s) => (v.phase === 'over' && v.result ? v.result.rows[s].goals.map((g) => g.id) : v.goals.open.filter((g) => v.goals.race[g] === s)).map((g) => M.goals[g]);
    const pls = h('div.players', v.players.map((p, s) => {
      const si = info[s] || {};
      const bot = si.kind === 'bot' || (si.kind == null && p.bot);
      if (bot && !si.level) si.level = p.bot || 'medium';
      const online = bot || this.ctrl.mode === 'local' || this.ctrl.online.has(s);
      const bubble = this.bubbles[s] && Date.now() - this.bubbles[s].t < 6000 ? h('span.bubble', this.bubbles[s].text) : null;
      const ch = v.chain[s];
      const stats = [
        stat('wagon', v.trains[s], 'Вагонов осталось. Когда у кого-то останется 2 или меньше — последний круг'),
        stat('cards', v.handCounts[s], 'Карт составов в руке'),
        stat('ticket', v.ticketCounts[s], 'Маршрутов (какие — видно только владельцу)'),
        v.cfg.stations > 0 ? stat('station', v.stationsLeft[s], 'Станций осталось; неиспользованная в конце даёт +4') : null,
        (() => { const tk = Object.entries(v.terminus || {}).filter(([, x]) => x === s).map(([c]) => M.cities[c].name); return tk.length ? h('span.st', { title: `Жетоны конечных станций (по 3 очка в конце): ${tk.join(', ')}` }, h('span.tokdot', { style: { background: playerColor(p.color) } }), ' ', tk.length) : null; })(),
        v.cfg.modules.tourism ? stat('postcard', v.postcardCounts[s], 'Туристических открыток') : null,
        v.cfg.modules.routeCards && v.routeCardCounts[s] ? stat('question', v.routeCardCounts[s], 'Путевых карт на руке') : null,
        v.cfg.modules.depots ? stat('warehouse', v.warehouseCounts[s], 'Карт на складе игрока (1921)') : null,
        v.cfg.modules.depots ? stat('depot', v.depotsHome[s], 'Депо у склада: больше всех в конце — +10') : null,
        ch && ch.routes?.length > 1 ? stat('express', `${ch.len} ваг.`, `Сквозной экспресс: цепочка ${ch.len} вагонов. Продолжите следующим ходом тем же цветом`) : null,
      ];
      const hostBtns = isHost && s !== v.me ? (bot
        ? h('button.link.small', { onclick: async () => { if (await confirmBox('Вернуть место', `Отдать место «${si.name}» человеку? Игрок вернётся по своему коду возврата.`)) this.ctrl.giveBack(s); } }, 'вернуть человеку')
        : !online ? h('button.link.small', { onclick: () => this.replaceDialog(s) }, 'заменить ботом') : null) : null;
      return h('div.pl' + (waiting.has(s) && v.phase !== 'over' ? '.turn' : ''), { 'data-seat': s, style: { '--pc': playerColor(p.color) } },
        h('div.nm', h('span.on' + (online ? '.yes' : ''), { title: online ? 'в сети' : 'не в сети' }), pdot(p.color), /^\s*змеючка\s*$/i.test(si.name || p.name) ? h('span.kkname', { onclick: () => this.kkSend() }, si.name || p.name) : (si.name || p.name),
          bot ? botBadge(si.level) : null,
          lead.includes(s) ? h('span.crown', { title: v.phase === 'over' ? 'Победитель' : (lead.length > 1 ? 'Делит лидерство по очкам на треке' : 'Лидер по очкам на треке') + ' (маршруты, цели и бонусы считаются в конце)' }, '♛') : null,
          s === v.me ? h('span.badge.gold', 'вы') : null,
          s === v.me && v.phase !== 'over' ? myScore(v.score[s]) : h('span.score', { title: 'Очки на треке: перегоны, сквозной экспресс, электрификация. Маршруты, цели и бонусы добавятся в конце партии' }, v.score[s])),
        h('div.stats', stats),
        wonGoals(s).length ? h('div.wongoals', wonGoals(s).map((G) => h('span.wongoal', { title: `Цель выполнена: «${G.name}» — +${G.points} очк. (${v.cfg.duelOn ? G.race : G.rule})` }, icon('trophy', null, 14), ' ', G.name, h('b', ` +${G.points}`)))) : null,
        hostBtns, bubble);
    }));
    const goals = v.goals.open.map((g) => {
      const G = M.goals[g]; const won = v.goals.race[g];
      return h('div.goal' + (won != null ? '.won' : ''), icon('goal', null, 14), ' ', h('b', G.name), ` · ${G.points} очк. `, ruleLink('goals', 'Цели в правилах'),
        h('div.small', v.cfg.duelOn ? `Гонка: ${G.race}` : G.rule), won != null ? h('div.small', '✓ ', v.players[won].name) : null);
    });
    const hidden = v.goals.total - v.goals.open.length;
    this.logEl = h('div.log', this.ctrl.events.slice(-150).map((e) => this.logLine(e)));
    fill(this.left, h('h4', 'Игроки'), pls,
      v.goals.total ? h('h4', 'Цели') : null, ...goals, hidden > 0 ? h('div.small.muted', 'Третья цель откроется, когда у кого-то останется 15 вагонов') : null,
      h('h4', 'Журнал ', h('span.small.muted', '— наведите на строку, чтобы увидеть ход на поле')), this.logEl);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  /** Строка журнала: пиктограмма действия, цвет игрока, цветные карты, подсветка на поле при наведении. */
  logLine(e) {
    const v = this.view; const M = this.M;
    const priv = e.vis !== undefined && e.vis !== 'all';
    const cls = e.kind === 'turn' ? '.turn' : e.kind === 'chat' ? '.chat' : priv ? '.priv' : '';
    const pc = e.seat != null && v.players[e.seat] ? playerColor(v.players[e.seat].color) : null;
    const chips = [];
    const cardChip = (c) => h('span.cchip' + (c === 'loco' ? '.loco' : ''), { style: c === 'loco' ? {} : { background: M.colors[c] }, title: c === 'loco' ? 'Локомотив' : '' });
    if (e.card) chips.push(cardChip(e.card));
    for (const c of e.cards || []) chips.push(cardChip(c));
    if (e.kind === 'claim' && e.pay) { for (let i = 0; i < Math.min(e.pay.n, 6); i++) chips.push(cardChip(e.pay.color)); for (let i = 0; i < Math.min(e.pay.loco, 4); i++) chips.push(cardChip('loco')); }
    let title = '';
    if (e.kind === 'claim' && e.pts) {
      title = `${e.pts.len} ${plural(e.pts.len, 'вагон', 'вагона', 'вагонов')} — ${e.pts.base} очк.` + (e.pts.chain ? `; сквозной экспресс (${e.pts.chainLen} ваг.): +${e.pts.chain}` : '') + (e.pts.elec ? '; электрификация: +1' : '');
    }
    const rule = KIND_RULE[e.kind] ? ruleLink(e.kind === 'claim' && e.pts?.chain ? 'chain' : KIND_RULE[e.kind], 'Что это значит — в правилах') : null;
    const line = h('div.le' + cls, { title, style: pc ? { '--pc': pc } : {} },
      KIND_ICON[e.kind] ? icon(KIND_ICON[e.kind], null, 14) : h('span.ico'), pc && e.kind !== 'turn' ? h('span.lbar') : null,
      h('span.lt', e.text), chips.length ? h('span.chips', chips) : null, rule);
    if (e.route || e.city) {
      line.classList.add('hov');
      let fx = null;
      line.addEventListener('mouseenter', () => {
        const col = pc || '#FFB300';
        fx = e.route ? this.board.flashRoute(e.route, col, null, Infinity, 'pulse') : this.board.flashCity(e.city, col, null, Infinity, 'pulse');
      });
      line.addEventListener('mouseleave', () => { fx?.stop(); fx = null; });
      line.addEventListener('click', () => {
        const r = e.route ? M.routes[e.route] : null;
        this.board.focus(r ? [r.from, r.to] : [e.city]);
      });
    }
    return line;
  }

  /** Новые события: анимации карт и подсветка ходов соперников на поле. */
  playEvents() {
    const evs = this.ctrl.events;
    if (this.seenEv > evs.length) this.seenEv = evs.length;
    const fresh = evs.slice(this.seenEv);
    this.seenEv = evs.length;
    if (!fresh.length || fresh.length > 14) return; // при загрузке истории не анимируем
    const v = this.view; const me = v.me; const M = this.M;
    const name = (s) => this.ctrl.seatsInfo()[s]?.name || v.players[s]?.name || '';
    const col = (s) => (v.players[s] ? playerColor(v.players[s].color) : '#FFB300');
    const panel = (s) => this.left.querySelector(`.pl[data-seat="${s}"]`);
    const handZone = () => this.bottom.querySelector('.hand') || this.bottom;
    const market = () => this.right.querySelector('.market');
    const deckEl = () => this.right.querySelector('.card.back');
    const sec = prefs.flashSec; const mode = prefs.flashMode;
    let d = 0, rcDelay = 0;
    for (const e of fresh) {
      const s = e.seat;
      const mine = s === me;
      // путевая карта: крупная карточка по центру поля, затем улетает к игроку
      if (e.kind === 'routeCard' && s != null && !e.void && (e.id || !mine)) {
        const ev = e.id ? M.events[e.id] : null;
        const KIND = { keep: 'остаётся в руке — сыграйте, когда нужно', leader: 'бьёт лидера', all: 'действует на всех', self: 'срабатывает сразу' };
        const card = h('div.rc-splash' + (ev ? '.k-' + ev.kind : '.k-hidden'), { style: { '--pc': col(s) } },
          h('div.rc-top', icon('question', null, 22), ' Путевая карта'),
          h('div.rc-who', mine ? 'Вы получили' : name(s)),
          ev ? [h('div.rc-name', ev.name), h('div.rc-text', ev.text), h('div.rc-kind', KIND[ev.kind])] : [h('div.rc-name', '?'), h('div.rc-text', 'Карта остаётся у игрока в руке')]);
        splash(card, this.boardBox, mine ? this.bottom.querySelector('.rcards') || this.bottom : panel(s), { delay: rcDelay, hold: ev ? 2800 : 1400 });
        rcDelay += ev ? 3400 : 2000;
      }
      if (e.kind === 'draw') {
        if (e.source === 'up' && e.card) {
          const slot = market()?.children[e.index ?? 0];
          const target = mine ? handZone() : panel(s);
          fly(cardEl(M, e.card), slot, target, { delay: d }).then(() => bump(target));
          d += 120;
        } else if (e.source === 'up' && e.cards) {
          e.cards.forEach((c, i) => fly(cardEl(M, c), market()?.children[i], mine ? handZone() : panel(s), { delay: d + i * 120 }));
        } else if (e.source === 'deck' && e.own && mine) {
          fly(cardEl(M, e.card), deckEl(), handZone(), { delay: d, hold: Math.round(prefs.animMs * 0.8) }).then(() => bump(handZone()));
          d += 120;
        } else if (e.source === 'deck' && !mine && !e.own) {
          fly(backEl(''), deckEl(), panel(s), { delay: d }).then(() => bump(panel(s)));
          d += 120;
        }
      } else if (e.kind === 'claim' && e.route) {
        const to = this.board.screenPoint('route', e.route);
        const from = mine ? handZone() : panel(s);
        const cards = [...Array(Math.min(e.pay?.n || 0, 4)).fill(e.pay?.color), ...Array(Math.min(e.pay?.loco || 0, 2)).fill('loco')].filter(Boolean);
        cards.forEach((c, i) => fly(cardEl(M, c), from, to, { delay: d + i * 90, scaleTo: 0.3 }));
        const total = (e.pts?.base || 0) + (e.pts?.chain || 0) + (e.pts?.elec || 0);
        if (!mine) this.board.flashRoute(e.route, col(s), `${name(s)}: +${total}${e.pts?.chain ? ' экспресс' : ''}`, sec, mode);
        else if (sec) this.board.flashRoute(e.route, col(s), `+${total}`, Math.min(2, sec), 'label');
      } else if (e.kind === 'station' && e.city) {
        const to = this.board.screenPoint('city', e.city);
        fly(h('span.flyico', icon('station', null, 26)), mine ? handZone() : panel(s), to, { delay: d, scaleTo: 0.8 });
        if (!mine) this.board.flashCity(e.city, col(s), `${name(s)}: станция`, sec, mode);
      } else if ((e.kind === 'depot') && e.city && !mine) {
        this.board.flashCity(e.city, col(s), `${name(s)}: депо`, sec, mode);
      } else if (e.kind === 'tunnel' && e.route && !e.declined && !mine) {
        this.board.flashRoute(e.route, col(s), `${name(s)}: погранконтроль`, Math.min(sec, 4), mode === 'all' ? 'label' : mode);
      } else if (e.kind === 'tickets') {
        const src = this.right.querySelector('.tdeck') || deckEl();
        fly(h('span.flyico', icon('ticket', null, 28)), src, mine ? this.bottom.querySelector('.tlist') || this.bottom : panel(s), { delay: d });
      } else if (e.kind === 'turn' && s != null) {
        setTimeout(() => bump(panel(s)), d + 200);
      } else if (e.kind === 'goal' || e.kind === 'lastRound' || e.kind === 'routeCard' && e.id && e.vis === 'all' && !mine) {
        toast(e.text, 'info', 5200);
      }
    }
  }

  renderRight() {
    const v = this.view; const M = this.M; const me = v.me;
    const draws = this.legal.filter((a) => a.type === 'draw');
    const canUp = (i) => draws.some((a) => a.source === 'up' && a.index === i);
    const canDeck = draws.some((a) => a.source === 'deck');
    const R = clear(this.right);
    R.append(h('h4', 'Открытые карты'));
    R.append(h('div.market', v.faceUp.map((c, i) => cardEl(M, c, { off: !canUp(i), onclick: () => this.draw({ source: 'up', index: i }) })),
      backEl(`Колода\n${v.deckCount}`, { off: !canDeck, onclick: () => this.draw({ source: 'deck' }), title: 'Взять карту вслепую' })));
    if (v.cfg.modules.depots && v.phase === 'play') {
      if (this.whTarget == null) this.whTarget = me;
      R.append(h('label.small.row', 'Из колоды — сначала карту на склад:', h('select', { onchange: (e) => { this.whTarget = Number(e.target.value); } },
        v.players.map((p, s) => h('option', { value: s, selected: s === this.whTarget }, `${p.name} (${v.warehouseCounts[s]})`)))));
    }
    R.append(h('div.small.muted.tdeck', `Сброс: ${v.discardCount} · маршрутов в колоде: ${v.ticketDeckCount}` + (v.cfg.modules.routeCards ? ` · путевых карт: ${v.routeCardDeckCount}` : '')));
    if (v.cfg.duelOn && v.ticketRow.length) {
      const can = this.legal.some((a) => a.type === 'ticketRow');
      R.append(h('h4', 'Открытые маршруты (дуэль)'), h('div.tlist', v.ticketRow.map((id, i) => ticketEl(M, id, {
        sel: this.duelPicks.has(i), onenter: () => this.highlight([M.tickets[id].from, M.tickets[id].to], true), onleave: () => this.highlight([]),
        onclick: () => { if (!can) return; this.duelPicks.has(i) ? this.duelPicks.delete(i) : this.duelPicks.size < 2 && this.duelPicks.add(i); this.render(); },
      }))), h('button', { disabled: !can || !this.duelPicks.size, onclick: () => { const p = [...this.duelPicks]; this.duelPicks.clear(); this.act({ type: 'ticketRow', picks: p }); } }, `Взять выбранные (${this.duelPicks.size})`));
    }
    const has = (t) => this.legal.find((a) => a.type === t);
    const st = has('station');
    R.append(h('h4', 'Действия'), h('div.acts',
      h('button', { disabled: !has('tickets'), onclick: () => this.act({ type: 'tickets' }), title: 'Взять 3 маршрута, оставить хотя бы 1 (весь ход)' }, icon('ticket'), ' Взять маршруты'),
      v.cfg.stations > 0 ? h('button', { disabled: !st, onclick: () => this.setMode('station'), title: st ? `Станция стоит ${st.cost} карт(ы) одного цвета; в конце позволяет использовать один чужой перегон из города` : 'Станций не осталось' }, icon('station'), ` Станция${st ? ` (${st.cost})` : ''}`) : null,
      h('button', { disabled: !has('swap'), onclick: () => swapDialog(this), title: 'Сбросить 1–5 карт и взять столько же из колоды (весь ход)' }, icon('swap'), ' Сменить состав'),
      v.cfg.modules.depots ? h('button', { disabled: !has('placeDepot'), onclick: () => this.setMode('depot'), title: 'Бесплатно поставить депо со склада в город без депо (ход продолжается)' }, icon('depot'), ' Поставить депо') : null,
      has('vitrina') ? h('button', { onclick: () => vitrinaDialog(this) }, '«Витрина»') : null,
      has('fromDiscard') ? h('button', { onclick: () => fromDiscardDialog(this) }, '«Со склада»') : null,
      has('pass') ? h('button', { onclick: () => this.act({ type: 'pass' }) }, v.endAfterTurnNo != null ? 'Пропустить последний ход' : 'Пропустить ход') : null));
    if (this.ctrl.mode === 'local' && this.ctrl.seatsInfo().some((x) => x.kind === 'bot')) R.append(h('label.row.small', h('input', { type: 'checkbox', checked: this.ctrl.fast, onchange: (e) => this.ctrl.setFast(e.target.checked) }), 'Боты ходят быстро'));
    if (v.endAfterTurnNo != null && v.phase !== 'over') R.append(h('div.banner.last', 'Последний круг!'));
    if (this.ctrl.mode === 'guest' && this.ctrl.presenceSeen && !this.ctrl.hostOnline && v.phase !== 'over') R.append(h('div.banner.warn', 'Хозяин не в сети. Ходы сохранятся и будут обработаны, когда он вернётся.'));
    if (this.ctrl.mode !== 'local' && this.ctrl.returnCode) R.append(h('div.small.muted', 'Ваш код возврата: ', h('span.code', this.ctrl.returnCode), ' ', h('button.link.small', { onclick: () => copyText(this.ctrl.returnCode) }, 'копировать')));
  }

  renderBottom() {
    const v = this.view; const M = this.M; const me = v.me;
    const B = clear(this.bottom);
    if (me < 0 || !v.hand) return;
    B.append(h('div', h('h4', 'Ваши карты'), h('div.hand', CARD_TYPES.filter((c) => v.hand[c] > 0).map((c) => cardEl(M, c, { n: v.hand[c], title: `${c === 'loco' ? 'Локомотив — заменяет любой цвет' : COLOR_NAMES[c] + ' — для перегонов этого цвета и серых'}: ${v.hand[c]} шт.` })), !CARD_TYPES.some((c) => v.hand[c] > 0) ? h('span.muted.small', 'пусто') : null)));
    const done = this.doneTickets();
    const helped = this.stationHelped();
    const tix = v.tickets[me] || [];
    B.append(h('div', h('h4', `Маршруты (${done.size}/${tix.length})`), h('div.tlist', tix.map((id) => {
      const t = M.tickets[id];
      return ticketEl(M, id, { done: done.has(id), extra: helped.has(id) ? h('span.small', { title: 'Выполнен с помощью станции (чужой перегон отмечен пунктиром на поле)' }, ' 🏠') : null, onenter: () => this.highlight([t.from, t.to], true), onleave: () => this.highlight([]), onclick: () => this.board.focus([t.from, t.to]) });
    }))));
    if (v.cfg.modules.tourism) {
      const pcs = v.postcards[me] || [];
      B.append(h('div', h('h4', 'Открытки'), h('div.pcards', pcs.map((id) => { const el = postcardEl(M, id, { done: this.touches(M.postcards[id].city), onenter: () => this.highlight([M.postcards[id].city], true), onleave: () => this.highlight([]) }); el.addEventListener('dblclick', () => cityDialog(this, M.postcards[id].city)); return el; }))));
    }
    const rc = v.routeCards[me] || [];
    if (v.cfg.modules.routeCards) {
      const used = (v.routeCardsUsed || [])[me] || [];
      const KIND = { keep: 'в руку', leader: 'бьёт лидера', all: 'всем', self: 'себе' };
      B.append(h('div.rcards', h('h4', 'Путевые карты'), h('div.tlist',
        rc.map((id) => h('div.ticket.rcard', { title: `${M.events[id].text}. Карта у вас в руке — сыграйте, когда нужно` }, icon('question', null, 14), ' ', M.events[id].name)),
        used.map((id) => h('div.ticket.rcard.used', { title: `Сыграна (${KIND[M.events[id].kind]}): ${M.events[id].text}` }, icon('question', null, 14), ' ', M.events[id].name, h('span.pts', '✓'))),
        !rc.length && !used.length ? h('span.muted.small', 'нет') : null)));
    }
    const flags = v.flags[me] || {};
    const f = [];
    if (flags.blindOnly != null) f.push('«Скот на путях»: в следующий ход карты только из колоды');
    if (flags.extraCard) f.push('«Выгиб рельсов»: следующий перегон дороже на 1 карту');
    if (f.length) B.append(h('div.banner.warn', f.join('. ')));
  }

  /** Станции: какой чужой перегон каждая «берёт». Свои — лучший выбор сейчас; после конца партии — у всех. */
  computeStations() {
    const v = this.view; const M = this.M;
    this.stationRoutes = []; this.myNet = null;
    if (v.phase === 'over' && v.result) {
      for (const r of v.result.rows) (r.stationRoutes?.routes || []).forEach((rid) => { if (rid) this.stationRoutes.push({ route: rid, seat: r.seat }); });
    }
    if (v.me < 0) return;
    const own = Object.keys(v.claims).filter((r) => v.claims[r] === v.me).map((r) => M.routes[r]);
    const mine = Object.keys(v.stationsAt || {}).some((c) => v.stationsAt[c].includes(v.me));
    if (!mine) { this.myNet = own; this.stationPick = null; return; }
    try {
      const plan = bestStationUse(M, stateFromView(v), v.me);
      this.myNet = plan.net; this.stationPick = plan;
      if (v.phase !== 'over') plan.routes.forEach((rid) => { if (rid) this.stationRoutes.push({ route: rid, seat: v.me }); });
    } catch (err) { console.warn(err); this.myNet = own; }
  }
  doneTickets() {
    const v = this.view; const M = this.M;
    const comp = components(this.myNet || []);
    return new Set((v.tickets[v.me] || []).filter((id) => comp.same(M.tickets[id].from, M.tickets[id].to)));
  }
  /** Маршруты, выполненные только благодаря станциям. */
  stationHelped() {
    const v = this.view; const M = this.M;
    const own = components(Object.keys(v.claims).filter((r) => v.claims[r] === v.me).map((r) => M.routes[r]));
    const done = this.doneTickets();
    return new Set([...done].filter((id) => !own.same(M.tickets[id].from, M.tickets[id].to)));
  }
  touches(city) { const v = this.view; return components(this.myNet || []).has(city) || (v.stationsAt[city] || []).includes(v.me); }

  // ---------- действия ----------
  async act(a) {
    const res = await this.ctrl.submit(a);
    if (!res.ok) toast(res.error, res.queued ? 'info' : 'err');
    return res;
  }
  draw(a) {
    if (this.view.cfg.modules.depots && a.source === 'deck') a.wh = this.whTarget ?? this.view.me;
    return this.act({ type: 'draw', ...a });
  }
  clickRoute(rid) {
    const v = this.view;
    if (this.mode) return;
    if (!this.isMine || v.phase !== 'play' || v.pending || v.ts.drawn) {
      if (v.turn !== v.me || v.phase !== 'play') toast('Сейчас не ваш ход');
      else if (v.ts.drawn) toast('Сначала возьмите вторую карту');
      return;
    }
    this.claimDlg?.close(); // одно окно оплаты за раз: щелчок по другому перегону заменяет окно
    this.select(rid);
    claimDialog(this, rid);
  }
  select(rid) { this.selRoute = rid; this.render(); }
  // ---------- пасхалка «Змеючка»: случайное фото из img/kk у всех игроков в комнате ----------
  async kkList() {
    if (this._kk) return this._kk;
    let list = await fetch('img/kk/list.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!Array.isArray(list) || !list.length) {   // списка нет — пробуем 1.jpg, 2.jpg, … подряд
      list = [];
      const ok = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(true); im.onerror = () => res(false); im.src = src; });
      for (let n = 1; n <= 60; n++) {
        const f = (await Promise.all(['jpg', 'png', 'jpeg', 'webp'].map(async (x) => ((await ok(`img/kk/${n}.${x}`)) ? `${n}.${x}` : null)))).find(Boolean);
        if (!f) break;
        list.push(f);
      }
    }
    return (this._kk = list);
  }
  async kkSend() {
    const list = await this.kkList();
    if (!list.length) return toast('В папке img/kk пока нет картинок');
    const file = list[Math.floor(Math.random() * list.length)];
    const id = Math.random().toString(36).slice(2);
    this.kkShow({ file, id });
    this.ctrl.sendKk?.({ file, id });
  }
  kkShow(m) {
    if (!m || m.id === this._kkLast || !/^[\w\-. ()]+\.(jpe?g|png|webp|gif)$/i.test(m.file || '')) return;
    this._kkLast = m.id;
    document.querySelector('.kk-over')?.remove();
    const over = h('div.kk-over', { onclick: () => over.remove() }, h('img', { src: 'img/kk/' + encodeURIComponent(m.file), alt: '', onerror: () => over.remove() }));
    document.body.append(over);
    setTimeout(() => over.remove(), 8000);
  }
  clickCity(cid) {
    const v = this.view;
    // двойной клик (или двойное касание) по городу — окно «О городе»
    const now = Date.now();
    if (!this.mode && this.lastCity?.id === cid && now - this.lastCity.t < 450) { this.lastCity = null; return cityDialog(this, cid); }
    this.lastCity = { id: cid, t: now };
    if (this.mode === 'station') {
      const st = this.legal.find((a) => a.type === 'station');
      if (!st || !st.cities.includes(cid)) return toast('Здесь станцию поставить нельзя');
      this.setMode(null); stationDialog(this, cid, st.cost);
    } else if (this.mode === 'depot' || this.mode === 'setupDepot') {
      if (v.depots[cid] != null) return toast('В этом городе уже есть депо');
      const type = this.mode === 'depot' ? 'placeDepot' : 'setupDepot';
      this.setMode(null); this.act({ type, city: cid });
    } else {
      this.highlight(this.hl.includes(cid) ? [] : [cid], true);
    }
  }
  pickableCities() {
    const v = this.view;
    if (this.mode === 'station') return new Set(this.legal.find((a) => a.type === 'station')?.cities || []);
    return new Set(this.M.cityList.filter((c) => v.depots[c.id] == null).map((c) => c.id));
  }
  setMode(m) {
    this.mode = m;
    const text = { station: 'Щёлкните город для станции', depot: 'Щёлкните город без депо', setupDepot: 'Поставьте пятое депо: щёлкните город без депо' }[m];
    this.banner.replaceChildren(tr(text || ''), m && m !== 'setupDepot' ? h('button', { onclick: () => this.setMode(null) }, 'Отмена') : '');
    this.banner.classList.toggle('hidden', !m);
    this.render();
  }
  highlight(cities, pin) { this.hl = cities; if (pin !== undefined) this.hlPinned = pin; this.board.update(this.view, { sel: this.selRoute, hl: this.hl, can: this.canSet(), pickCities: this.mode ? this.pickableCities() : null, stationRoutes: this.stationRoutes }); }
  canSet() { const s = new Set(); const v = this.view; if (this.isMine && v.ts.drawn === 0 && v.phase === 'play' && !v.pending) for (const a of this.legal) if (a.type === 'claim') s.add(a.route); return s; }

  autoDialogs() {
    const v = this.view;
    // решение уже принято за игрока (бот по таймеру, замена ботом) — закрыть устаревшее окно
    if (this.autoDlg && !this.legal.some((x) => x.type === this.autoDlg.kind)) { this.autoDlg.dlg?.close(); this.autoDlg = null; }
    // окно оплаты перегона больше не актуально: ход сделан (в т.ч. ботом за игрока), перегон занят или ход перешёл
    if (this.claimDlg && !this.legal.some((x) => x.type === 'claim' && x.route === this.claimDlg.route)) this.claimDlg.close();
    // «осиротевшие» окна оплаты (на случай двойного открытия) — убрать
    for (const m of document.querySelectorAll('.modal.claim')) if (!this.claimDlg || m !== this.claimDlg.el) m.closest('.modal-back')?.remove();
    if (document.querySelector('.modal-back')) return;
    const key = (k) => `${k}:${v.seq}`;
    const a = this.legal[0];
    if (!a) return;
    if (a.type === 'setupTickets' && this.dlgKey !== key('st')) {
      this.dlgKey = key('st');
      this.autoDlg = { kind: a.type }; this.autoDlg.dlg = ticketsDialog(this, { title: 'Стартовые маршруты', offer: a.offer, min: a.min, maxLong: a.maxLong, onDone: (t) => this.act({ type: 'setupTickets', tickets: t }) });
    } else if (a.type === 'setupPostcards' && this.dlgKey !== key('sp')) {
      this.dlgKey = key('sp');
      this.autoDlg = { kind: a.type }; this.autoDlg.dlg = ticketsDialog(this, { title: 'Туристические открытки', offer: [], min: 0, postOffer: a.offer, postMin: a.min, onDone: (_, p) => this.act({ type: 'setupPostcards', postcards: p }) });
    } else if (a.type === 'setupDepot' && this.mode !== 'setupDepot') {
      this.setMode('setupDepot');
    } else if (a.type === 'keep' && this.dlgKey !== key('k')) {
      this.dlgKey = key('k');
      this.autoDlg = { kind: a.type }; this.autoDlg.dlg = ticketsDialog(this, { title: 'Новые маршруты', offer: a.offer, min: a.min, postOffer: a.postOffer, onDone: (t, p) => this.act({ type: 'keep', tickets: t, postcards: p }) });
    } else if (a.type === 'tunnelPay' && this.dlgKey !== key('t')) {
      this.dlgKey = key('t'); this.autoDlg = { kind: a.type, dlg: tunnelDialog(this) };
    } else if (a.type === 'discard' && this.dlgKey !== key('d')) {
      this.dlgKey = key('d'); this.autoDlg = { kind: a.type, dlg: discardDialog(this) };
    }
  }

  tick() {
    const v = this.view;
    if (!v || v.phase === 'over') { this.timerEl.textContent = ''; return; }
    const lim = (v.cfg.turnTimer || 0) * 60;
    const el = Math.floor((Date.now() - this.waitSince) / 1000);
    if (!lim) { this.timerEl.textContent = ''; return; }
    const left = lim - el;
    this.timerEl.textContent = left > 0 ? `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : tr('⏱ время вышло');
    if (left <= 0 && this.ctrl.mode === 'host' && !this.forceShown) {
      const seat = v.pending ? v.pending.seat : v.phase === 'play' ? v.turn : null;
      const info = this.ctrl.seatsInfo()[seat];
      if (seat != null && seat !== v.me && info?.kind === 'human') {
        this.forceShown = true;
        modal({ title: 'Время хода вышло', body: h('p', `Сделать ход за игрока «${info.name}» ботом «Средний»?`), buttons: [{ text: 'Ждать', onClick: (c) => { c(); this.waitSince = Date.now(); this.forceShown = false; } }, { text: 'Сходить ботом', primary: true, onClick: (c) => { c(); this.forceShown = false; this.waitSince = Date.now(); this.ctrl.forceBotMove(seat); } }], onClose: () => { this.forceShown = false; } });
      }
    }
  }

  replaceDialog(seat) {
    const name = this.ctrl.seatsInfo()[seat]?.name;
    let level = 'medium';
    modal({
      title: 'Заменить ботом', body: [h('p', `Игрок «${name}» не в сети. Бот продолжит с его картами и маршрутами. Если игрок вернётся, место можно отдать ему обратно.`),
        h('select', { onchange: (e) => { level = e.target.value; } }, Object.entries(BOTS).map(([k, b]) => h('option', { value: k, selected: k === 'medium' }, b.name)))],
      buttons: [{ text: 'Отмена', onClick: (c) => c() }, { text: 'Заменить', primary: true, onClick: (c) => { c(); this.ctrl.replaceWithBot(seat, level); } }],
    });
  }

  menu() {
    const items = [
      h('button', { onclick: () => { m.close(); this.board.fit(); } }, 'Отдалить до краёв поля'),
      this.view?.phase === 'over' ? h('button', { onclick: () => { m.close(); showResults(this); } }, 'Итоги партии') : null,
      h('button', { onclick: () => { m.close(); this.exit(); } }, 'Выйти на главную'),
      h('button.danger', { onclick: () => { m.close(); this.deleteGame(); } }, this.ctrl.mode === 'guest' ? 'Убрать партию из моего списка' : 'Удалить партию'),
    ];
    const m = modal({ title: 'Меню', body: h('div.col', items, this.ctrl.mode !== 'local' ? h('p.small.muted', 'Партия сохраняется на сервере: вернуться можно с главной страницы или по коду возврата.') : h('p.small.muted', 'Партия с ботами сохраняется в этом браузере.')) });
  }
  async deleteGame() {
    const c = this.ctrl;
    if (c.mode === 'local') {
      if (!await confirmBox('Удалить партию', 'Удалить эту партию с ботами? Продолжить её будет нельзя.', 'Удалить')) return;
      this.close(); clearOffline(); this.app.go('#/');
    } else if (c.mode === 'host') {
      if (!await confirmBox('Удалить партию', 'Удалить партию на сервере для всех игроков? Её нельзя будет продолжить; гости увидят сообщение об удалении.', 'Удалить')) return;
      try { await c.deleteRoom(); } catch (e) { toast('Не удалось удалить: ' + e.message, 'err', 7000); return; }
      dropSession(c.backendKind, c.room.id); this.exit(); toast('Партия удалена', 'ok');
    } else {
      if (!await confirmBox('Убрать из списка', 'Убрать партию из списка на этом устройстве? Удалить её для всех может только хозяин. Вернуться можно по коду комнаты и коду возврата.', 'Убрать')) return;
      dropSession(c.backendKind, c.room.id); this.exit();
    }
  }
  exit() { this.close(); this.app.go('#/'); }
  close() { clearInterval(this.timer); this.off?.(); this.ctrl.close(); }
}
