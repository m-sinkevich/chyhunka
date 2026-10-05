// Хозяин сетевой партии: браузер-арбитр. Держит полное состояние, применяет ходы гостей и ботов,
// одним вызовом commit_turn пишет host_state, public_state, private_views и события.
import { GameRunner } from './runner.js';
import { newSeed } from '../engine/rng.js';

const INDEX_ACTIONS = new Set(['vitrina', 'ticketRow']); // действия с номерами открытых карт — только по свежему состоянию

export class HostGame {
  constructor(E, api, room, seats, state, mySeatDb = 0) {
    this.E = E; this.api = api; this.room = room; this.mode = 'host';
    this.listeners = new Set(); this.events = []; this.online = new Set();
    this.seatsDb = seats; this.outbox = { events: [], acts: [] }; this.flushing = false; this.status = 'ok';
    this.mySeatDb = mySeatDb;
    this.setState(state);
    this.runner = new GameRunner(E, state, {
      kinds: this.kindsFromSeats(),
      botDelay: () => 900 + Math.random() * 900,
      persist: (st, events, meta) => this.persist(st, events, meta),
      onApplied: () => this.emit('view'),
    });
  }
  setState(st) { this.st0 = st; this.map = st.players.map((p) => p.dbSeat); this.seat = this.map.indexOf(this.mySeatDb); }
  get state() { return this.runner ? this.runner.st : this.st0; }
  engineSeat(db) { return this.map.indexOf(db); }
  kindsFromSeats() {
    return this.map.map((db) => {
      const s = this.seatsDb.find((x) => x.seat === db);
      return s && s.kind === 'bot' ? { kind: 'bot', level: s.bot_level || 'medium' } : { kind: 'human' };
    });
  }
  seatsInfo() {
    return this.state.players.map((p, i) => {
      const s = this.seatsDb.find((x) => x.seat === p.dbSeat) || {};
      return { name: s.name || p.name, color: p.color, kind: s.kind || 'human', level: s.bot_level, dbSeat: p.dbSeat };
    });
  }
  on(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
  emit(what) { this.view = this.E.view(this.state, this.seat); for (const f of this.listeners) f(what); }

  /** Новая партия из лобби. */
  static async create(E, api, room, seats, cfg) {
    const players = seats.filter((s) => s.kind !== 'closed').map((s) => ({
      name: s.kind === 'bot' ? s.name || 'Бот' : s.name, color: s.color, bot: s.kind === 'bot' ? s.bot_level : null, dbSeat: s.seat,
    }));
    if (cfg.randomOrder) for (let i = players.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [players[i], players[j]] = [players[j], players[i]]; }
    const st = E.init(cfg, players, newSeed());
    const h = new HostGame(E, api, room, seats, st);
    h.outbox.events.push({ text: `Партия создана: ${players.map((p) => p.name).join(', ')}`, vis: 'all' });
    await h.flush('playing');
    return h;
  }
  /** Продолжить партию (перезагрузка страницы хозяина, другое устройство). */
  static async resume(E, api, room, seats) {
    const [hs] = await api.select('host_state', { room_id: room.id });
    if (!hs) throw new Error('Состояние партии не найдено');
    const mine = seats.find((s) => s.uid === api.uid);
    const h = new HostGame(E, api, room, seats, hs.state, mine ? mine.seat : 0);
    const evs = await api.select('events', { room_id: room.id }, { order: 'id', limit: 1000 });
    h.events = evs.map((e) => ({ text: e.text, seq: e.seq, vis: e.visibility == null ? 'all' : e.visibility, ...(e.data || {}) })).slice(-400);
    return h;
  }

  async start() {
    this.unwatch = this.api.watch(this.room.id, ['actions', 'seats'], (t, row) => {
      if (t === 'actions' && row && row.status === 'pending') this.takeAction(row);
      if (t === 'seats') this.reloadSeats();
      if (t === '*') this.pullPending();
    });
    this.presence = this.api.channel('room:' + this.room.code, { seat: this.mySeatDb, host: true });
    this.presence.onPresence((list) => { this.online = new Set(list.map((m) => this.engineSeat(m.seat)).filter((s) => s >= 0)); this.emit('presence'); });
    this.presence.onBroadcast('chat', (m) => { this.events.push({ text: `${m.name}: «${m.text}»`, kind: 'chat', seat: m.seat }); this.emit('chat'); });
    await this.pullPending();
    this.runner.scheduleBots();
    this.emit('view');
  }
  seen = new Set();
  async pullPending() {
    const rows = await this.api.select('actions', { room_id: this.room.id, status: 'pending' }, { order: 'id' });
    for (const r of rows) this.takeAction(r);
  }
  takeAction(row) {
    if (this.seen.has(row.id)) return;
    this.seen.add(row.id);
    const seat = this.engineSeat(row.seat);
    const a = { ...(row.payload || {}), seat };
    const stale = (INDEX_ACTIONS.has(a.type) || (a.type === 'draw' && a.source === 'up')) && row.base_seq !== this.state.seq;
    if (seat < 0 || stale) {
      this.reject(row.id, seat < 0 ? 'Вы не участвуете в партии' : 'Пока вы выбирали, открытые карты изменились — выберите снова');
      return;
    }
    this.runner.submit(a, { actionId: row.id }).then((r) => { if (!r.ok) this.reject(row.id, r.error); });
  }
  reject(id, error) { this.outbox.acts.push({ id, status: 'rejected', error }); this.flush(); }
  async reloadSeats() {
    this.seatsDb = await this.api.select('seats', { room_id: this.room.id }, { order: 'seat' });
    const kinds = this.kindsFromSeats();
    kinds.forEach((k, i) => this.runner.setKind(i, k.kind, k.level));
    this.emit('seats');
  }
  async persist(st, events, meta) {
    for (const e of events) {
      const { text, vis, ...data } = e;
      this.outbox.events.push({ text, vis: vis === 'all' ? 'all' : this.map[vis], data });
      if (e.vis === 'all' || e.vis === this.seat) this.events.push({ ...e, seq: st.seq });
    }
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
    if (meta.actionId) this.outbox.acts.push({ id: meta.actionId, status: 'applied', error: null });
    await this.flush(st.phase === 'over' ? 'finished' : null);
  }
  /** Отправить накопленное: последнее состояние, события, статусы действий. При ошибке — повтор. */
  async flush(roomStatus = null) {
    if (roomStatus) this.pendingRoomStatus = roomStatus;
    if (this.flushing) { this.again = true; return; }
    this.flushing = true;
    try {
      do {
        this.again = false;
        const st = this.state;
        const events = this.outbox.events.splice(0);
        const acts = this.outbox.acts.splice(0);
        const privates = [];
        for (let i = 0; i < st.n; i++) {
          const s = this.seatsDb.find((x) => x.seat === this.map[i]);
          if (!s || s.kind !== 'bot') privates.push({ seat: this.map[i], view: this.E.view(st, i) });
        }
        const first = acts.shift();
        try {
          if (this.lastSeq !== st.seq || events.length || this.pendingRoomStatus) {
            await this.api.rpc('commit_turn', {
              p_room: this.room.id, p_seq: st.seq, p_host: this.lastSeq === st.seq ? null : st, p_public: this.E.publicView(st),
              p_privates: privates, p_events: events, p_action: first?.id ?? null, p_action_status: first?.status ?? null,
              p_error: first?.error ?? null, p_room_status: this.pendingRoomStatus || null,
            });
            this.lastSeq = st.seq; this.pendingRoomStatus = null;
          } else if (first) acts.unshift(first);
          for (const a of acts) {
            await this.api.rpc('commit_turn', { p_room: this.room.id, p_seq: st.seq, p_host: null, p_public: null, p_privates: [], p_events: [], p_action: a.id, p_action_status: a.status, p_error: a.error, p_room_status: null });
          }
          if (this.status !== 'ok') { this.status = 'ok'; this.emit('status'); }
        } catch (e) {
          // вернуть в очередь и повторить позже
          this.outbox.events.unshift(...events);
          this.outbox.acts.unshift(...(first ? [first] : []), ...acts);
          this.status = 'offline'; this.statusText = e.message; this.emit('status');
          if (/устарело/.test(e.message)) { this.status = 'conflict'; this.runner.stop(); this.emit('status'); return; }
          setTimeout(() => this.flush(), 3000);
          return;
        }
      } while (this.again);
    } finally { this.flushing = false; }
  }
  submit(a) { return this.runner.submit({ ...a, seat: this.seat }); }
  /** По таймеру хода: сделать ход за игрока ботом «Средний». */
  forceBotMove(seat) { return this.runner.botMove(seat, 'medium'); }
  async replaceWithBot(seat, level = 'medium') {
    await this.api.rpc('set_seat_bot', { p_room: this.room.id, p_seat: this.map[seat], p_level: level, p_name: null });
    await this.reloadSeats();
  }
  async giveBack(seat) {
    await this.api.rpc('set_seat_bot', { p_room: this.room.id, p_seat: this.map[seat], p_level: null, p_name: null });
    await this.reloadSeats();
  }
  say(text) { this.presence?.send('chat', { seat: this.seat, name: this.seatsInfo()[this.seat]?.name, text }); }
  /** Удалить партию на сервере: предупредить гостей и стереть комнату. */
  async deleteRoom() {
    this.runner.stop();
    try { this.presence?.send('deleted', {}); } catch { /* канал может быть закрыт */ }
    await this.api.rpc('delete_room', { p_room: this.room.id });
  }
  close() { this.runner.stop(); this.unwatch?.(); this.presence?.close(); this.listeners.clear(); }
}
