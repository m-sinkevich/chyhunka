// Партии бот против бота в Node: node tools/tournament.mjs <games> <levels через запятую> [config-json]
import { readFileSync } from 'node:fs';
import { makeEngine } from '../js/engine/index.js';
import { makeRng } from '../js/engine/rng.js';
import { botAction } from '../js/bots/index.js';
import { RuleError } from '../js/engine/index.js';

const MAP = JSON.parse(readFileSync(new URL('../data/map.json', import.meta.url)));
const E = makeEngine(MAP);
const games = Number(process.argv[2] || 200);
const levels = (process.argv[3] || 'medium,easy').split(',');
const cfg = process.argv[4] ? JSON.parse(process.argv[4]) : {};
const n = levels.length;
const wins = Array(n).fill(0), totals = Array(n).fill(0);
let turns = 0, errors = 0, margins = [], slowest = 0, stuck = 0;
for (let g = 0; g < games; g++) {
  // места по кругу, чтобы уравнять первый ход
  const order = levels.map((_, i) => (i + g) % n);
  const rng = makeRng(9000 + g);
  let st = E.init(cfg, order.map((k) => ({ name: levels[k] + k, color: 'red' })), 12345 + g * 7);
  let steps = 0;
  while (st.phase !== 'over' && steps < 3000) {
    for (const seat of E.waitingFor(st)) {
      const t0 = Date.now();
      const a = botAction(E, st, seat, levels[order[seat]], rng);
      slowest = Math.max(slowest, Date.now() - t0);
      try { st = E.apply(st, a).state; } catch (e) { if (!(e instanceof RuleError)) throw e; errors++; st = E.apply(st, { type: 'draw', seat, source: 'deck', wh: seat }).state; }
      steps++;
      if (st.phase === 'over') break;
    }
  }
  if (st.phase !== 'over') { stuck++; continue; }
  turns += st.turnNo;
  const rows = st.result.rows;
  const w = st.result.order[0];
  wins[order[w]]++;
  rows.forEach((r, s) => { totals[order[s]] += r.total; });
  const srt = rows.map((r) => r.total).sort((a, b) => b - a); margins.push(srt[0] - srt[1]);
}
margins.sort((a, b) => a - b);
console.log(JSON.stringify({ games, levels, cfg, win: wins.map((w) => +(w / games).toFixed(3)), avg: totals.map((t) => +(t / games).toFixed(1)), turns: +(turns / games).toFixed(1), marginMedian: margins[margins.length >> 1], close10: +(margins.filter((m) => m <= 10).length / games).toFixed(3), errors, stuck, slowestMs: slowest }));
