// Игровой движок «Чыгунка». Без DOM и сети — работает в браузере и в Node.
//   const E = makeEngine(mapJson);
//   let st = E.init(config, players, seed);
//   const legal = E.legal(st, seat);
//   ({ state: st, events } = E.apply(st, action));   // ошибка правил → RuleError
//   E.view(st, seat) — что видит игрок; E.publicView(st) — общая часть.
import { prepare } from './data.js';
import { initState, normalizeConfig, RULES_VERSION, TICKET_SETS, MODULES, PRESETS } from './state.js';
import { apply } from './apply.js';
import { legalActions, claimOptions } from './actions.js';
import { view, publicView } from './view.js';
import { finalScore } from './scoring.js';
import { RuleError } from './rules.js';
import * as rules from './rules.js';

export { RuleError, RULES_VERSION, TICKET_SETS, MODULES, PRESETS, normalizeConfig };
export * from './data.js';

export function makeEngine(map) {
  const M = prepare(map);
  return {
    M,
    init: (cfg, players, seed) => initState(M, cfg, players, seed),
    apply: (st, action) => apply(M, st, action),
    legal: (st, seat) => legalActions(M, st, seat),
    claimOptions: (st, seat, routeId, use) => claimOptions(M, st, seat, routeId, use),
    view: (st, seat) => view(M, st, seat),
    publicView: (st) => publicView(M, st),
    finalScore: (st) => finalScore(M, st),
    rules,
    neighborCountries: (routes, cfg = {}) => rules.neighborCountries(M, routes, cfg),
    neighborPoints: (k, cfg = {}) => rules.neighborPoints(cfg, k),
    /** Кто сейчас должен действовать: список мест. */
    waitingFor: (st) => {
      if (st.phase === 'over') return [];
      if (st.pend.length) return [st.pend[0].seat];
      if (st.phase === 'setup') {
        const s = new Set([...Object.keys(st.setup.tickets), ...Object.keys(st.setup.postcards)].map(Number));
        if (st.setup.depotOrder.length) s.add(st.setup.depotOrder[0]);
        return [...s].sort();
      }
      return [st.turn];
    },
  };
}
