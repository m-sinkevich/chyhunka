// Боты «Сильный» и «Эксперт». Играют честно: видят только своё (view) — руку, свои маршруты, открытые карты, поле.
// Идея: держать общий план сети (дерево путей ко всем своим маршрутам и открыткам), оценивать каждый ход по очкам,
// пользе для плана, модулям (цели, «Соседи», конечные станции, открытки, путевые карты) и сквозному экспрессу.
// «Эксперт» перебирает больше вариантов: несколько порядков построения плана, наборы маршрутов при доборе,
// срочность спорных перегонов и концовку партии.
import { BotContext } from './common.js';
import { COLORS, POLESIE } from '../engine/data.js';
import { mediumTurn } from './medium.js';

const CFG = {
  strong: { orders: 1, ticketSearch: 'greedy', noise: 0.6, contest: 0.5, endgame: true, takeMore: 0.7 },
  expert: { orders: 4, ticketSearch: 'subsets', noise: 0, contest: 1.0, endgame: true, takeMore: 0.7 },
};

export const SMART_TUNE = {};   // для экспериментов в турнирах

class Smart extends BotContext {
  constructor(E, v, legal, rng, level) {
    super(E, v, legal, rng);
    this.P = { ...(CFG[level] || CFG.strong), ...SMART_TUNE };
    this.level = level;
    const tr = v.trains.filter((_, i) => i !== v.me);
    this.minOpp = tr.length ? Math.min(...tr) : 45;
    this.myTrains = v.trains[v.me];
    this.endSoon = v.endAfterTurnNo != null || this.minOpp <= 6 || this.myTrains <= 6;
    this.cache = new Map();
  }

  // ---------- граф ----------
  /** Стоимость перегона для плана: свой — 0, уже в плане — 0, свободный — вагоны + трудности. */
  w(r, planned) {
    if (this.mine(r)) return 0;
    if (!this.free(r)) return null;
    if (planned && planned.has(r.id)) return 0.01;
    let c = r.length + (r.ghost ? 1.5 : 0) + (r.tunnel ? 0.8 : 0) + (r.mountain ? 0.6 : 0);
    if (r.color === 'grey') c -= 0.2;
    return c;
  }
  /** Дейкстра от набора городов (моя сеть/план) до города. */
  path(srcs, dst, planned) {
    const { M } = this;
    const dist = new Map(), prev = new Map(), done = new Set();
    const q = [];
    for (const s of srcs) { dist.set(s, 0); q.push([0, s]); }
    while (q.length) {
      let bi = 0; for (let i = 1; i < q.length; i++) if (q[i][0] < q[bi][0]) bi = i;
      const [d, u] = q.splice(bi, 1)[0];
      if (done.has(u)) continue;
      done.add(u);
      if (u === dst) break;
      for (const r of M.adj[u]) {
        const c = this.w(r, planned);
        if (c == null) continue;
        const x = M.other(r, u);
        if (d + c < (dist.get(x) ?? Infinity)) { dist.set(x, d + c); prev.set(x, [u, r]); q.push([d + c, x]); }
      }
    }
    if (!dist.has(dst)) return null;
    const todo = [];
    for (let u = dst; prev.has(u);) { const [p, r] = prev.get(u); if (!this.mine(r) && !(planned && planned.has(r.id))) todo.push(r); u = p; }
    return { cost: dist.get(dst), todo };
  }
  /** Компонента моей сети + плана, содержащая город. */
  comp(city, planned) {
    const { M } = this;
    const seen = new Set([city]), st = [city];
    while (st.length) {
      const u = st.pop();
      for (const r of M.adj[u]) if (this.mine(r) || planned.has(r.id)) { const x = M.other(r, u); if (!seen.has(x)) { seen.add(x); st.push(x); } }
    }
    return seen;
  }

  // ---------- план ----------
  /** Цели плана: маршруты (пары городов) и открытки (касание города). */
  goalsList(extraTickets = []) {
    const { M, v, me } = this;
    const list = [];
    for (const t of [...(v.tickets[me] || []).map((id) => M.tickets[id]), ...extraTickets]) {
      if (this.connected(t.from, t.to)) continue;
      list.push({ kind: 'ticket', a: t.from, b: t.to, pts: t.points, id: t.id });
    }
    if (v.cfg.modules.tourism) for (const id of v.postcards[me] || []) {
      const p = M.postcards[id];
      if (!this.touched(p.city)) list.push({ kind: 'card', a: p.city, pts: p.points, id });
    }
    return list;
  }
  /** Строит план: набор перегонов, соединяющих всё, что нужно. Несколько порядков — берётся самый дешёвый. */
  buildPlan(goals, orders = this.P.orders) {
    const base = [...goals].sort((x, y) => y.pts - x.pts);
    const variants = [base];
    if (orders > 1) variants.push([...goals].sort((x, y) => x.pts - y.pts));
    for (let i = 2; i < orders; i++) { const g = [...goals]; this.rng.shuffle(g); variants.push(g); }
    let best = null;
    for (const order of variants) {
      const planned = new Map(); let cost = 0; const failed = [];
      for (const g of order) {
        let res;
        if (g.kind === 'ticket') {
          const net = this.netFrom(g.a, planned);
          res = net.has(g.b) ? { cost: 0, todo: [] } : this.path([...net], g.b, planned);
        } else {
          // открытка: дотянуться от сети/плана до города
          const srcs = this.networkCities(planned);
          res = srcs.length ? this.path(srcs, g.a, planned) : { cost: 0, todo: [] };
        }
        if (!res) { failed.push(g); continue; }
        for (const r of res.todo) planned.set(r.id, (planned.get(r.id) || 0) + g.pts);
        cost += res.todo.reduce((s, r) => s + r.length, 0);
        g._cost = res.todo.reduce((s, r) => s + r.length, 0);
      }
      const score = cost + failed.reduce((s, g) => s + g.pts * 0.5, 0);
      if (!best || score < best.score) best = { score, cost, planned, failed };
    }
    return best || { score: 0, cost: 0, planned: new Map(), failed: [] };
  }
  netFrom(city, planned) { return this.comp(city, planned); }
  networkCities(planned) {
    const { M } = this; const s = new Set();
    for (const r of M.routeList) if (this.mine(r) || planned.has(r.id)) { s.add(r.from); s.add(r.to); }
    return [...s];
  }
  netPlan() {
    if (!this._plan) {
      let goals = this.goalsList();
      let p = this.buildPlan(goals);
      // не хватает вагонов на всё — отказаться от самых невыгодных маршрутов
      let guard = 0;
      while (p.cost > this.myTrains && goals.length > 1 && guard++ < 6) {
        goals = [...goals].sort((x, y) => (x.pts / Math.max(1, x._cost || 1)) - (y.pts / Math.max(1, y._cost || 1)));
        goals.shift();
        p = this.buildPlan(goals);
      }
      this._plan = p;
    }
    return this._plan;
  }

  // ---------- оценка перегона ----------
  /** Сколько очков модулей и целей даёт захват перегона r. */
  moduleBonus(r) {
    const { M, v, me } = this;
    let s = 0;
    // конечная станция
    if (v.cfg.modules.terminus) for (const c of [r.from, r.to]) if (c in (v.terminus || {}) && v.terminus[c] == null) s += 3;
    // путевая карта на перегоне
    if (v.cfg.modules.routeCards && r.event) s += 0.8;
    // открытки
    if (v.cfg.modules.tourism) for (const id of v.postcards[me] || []) { const p = M.postcards[id]; if ((p.city === r.from || p.city === r.to) && !this.touched(p.city)) s += p.points * 1.6; }
    // «Соседи»: новые страны в сети через Беларусь (окружная не считается)
    if (v.cfg.modules.neighbors && !r.ring) s += this.neighborGain(r) * 12;
    // цели
    for (const gid of v.goals.open || []) {
      if (v.goals.race && v.goals.race[gid] != null) continue;
      const k = this.level === 'expert' ? 1 : 0.7;
      switch (gid) {
        case 'g_capital': if (r.from === 'minsk' || r.to === 'minsk') s += 1.6 * k; break;
        case 'g_vilnius': if (r.from === 'vilnius' || r.to === 'vilnius') s += 2 * k; break;
        case 'g_border': if (M.isBorder(r)) s += 1.5 * k; break;
        case 'g_polesie': if (POLESIE.includes(r.from) || POLESIE.includes(r.to)) s += 0.35 * r.length * k; break;
        case 'g_ring': if (r.ring) s += 0.5 * r.length * k; break;
        case 'g_local': for (const c of [r.from, r.to]) if (!this.touched(c)) s += 0.4 * k; break;
        case 'g_express': if (this.extendsNet(r)) s += 0.25 * r.length * k; break;
        default: break;
      }
    }
    return s;
  }
  extendsNet(r) { return this.touched(r.from) || this.touched(r.to); }
  neighborGain(r) {
    const { M, v, me } = this;
    const got = new Set((v.neighbors?.got?.[me] || []).map((g) => g.country));
    // сеть без окружной + этот перегон
    const own = M.routeList.filter((x) => (this.mine(x) && !x.ring) || x.id === r.id);
    const parent = {};
    const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    for (const x of own) { for (const c of [x.from, x.to]) if (!(c in parent)) parent[c] = c; parent[find(x.from)] = find(x.to); }
    const root = find(r.from);
    const countries = new Set();
    for (const [c, ctry] of Object.entries(M.country)) if (c in parent && find(c) === root) countries.add(ctry);
    if (countries.size < 2) return 0;
    let n = 0; for (const c of countries) if (!got.has(c)) n++;
    return n;
  }
  /** Спорность: одиночный перегон на плане, рядом с чужими сетями — занять раньше. */
  contested(r) {
    const { M, v } = this;
    if (M.siblings[r.id].length && !(v.n <= 3 || v.cfg.duelOn)) return 0.2;
    let near = 0;
    for (const c of [r.from, r.to]) for (const x of M.adj[c]) { const o = v.claims[x.id]; if (o != null && o !== v.me) near++; }
    return Math.min(1, 0.35 + near * 0.2);
  }
  /** Ценность занять перегон сейчас (вариант оплаты a). */
  claimValue(a, plan) {
    const { M, v, me } = this;
    const r = M.routes[a.route];
    const p = a.pay;
    let val = M.scoreFor(r.length) + (r.electrified && !r.ghost ? 1 : 0) + this.chainBonus(a);
    const inPlan = plan.planned.get(r.id);
    if (inPlan) {
      val += 4 + Math.min(inPlan, 30) * 0.45 + r.length * 0.6;
      val += this.contested(r) * this.P.contest * 6;
      if (this.completes(r)) val += 6;
    } else if (!this.endSoon) {
      // перегон вне плана: только если вагонов с запасом и он даёт что-то ещё
      const spare = this.myTrains - plan.cost;
      val *= spare > 12 ? 0.55 : spare > 6 ? 0.3 : 0.1;
      if (r.length <= 2) val -= 1.5;
    }
    val += this.moduleBonus(r);
    // цена карт: Локомотивы и цвета, нужные плану
    const need = this.need(plan);
    val -= p.loco * (this.endSoon ? 0.6 : 2.2);
    if (p.n && need[p.color]) val -= Math.max(0, p.n - Math.max(0, this.hand[p.color] - need[p.color])) * 0.5;
    // вагоны: не оставлять «дыру» в 1–2 вагона, если план ещё не закончен
    const left = this.myTrains - r.length;
    if (left < 0) return -Infinity;
    if (left < plan.cost - (inPlan ? r.length : 0) && !inPlan) val -= 6;
    return val;
  }
  completes(r) {
    const { M, v, me } = this;
    for (const id of v.tickets[me] || []) {
      const t = M.tickets[id];
      if (this.connected(t.from, t.to)) continue;
      // соединит ли этот перегон концы маршрута
      const a = this.netFrom(t.from, new Map([[r.id, 1]])); if (a.has(t.to)) return true;
    }
    return false;
  }
  need(plan) {
    if (this._need) return this._need;
    const need = {};
    for (const id of plan.planned.keys()) { const r = this.M.routes[id]; if (r.color !== 'grey') need[r.color] = (need[r.color] || 0) + r.length; }
    // серые — любой цвет: прибавить к самому «запасливому»
    let grey = 0; for (const id of plan.planned.keys()) { const r = this.M.routes[id]; if (r.color === 'grey') grey += r.length; }
    if (grey) { let bc = null; for (const c of COLORS) if (!bc || this.hand[c] > this.hand[bc]) bc = c; need[bc] = (need[bc] || 0) + grey; }
    return (this._need = need);
  }
  /** Какой перегон плана можно оплатить прямо сейчас. */
  affordable(plan) {
    return this.claims().filter((a) => plan.planned.has(a.route));
  }

  // ---------- карты ----------
  /** Сколько карт не хватает, чтобы занять перегон r (лучший цвет для серого, с учётом Локомотивов). */
  missing(r, hand = this.hand) {
    const need = r.length + (r.ghost ? 1 : 0);
    const minLoco = r.ghost || r.mountain ? 1 : 0;
    const cols = r.color === 'grey' ? COLORS : [r.color];
    let best = Infinity, bestCol = cols[0];
    for (const c of cols) {
      const useLoco = Math.max(minLoco, 0);
      const have = Math.min(hand[c], need - useLoco) + hand.loco;
      const miss = Math.max(0, need - have) + (hand.loco < minLoco ? minLoco - hand.loco : 0);
      if (miss < best || (miss === best && hand[c] > hand[bestCol])) { best = miss; bestCol = c; }
    }
    return { miss: best, color: bestCol };
  }
  /** Перегон плана, на который копим карты сейчас: меньше всего не хватает, спорные и ценные — раньше. */
  focus(plan) {
    if (this._focus !== undefined) return this._focus;
    let best = null;
    for (const [id, val] of plan.planned) {
      const r = this.M.routes[id];
      if (this.mine(r) || !this.free(r)) continue;
      const m = this.missing(r);
      const score = m.miss * 2 - Math.min(val, 30) * 0.08 - this.contested(r) * this.P.contest * 1.5 - r.length * 0.15;
      if (!best || score < best.score) best = { score, r, color: m.color, miss: m.miss };
    }
    return (this._focus = best);
  }
  draw(plan) {
    const { v, me, hand } = this;
    const draws = this.legal.filter((a) => a.type === 'draw');
    const ups = draws.filter((a) => a.source === 'up');
    const f = this.focus(plan);
    const need = this.need(plan);
    // 1) карта для перегона, на который копим
    if (f && f.miss > 0) {
      const up = ups.find((a) => a.card === f.color);
      if (up) return up;
      if (f.r.color === 'grey') { // для серого подойдёт цвет, которого уже больше всего
        const c = ups.filter((a) => a.card !== 'loco').sort((x, y) => hand[y.card] - hand[x.card])[0];
        if (c && hand[c.card] >= 2) return c;
      }
    }
    // 2) карта, полезная другим перегонам плана
    const deficit = (c) => Math.max(0, (need[c] || 0) - hand[c]);
    let best = null, bv = 0.9;
    for (const a of ups) {
      if (a.card === 'loco') continue;
      const d = deficit(a.card);
      let val = d > 0 ? 1 + Math.min(d, 4) * 0.25 : 0;
      const ch = v.chain[me];
      if (ch && ch.color === a.card) val += 0.3;
      if (val > bv) { bv = val; best = a; }
    }
    if (best) return best;
    // 3) Локомотив — когда он реально ускоряет (горный/призрачный перегон, большой недобор)
    const loco = ups.find((a) => a.card === 'loco');
    if (loco && v.ts.drawn === 0 && f) {
      const r = f.r;
      if (((r.ghost || r.mountain) && hand.loco === 0) || f.miss >= 3) return loco;
    }
    const deck = draws.filter((a) => a.source === 'deck');
    if (deck.length) return deck.find((a) => a.wh === me) || deck[0];
    return draws[0] || null;
  }

  // ---------- маршруты ----------
  /** Выбор маршрутов из предложенных: лучший набор с учётом общего плана и вагонов. */
  pickTickets(offer, min, maxLong = 9) {
    if (this.P.ticketSel === 'medium') return this.chooseTickets(offer, min, maxLong);
    const { M } = this;
    const avail = this.myTrains;
    const cur = this.goalsList();
    const tks = offer.map((id) => M.tickets[id]);
    const isLong = (t) => ['long', 'transit'].includes(t.set);
    const subsets = [];
    const n = tks.length;
    if (this.P.ticketSearch === 'subsets' || n <= 3) {
      for (let mask = 1; mask < 1 << n; mask++) {
        const pick = tks.filter((_, i) => mask & (1 << i));
        if (pick.length < min || pick.filter(isLong).length > maxLong) continue;
        subsets.push(pick);
      }
    } else {
      // жадно: по одному, пока выгодно
      const sorted = [...tks].sort((a, b) => b.points - a.points);
      for (let k = Math.max(1, min); k <= n; k++) subsets.push(sorted.slice(0, k).filter((t, i, arr) => arr.filter(isLong).length <= maxLong || !isLong(t)));
    }
    let best = null;
    const early = this.v.phase === 'setup' || this.v.turnNo <= this.v.n;
    for (const pick of subsets) {
      const goals = [...cur, ...pick.map((t) => ({ kind: 'ticket', a: t.from, b: t.to, pts: t.points, id: t.id }))];
      const p = this.buildPlan(goals, Math.min(2, this.P.orders));
      const budget = avail * (early ? 0.8 : 0.9) * this.P.takeMore;
      const over = Math.max(0, p.cost - budget);
      const pts = pick.reduce((s, t) => s + t.points, 0);
      // риск: чем больше перерасход, тем вероятнее провал всех новых
      const risk = over > 0 ? Math.min(1, over / 8) : 0;
      const failedPts = p.failed.reduce((s, g) => s + g.pts, 0);
      let score = pts * (1 - risk) - pts * risk - failedPts * 2 - p.cost * 0.15;
      if (this.v.goals.open?.includes('g_globe')) score += pick.length * 1.5 * (1 - risk);
      if (!best || score > best.score) best = { score, pick };
    }
    return (best ? best.pick : tks.slice(0, min)).map((t) => t.id);
  }
  pickPostcards(offer, min) {
    const { M } = this;
    const plan = this.netPlan();
    const net = new Set(this.networkCities(plan.planned));
    const scored = offer.map((id) => {
      const p = M.postcards[id];
      let d = net.has(p.city) ? 0 : 99;
      if (d) { const pl = net.size ? this.path([...net], p.city, plan.planned) : null; d = pl ? pl.cost : 99; }
      return { id, d, pts: p.points };
    }).sort((a, b) => (a.d - a.pts * 0.3) - (b.d - b.pts * 0.3));
    const keep = scored.filter((s) => s.d <= 3).map((s) => s.id);
    for (const s of scored) if (keep.length < min && !keep.includes(s.id)) keep.push(s.id);
    return keep;
  }

  // ---------- станции ----------
  /** Станция в конце: спасти маршрут, который иначе не выполнить. */
  stationMove(plan) {
    const { M, v, me } = this;
    const st = this.legal.find((a) => a.type === 'station');
    if (!st) return null;
    const cost = st.cost;
    const pay = this.stationPay(cost);
    if (!pay) return null;
    let best = null;
    for (const id of v.tickets[me] || []) {
      const t = M.tickets[id];
      if (this.connected(t.from, t.to)) continue;
      // город на краю моей сети, из которого чужой перегон доводит до другой части маршрута
      for (const city of st.cities) {
        if (!this.touched(city)) continue;
        for (const r of M.adj[city]) {
          const o = v.claims[r.id];
          if (o == null || o === me) continue;
          const pl = new Map([[r.id, 1]]);
          const net = this.comp(t.from, pl);
          // станция «одалживает» r; проверяем, замыкает ли это маршрут
          const fakeMine = (x) => this.mine(x) || x.id === r.id;
          const seen = new Set([t.from]); const stck = [t.from];
          while (stck.length) { const u = stck.pop(); for (const x of M.adj[u]) if (fakeMine(x)) { const y = M.other(x, u); if (!seen.has(y)) { seen.add(y); stck.push(y); } } }
          void net;
          if (seen.has(t.to)) { const gain = t.points * 2 - 4; if (!best || gain > best.gain) best = { gain, city }; }
        }
      }
    }
    if (best && best.gain > 3) return { type: 'station', seat: me, city: best.city, pay };
    return null;
  }
  stationPay(cost) {
    const h = this.hand;
    let best = null;
    for (const c of COLORS) if (h[c] > 0 && h[c] + h.loco >= cost) { const n = Math.min(h[c], cost); const p = { color: c, n, loco: cost - n }; if (!best || p.loco < best.loco) best = p; }
    if (!best && h.loco >= cost) best = { color: null, n: 0, loco: cost };
    return best;
  }

  // ---------- ход ----------
  turn() {
    const { v, me } = this;
    const plan = this.netPlan();
    if (v.ts.drawn === 1) return this.draw(plan);
    const claims = this.claims();
    // 1) лучший захват
    let best = null, bv = -Infinity;
    for (const a of claims) {
      const val = this.claimValue(a, plan) + (this.P.noise ? (this.rng.next() - 0.5) * this.P.noise : 0);
      if (val > bv) { bv = val; best = a; }
    }
    const openGoals = plan.planned.size;
    // порог: перегоны плана берём сразу, если они спорные или карты всё равно лежат; прочие — если выгодно
    let threshold = openGoals ? 6.5 : 4.5;
    const handSize = Object.values(this.hand).reduce((x, y) => x + y, 0);
    if (handSize >= 12) threshold -= 2;
    if (this.endSoon) threshold = 1;
    // 2) станция, если иначе маршрут не спасти (ближе к концу)
    if (this.endSoon || plan.failed.length) {
      const s = this.stationMove(plan);
      if (s && (this.endSoon || plan.failed.some((g) => g.kind === 'ticket'))) return s;
    }
    if (best && bv >= threshold) return this.withRaid(best);
    // 3) все маршруты выполнены — добрать новые, пока есть вагоны и время
    const slack = this.myTrains - plan.cost;
    const wantMore = !this.endSoon && this.minOpp >= 13 && slack >= (this.level === 'expert' ? 13 : 15) && (plan.cost <= 6 || !openGoals);
    if (wantMore) {
      const row = this.legal.find((a) => a.type === 'ticketRow');
      if (row) { const pick = this.pickTickets(row.row, 1, 9).slice(0, 2).map((id) => row.row.indexOf(id)).filter((i) => i >= 0); if (pick.length) return { type: 'ticketRow', seat: me, picks: pick }; }
      const t = this.legal.find((a) => a.type === 'tickets');
      if (t) return t;
    }
    // 4) нет цели — занять выгодный длинный перегон или копить карты
    if (best && (bv >= 3 || (!openGoals && bv >= 1.5))) return this.withRaid(best);
    const d = this.draw(plan);
    if (d) return d;
    if (best) return this.withRaid(best);
    return this.legal.find((a) => !a.template) || null;
  }
  /** Отложенные решения и подготовка. */
  special() {
    const a = this.legal[0];
    if (!a) return null;
    switch (a.type) {
      case 'tunnelPay': {
        const plan = this.netPlan();
        const pend = this.v.pending;
        const inPlan = pend && plan.planned.has(pend.route);
        const pays = this.legal.filter((x) => !x.decline).sort((x, y) => x.pay.loco - y.pay.loco);
        // доплачивать, если перегон в плане или конец близко; иначе беречь Локомотивы
        if (pays.length && (inPlan || this.endSoon || pays[0].pay.loco === 0)) return pays[0];
        return this.legal.find((x) => x.decline) || pays[0];
      }
      case 'keep': return { type: 'keep', seat: this.me, tickets: this.pickTickets(a.offer, a.min), postcards: this.pickPostcards(a.postOffer || [], 0) };
      case 'discard': return { type: 'discard', seat: this.me, cards: this.discardCards(a.count, this.need(this.netPlan())) };
      default: break;
    }
    const setup = this.legal.filter((x) => x.type.startsWith('setup'));
    if (setup.length) {
      const s = setup[0];
      if (s.type === 'setupTickets') return { type: s.type, seat: this.me, tickets: this.pickTickets(s.offer, s.min, s.maxLong) };
      if (s.type === 'setupPostcards') return { type: s.type, seat: this.me, postcards: this.pickPostcards(s.offer, s.min) };
      if (s.type === 'setupDepot') return this.common(new Map());
    }
    return undefined;
  }
}

export function smartMove(level) {
  return (E, v, legal, rng) => {
    const b = new Smart(E, v, legal, rng, level);
    const s = b.special();
    if (s !== undefined) return s;
    if (b.P.mode === 'mediumPlan') return mediumTurn(b, b.netPlan().planned);
    if (b.P.mode === 'mediumTargets') return mediumTurn(b, b.targets());
    return b.turn();
  };
}
