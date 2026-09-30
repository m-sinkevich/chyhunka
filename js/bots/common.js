// Общие помощники ботов. Бот видит только то, что видел бы человек на его месте: view + legal.
import { COLORS } from '../engine/data.js';

export class BotContext {
  constructor(E, v, legal, rng) {
    this.E = E; this.M = E.M; this.v = v; this.legal = legal; this.rng = rng; this.me = v.me;
    this.hand = v.hand;
  }
  // перегон свободен для меня (без учёта карт)
  free(r) {
    const { v, M, me } = this;
    if (v.removed[r.id] || v.claims[r.id] != null) return false;
    for (const s of M.siblings[r.id]) {
      const o = v.claims[s];
      if (o == null) continue;
      if (v.n <= 3 || v.cfg.duelOn || o === me) return false;
    }
    return true;
  }
  mine(r) { return this.v.claims[r.id] === this.me; }
  /** Кратчайший путь по своим (0) и свободным перегонам. Возвращает {cost, todo:[routes]} или null. */
  plan(a, b) {
    const { M } = this;
    const dist = { [a]: 0 }, prev = {}, done = new Set();
    const q = [[0, a]];
    while (q.length) {
      q.sort((x, y) => x[0] - y[0]);
      const [d, u] = q.shift();
      if (done.has(u)) continue;
      done.add(u);
      if (u === b) break;
      for (const r of M.adj[u]) {
        let w;
        if (this.mine(r)) w = 0;
        else if (this.free(r)) w = r.length + (r.ghost ? 1.5 : 0) + (r.tunnel ? 0.8 : 0) + (r.mountain ? 0.5 : 0);
        else continue;
        const x = M.other(r, u);
        if (d + w < (dist[x] ?? Infinity)) { dist[x] = d + w; prev[x] = [u, r]; q.push([d + w, x]); }
      }
    }
    if (dist[b] == null) return null;
    const todo = [];
    for (let u = b; u !== a;) { const [p, r] = prev[u]; if (!this.mine(r)) todo.push(r); u = p; }
    return { cost: dist[b], todo };
  }
  connected(a, b) {
    const { M } = this;
    const seen = new Set([a]), st = [a];
    while (st.length) {
      const u = st.pop();
      if (u === b) return true;
      for (const r of M.adj[u]) if (this.mine(r)) { const x = M.other(r, u); if (!seen.has(x)) { seen.add(x); st.push(x); } }
    }
    return false;
  }
  touched(city) {
    return this.M.adj[city].some((r) => this.mine(r)) || (this.v.stationsAt[city] || []).includes(this.me);
  }
  openTickets() {
    return (this.v.tickets[this.me] || []).map((id) => this.M.tickets[id]).filter((t) => !this.connected(t.from, t.to));
  }
  /** Перегоны на пути к моим невыполненным маршрутам с «ценностью». */
  targets() {
    const out = new Map();
    for (const t of this.openTickets()) {
      const p = this.plan(t.from, t.to);
      if (!p) continue;
      for (const r of p.todo) out.set(r.id, (out.get(r.id) || 0) + t.points);
    }
    return out;
  }
  claims() { return this.legal.filter((a) => a.type === 'claim'); }
  /** Лучшая оплата: цвет цепочки, меньше Локомотивов, реже нужный цвет. */
  bestPay(options, need = {}) {
    const ch = this.v.chain[this.me];
    let best = null, bv = -Infinity;
    for (const a of options) {
      const p = a.pay;
      let val = -p.loco * 3 - (need[p.color] || 0) * 0.3;
      if (ch && p.color && ch.color === p.color) val += 2;
      if (val > bv) { bv = val; best = a; }
    }
    return best;
  }
  chainBonus(a) {
    const ch = this.v.chain[this.me];
    const r = this.M.routes[a.route];
    if (!this.v.cfg.chain || !ch) return 0;
    if (!(ch.ends.includes(r.from) || ch.ends.includes(r.to))) return 0;
    const col = a.pay.n > 0 ? a.pay.color : null;
    if (col && ch.color && col !== ch.color) return 0;
    if (ch.len + r.length > 10) return 0;
    return this.M.scoreFor(ch.len + r.length) - this.M.scoreFor(ch.len) - this.M.scoreFor(r.length);
  }
  neededColors(targets) {
    const need = {};
    for (const id of targets.keys()) { const r = this.M.routes[id]; if (r.color !== 'grey') need[r.color] = (need[r.color] || 0) + r.length; }
    return need;
  }
  /** Взять карту: нужный цвет из открытых, иногда Локомотив, иначе вслепую. */
  drawFor(need, locoChance = 0.35) {
    const draws = this.legal.filter((a) => a.type === 'draw');
    const h = this.hand;
    const ups = draws.filter((a) => a.source === 'up');
    const good = ups.filter((a) => a.card !== 'loco' && (need[a.card] || 0) > h[a.card]);
    good.sort((x, y) => (need[y.card] - h[y.card]) - (need[x.card] - h[x.card]));
    if (good.length) return good[0];
    const loco = ups.find((a) => a.card === 'loco');
    if (loco && this.v.ts.drawn === 0 && this.rng.next() < locoChance) return loco;
    const deck = draws.filter((a) => a.source === 'deck');
    if (deck.length) return deck.find((a) => a.wh === this.me) || deck[0];
    return draws[0] || null;
  }
  /** Оценка маршрутов для выбора: выгода за вагон с учётом бюджета. */
  chooseTickets(offer, min, maxLong = 9) {
    const { M } = this;
    const trains = this.v.trains[this.me];
    let budget = trains - this.openTickets().reduce((s, t) => s + (this.plan(t.from, t.to)?.cost || 0), 0);
    const scored = offer.map((id) => {
      const t = M.tickets[id];
      const p = this.plan(t.from, t.to);
      const cost = p ? p.cost : 99;
      return { id, cost, long: ['long', 'transit'].includes(t.set), val: t.points / Math.max(cost, 1) - cost / Math.max(trains, 1) };
    }).sort((a, b) => b.val - a.val);
    const keep = [];
    let longs = 0;
    for (const s of scored) {
      if (s.long && longs >= maxLong) continue;
      if (keep.length < min || s.cost <= budget * 0.8) { keep.push(s.id); budget -= s.cost; if (s.long) longs++; }
    }
    for (const s of scored) if (keep.length < min && !keep.includes(s.id) && !(s.long && longs >= maxLong)) keep.push(s.id);
    return keep;
  }
  choosePostcards(offer, min) {
    const { M } = this;
    const scored = offer.map((id) => {
      const p = M.postcards[id];
      let d = 99;
      for (const t of (this.v.tickets[this.me] || []).map((x) => M.tickets[x])) {
        for (const end of [t.from, t.to]) { const pl = this.plan(end, p.city); if (pl) d = Math.min(d, pl.cost); }
      }
      if (this.touched(p.city)) d = 0;
      return { id, d, pts: p.points };
    }).sort((a, b) => a.d - b.d || b.pts - a.pts);
    const keep = scored.filter((s) => s.d === 0).map((s) => s.id);
    for (const s of scored) if (keep.length < min && !keep.includes(s.id)) keep.push(s.id);
    return keep;
  }
  discardCards(count, need = {}) {
    const pool = [];
    for (const c of [...COLORS, 'loco']) for (let i = 0; i < this.hand[c]; i++) pool.push(c);
    pool.sort((a, b) => (a === 'loco' ? 1 : 0) - (b === 'loco' ? 1 : 0) || (need[a] || 0) - (need[b] || 0));
    const out = {};
    for (const c of pool.slice(0, count)) out[c] = (out[c] || 0) + 1;
    return out;
  }
  /** Ответы на отложенные решения и подготовку — общие для всех ботов. */
  common(targets) {
    const a = this.legal[0];
    if (!a) return null;
    const need = this.neededColors(targets || new Map());
    switch (a.type) {
      case 'tunnelPay': {
        const pays = this.legal.filter((x) => !x.decline).sort((x, y) => x.pay.loco - y.pay.loco);
        return pays[0] || this.legal.find((x) => x.decline);
      }
      case 'keep': return { type: 'keep', seat: this.me, tickets: this.chooseTickets(a.offer, a.min), postcards: this.choosePostcards(a.postOffer, 0) };
      case 'discard': return { type: 'discard', seat: this.me, cards: this.discardCards(a.count, need) };
    }
    const setup = this.legal.filter((x) => x.type.startsWith('setup'));
    if (setup.length) {
      const s = setup[0];
      if (s.type === 'setupTickets') return { type: s.type, seat: this.me, tickets: this.chooseTickets(s.offer, s.min, s.maxLong) };
      if (s.type === 'setupPostcards') return { type: s.type, seat: this.me, postcards: this.choosePostcards(s.offer, s.min) };
      if (s.type === 'setupDepot') {
        const hubs = s.cities.filter((c) => ['capital', 'oblast', 'hub'].includes(this.M.cities[c].type));
        return { type: s.type, seat: this.me, city: this.rng.pick(hubs.length ? hubs : s.cities) };
      }
    }
    return undefined;
  }
  /** Если занятый перегон ведёт в город с депо — забрать склад (если там есть карты). */
  withRaid(a) {
    if (!a || a.type !== 'claim' || !this.v.cfg.modules.depots) return a;
    const r = this.M.routes[a.route];
    let left = this.v.depotsHome[this.me];
    const raid = [];
    for (const c of [r.from, r.to]) {
      const o = this.v.depots[c];
      if (o != null && left > 1 && this.v.warehouseCounts[o] >= 3) { raid.push(c); left--; }
    }
    return raid.length ? { ...a, raid } : a;
  }
}
