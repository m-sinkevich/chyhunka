// Сохранённые партии в этом браузере: для кнопки «Вернуться в партию» и офлайн-игры.
const KEY = 'bnr-sessions';
const safe = (f, d) => { try { return f(); } catch { return d; } };

export function listSessions() {
  return safe(() => JSON.parse(localStorage.getItem(KEY) || '[]'), []);
}
export function saveSession(s) {
  const all = listSessions().filter((x) => !(x.backend === s.backend && x.room_id === s.room_id));
  all.unshift({ ...s, updated: Date.now() });
  safe(() => localStorage.setItem(KEY, JSON.stringify(all.slice(0, 20))));
}
export function patchSession(backend, room_id, patch) {
  const all = listSessions();
  const s = all.find((x) => x.backend === backend && x.room_id === room_id);
  if (s) { Object.assign(s, patch, { updated: Date.now() }); safe(() => localStorage.setItem(KEY, JSON.stringify(all))); }
}
export function dropSession(backend, room_id) {
  safe(() => localStorage.setItem(KEY, JSON.stringify(listSessions().filter((x) => !(x.backend === backend && x.room_id === room_id)))));
}
export function loadOffline() { return safe(() => JSON.parse(localStorage.getItem('bnr-offline') || 'null'), null); }
export function saveOffline(data) { safe(() => localStorage.setItem('bnr-offline', JSON.stringify(data))); }
export function clearOffline() { safe(() => localStorage.removeItem('bnr-offline')); }
export function getPref(k, d) { return safe(() => localStorage.getItem('bnr-' + k) ?? d, d); }
export function setPref(k, v) { safe(() => localStorage.setItem('bnr-' + k, v)); }
