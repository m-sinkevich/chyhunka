// Ведение партии: очередь действий, движок, ходы ботов. Общее для офлайн-игры и хозяина сетевой партии.
import { RuleError } from '../engine/index.js';
import { botAction, fallback } from '../bots/index.js';
import { makeRng } from '../engine/rng.js';

export class GameRunner {
  /**
   * kinds: [{kind:'human'|'bot', level}] по местам движка.
   * persist(state, events, meta) — сохранить результат действия (localStorage или Supabase).
   */
  constructor(E, state, { kinds, persist, onApplied, botDelay = () => 900 }) {
    this.E = E; this.st = state; this.kinds = kinds; this.persist = persist; this.onApplied = onApplied;
    this.botDelay = botDelay; this.queue = Promise.resolve(); this.timers = {}; this.paused = false;
    this.rng = makeRng((state.seed ^ 0x5bd1e995) >>> 0);
  }
  /** Применить действие по очереди. Возвращает {ok} или {ok:false, error}. */
  submit(action, meta = {}) {
    const run = async () => {
      let res;
      try { res = this.E.apply(this.st, action); } catch (e) {
        if (!(e instanceof RuleError)) console.error(e);
        return { ok: false, error: e instanceof RuleError ? e.message : 'Внутренняя ошибка: ' + e.message };
      }
      this.st = res.state;
      await this.persist(this.st, res.events, meta);
      this.onApplied?.(res.events, meta);
      this.scheduleBots();
      return { ok: true };
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }
  setKind(seat, kind, level) { this.kinds[seat] = { kind, level }; this.scheduleBots(); }
  scheduleBots() {
    if (this.paused || this.st.phase === 'over') return;
    for (const seat of this.E.waitingFor(this.st)) {
      const k = this.kinds[seat];
      if (!k || k.kind !== 'bot' || this.timers[seat]) continue;
      this.timers[seat] = setTimeout(() => {
        delete this.timers[seat];
        if (this.paused || !this.E.waitingFor(this.st).includes(seat) || this.kinds[seat]?.kind !== 'bot') return;
        this.botMove(seat, k.level);
      }, this.botDelay(seat));
    }
  }
  /** Ход бота за место (также «сходить за игрока» по таймеру). */
  botMove(seat, level = 'medium') {
    const a = botAction(this.E, this.st, seat, level, this.rng);
    if (!a) return Promise.resolve({ ok: false, error: 'Нет действий' });
    return this.submit(a, { bot: true }).then((r) => {
      if (r.ok) return r;
      console.warn('ход бота отклонён', r.error, a);
      const f = fallback(this.E.legal(this.st, seat), seat);
      return f ? this.submit({ ...f, seat }, { bot: true }) : r;
    });
  }
  stop() { this.paused = true; for (const t of Object.values(this.timers)) clearTimeout(t); this.timers = {}; }
}
