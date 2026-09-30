// Офлайн-партия с ботами: всё в этом браузере, сохраняется в localStorage.
import { GameRunner } from './runner.js';
import { saveOffline } from './sessions.js';

export class LocalGame {
  constructor(E, state, kinds, log = []) {
    this.E = E; this.mode = 'local'; this.seat = 0; this.listeners = new Set();
    this.events = log; this.online = new Set(state.players.map((_, i) => i));
    this.kinds = kinds;
    this.runner = new GameRunner(E, state, {
      kinds,
      botDelay: () => (this.fast ? 150 : 700 + Math.random() * 600),
      persist: async (st, events) => {
        if (this.closed) return; // партию закрыли (или удалили) — ход бота, который уже шёл, не сохраняем
        for (const e of events) if (e.vis === 'all' || e.vis === this.seat) this.events.push({ ...e, seq: st.seq });
        if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
        saveOffline({ state: st, kinds, log: this.events });
      },
      onApplied: () => this.emit('view'),
    });
    this.view = E.view(state, this.seat);
  }
  get state() { return this.runner.st; }
  seatsInfo() { return this.state.players.map((p, i) => ({ name: p.name, color: p.color, kind: this.kinds[i].kind, level: this.kinds[i].level })); }
  on(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
  emit(what) { this.view = this.E.view(this.state, this.seat); for (const f of this.listeners) f(what); }
  start() { this.runner.scheduleBots(); this.emit('view'); }
  submit(a) { return this.runner.submit({ ...a, seat: this.seat }); }
  setFast(v) { this.fast = v; }
  close() { this.closed = true; this.runner.stop(); this.listeners.clear(); }
}
