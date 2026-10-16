// Сохранённые партии в этом браузере: для кнопки «Вернуться в партию» и офлайн-игры.
const KEY = 'bnr-sessions';
const safe = (f, d) => { try { return f(); } catch { return d; } };

export function listSessions() {
  return safe(() => JSON.parse(localStorage.getItem(KEY) || '[]'), []);
}
export function saveSession(s) {
  const old = listSessions().find((x) => x.backend === s.backend && x.room_id === s.room_id);
  const all = listSessions().filter((x) => !(x.backend === s.backend && x.room_id === s.room_id));
  all.unshift({ created: old?.created, players: old?.players, ...s, updated: Date.now() });
  safe(() => localStorage.setItem(KEY, JSON.stringify(all.slice(0, 20))));
}
export function patchSession(backend, room_id, patch) {
  const all = listSessions();
  const s = all.find((x) => x.backend === backend && x.room_id === room_id);
  if (s) { Object.assign(s, patch); safe(() => localStorage.setItem(KEY, JSON.stringify(all))); }
  if (patch.result) saveResult(backend, room_id, patch.result, s?.created);
}

// Архив итогов для рейтинга: отдельно от списка партий, чтобы итог не терялся,
// когда партия убрана из списка или вытеснена новыми (в списке хранятся только последние 20).
const RKEY = 'bnr-results';
const rkey = (backend, room_id) => `${backend}:${room_id}`;
function readResults() { return safe(() => JSON.parse(localStorage.getItem(RKEY) || '{}'), {}); }
export function saveResult(backend, room_id, result, created) {
  if (!result?.rows?.length) return;
  const all = readResults();
  all[rkey(backend, room_id)] = { result, created: created || all[rkey(backend, room_id)]?.created || Date.now() };
  safe(() => localStorage.setItem(RKEY, JSON.stringify(all)));
}
export function dropResult(backend, room_id) {
  const all = readResults(); delete all[rkey(backend, room_id)];
  safe(() => localStorage.setItem(RKEY, JSON.stringify(all)));
}
/** Все законченные партии этого браузера: архив + итоги, ещё лежащие только в списке партий (старые версии). */
export function listResults() {
  const all = readResults();
  for (const s of listSessions()) if (s.result?.rows?.length && !all[rkey(s.backend, s.room_id)]) all[rkey(s.backend, s.room_id)] = { result: s.result, created: s.created };
  return Object.values(all);
}
export function dropSession(backend, room_id) {
  safe(() => localStorage.setItem(KEY, JSON.stringify(listSessions().filter((x) => !(x.backend === backend && x.room_id === room_id)))));
}
export function loadOffline() { return safe(() => JSON.parse(localStorage.getItem('bnr-offline') || 'null'), null); }
export function saveOffline(data) { safe(() => localStorage.setItem('bnr-offline', JSON.stringify(data))); }
export function clearOffline() { safe(() => localStorage.removeItem('bnr-offline')); }
export function getPref(k, d) { return safe(() => localStorage.getItem('bnr-' + k) ?? d, d); }
export function setPref(k, v) { safe(() => localStorage.setItem('bnr-' + k, v)); }
