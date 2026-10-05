// Гость сетевой партии: читает свой private_view, пишет свои действия в actions и ждёт ответа хозяина.
export class GuestGame {
  constructor(E, api, room, mySeatDb) {
    this.E = E; this.api = api; this.room = room; this.mode = 'guest'; this.mySeatDb = mySeatDb;
    this.listeners = new Set(); this.events = []; this.eventIds = new Set(); this.online = new Set();
    this.waiting = new Map(); this.early = new Map(); this.view = null; this.seatsDb = [];
    this.hostOnline = false; this.status = 'ok';
  }
  get seat() { return this.view ? this.view.me : -1; }
  on(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
  emit(what) { for (const f of this.listeners) f(what); }
  seatsInfo() {
    if (!this.view) return [];
    return this.view.players.map((p) => {
      const s = this.seatsDb.find((x) => x.seat === p.dbSeat) || {};
      return { name: s.name || p.name, color: p.color, kind: s.kind || (p.bot ? 'bot' : 'human'), level: s.bot_level || p.bot || undefined, dbSeat: p.dbSeat };
    });
  }
  engineSeat(db) { return this.view ? this.view.players.findIndex((p) => p.dbSeat === db) : -1; }

  async start() {
    await Promise.all([this.reloadView(), this.reloadSeats()]);
    const evs = await this.api.select('events', { room_id: this.room.id }, { order: 'id', limit: 1000 });
    for (const e of evs) this.addEvent(e);
    this.unwatch = this.api.watch(this.room.id, ['private_views', 'public_state', 'events', 'actions', 'seats', 'rooms'], (t, row) => {
      if (t === 'private_views' || t === 'public_state' || t === '*') this.reloadViewSoon();
      if (t === 'events' && row) { this.addEvent(row); this.emit('events'); }
      if (t === 'actions' && row) this.actionUpdate(row);
      if (t === 'seats') this.reloadSeats();
      if ((t === 'rooms' && (!row || row.deleted || !row.id)) || t === '*') this.checkRoom(); // удаление комнаты
    });
    this.presence = this.api.channel('room:' + this.room.code, { seat: this.mySeatDb });
    setTimeout(() => { this.presenceSeen = true; this.emit('presence'); }, 4000);
    this.presence.onPresence((list) => {
      this.online = new Set(list.map((m) => this.engineSeat(m.seat)).filter((s) => s >= 0));
      this.hostOnline = list.some((m) => m.host);
      this.emit('presence');
    });
    this.presence.onBroadcast('deleted', () => this.markDeleted());
    this.presence.onBroadcast('rematch', (m) => { this.rematch = m; this.emit('rematch'); });
    this.presence.onBroadcast('chat', (m) => { this.events.push({ text: `${m.name}: «${m.text}»`, kind: 'chat', seat: m.seat }); this.emit('chat'); });
    this.emit('view');
  }
  addEvent(e) {
    if (e.id != null) { if (this.eventIds.has(e.id)) return; this.eventIds.add(e.id); }
    const ev = { text: e.text, seq: e.seq, vis: e.visibility == null ? 'all' : e.visibility, ...(e.data || {}), _id: e.id };
    // события приходят по сети не всегда по порядку — ставим по номеру, иначе «Ходит X» окажется между двумя взятыми картами
    let i = this.events.length;
    if (e.id != null) while (i > 0 && (this.events[i - 1]._id == null ? false : this.events[i - 1]._id > e.id)) i--;
    this.events.splice(i, 0, ev);
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
  }
  reloadViewSoon() {
    clearTimeout(this.rvTimer);
    this.rvTimer = setTimeout(() => this.reloadView().catch((e) => { this.status = 'offline'; this.statusText = e.message; this.emit('status'); this.checkRoom(); }), 30);
  }
  /** Комната исчезла — значит, хозяин удалил партию. */
  async checkRoom() {
    if (this.status === 'deleted') return;
    try { const r = await this.api.select('rooms', { id: this.room.id }); if (!r.length) this.markDeleted(); } catch { /* нет связи — не значит, что удалена */ }
  }
  markDeleted() {
    if (this.status === 'deleted') return;
    this.status = 'deleted'; this.statusText = 'Хозяин удалил эту партию';
    this.emit('status');
  }
  async reloadView() {
    const [pv] = await this.api.select('private_views', { room_id: this.room.id, seat: this.mySeatDb });
    if (pv && (!this.view || pv.view.seq >= this.view.seq)) {
      this.view = pv.view;
      if (this.status !== 'ok') { this.status = 'ok'; this.emit('status'); }
      this.emit('view');
    }
  }
  async reloadSeats() {
    this.seatsDb = await this.api.select('seats', { room_id: this.room.id }, { order: 'seat' });
    const me = this.seatsDb.find((s) => s.seat === this.mySeatDb);
    if (me && me.uid !== this.api.uid) { this.status = 'lost'; this.statusText = 'Ваше место заняли с другого устройства или отдали боту'; this.emit('status'); }
    this.emit('seats');
  }
  actionUpdate(row) {
    if (row.status === 'pending') return;
    const w = this.waiting.get(row.id);
    const res = row.status === 'applied' ? { ok: true } : { ok: false, error: row.error || 'Ход отклонён' };
    if (w) { this.waiting.delete(row.id); clearTimeout(w.timer); w.resolve(res); return; }
    this.early.set(row.id, res);
    if (!res.ok && Date.now() - Date.parse(row.created_at || 0) > 3000) { this.lastError = res.error; this.emit('error'); }
  }
  /** Отправить действие хозяину. Ответ приходит, когда хозяин его обработает. */
  async submit(a) {
    if (!this.view) return { ok: false, error: 'Партия ещё не загружена' };
    let row;
    try {
      row = await this.api.insert('actions', { room_id: this.room.id, seat: this.mySeatDb, base_seq: this.view.seq, payload: { ...a, seat: this.view.me } });
    } catch (e) { return { ok: false, error: e.message }; }
    if (this.early.has(row.id)) { const r = this.early.get(row.id); this.early.delete(row.id); return r; }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(row.id);
        resolve({ ok: false, queued: true, error: this.hostOnline ? 'Хозяин долго не отвечает — ход в очереди' : 'Хозяин не в сети — ход обработается, когда он вернётся' });
      }, 20000);
      this.waiting.set(row.id, { resolve, timer });
    });
  }
  say(text) { this.presence?.send('chat', { seat: this.seat, name: this.seatsInfo()[this.seat]?.name, text }); }
  close() { this.unwatch?.(); this.presence?.close(); this.listeners.clear(); }
}
