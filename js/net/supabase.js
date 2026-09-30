// Подключение к Supabase: анонимный вход, RPC, чтение таблиц, подписки Realtime, Presence.
// Наружу отдаётся тот же небольшой интерфейс, что и у демо-сети (demo.js).
const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

export async function openSupabase(url, anonKey) {
  const { createClient } = await import(SUPABASE_ESM);
  const sb = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'bnr-auth' },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  let { data: { session } } = await sb.auth.getSession();
  if (!session) {
    const { data, error } = await sb.auth.signInAnonymously();
    if (error) throw new Error(explain(error));
    session = data.session;
  }
  const uid = session.user.id;
  const unwrap = ({ data, error }) => { if (error) throw new Error(explain(error)); return data; };
  const api = {
    kind: 'supabase',
    uid,
    async rpc(name, args) { return unwrap(await sb.rpc(name, args)); },
    async select(table, eq = {}, opts = {}) {
      let q = sb.from(table).select('*').match(eq);
      if (opts.gt) for (const [k, v] of Object.entries(opts.gt)) q = q.gt(k, v);
      if (opts.order) q = q.order(opts.order, { ascending: opts.asc !== false });
      if (opts.limit) q = q.limit(opts.limit);
      return unwrap(await q);
    },
    async insert(table, row) { return unwrap(await sb.from(table).insert(row).select().single()); },
    /** Подписка на изменения строк комнаты. cb(table, newRow, eventType). */
    watch(roomId, tables, cb) {
      const ch = sb.channel(`db-${roomId}-${Math.random().toString(36).slice(2, 8)}`);
      for (const t of tables) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: t === 'rooms' ? `id=eq.${roomId}` : `room_id=eq.${roomId}` },
          (p) => cb(t, p.new, p.eventType));
      }
      ch.subscribe((status) => { if (status === 'SUBSCRIBED') cb('*', null, 'SUBSCRIBED'); });
      return () => sb.removeChannel(ch);
    },
    /** Канал комнаты: кто в сети (Presence) и короткие сообщения (Broadcast). */
    channel(name, meta) {
      const ch = sb.channel(name, { config: { presence: { key: uid }, broadcast: { self: true } } });
      const handlers = { presence: [], bc: {} };
      ch.on('presence', { event: 'sync' }, () => {
        const list = Object.values(ch.presenceState()).map((arr) => arr[0]).filter(Boolean);
        handlers.presence.forEach((f) => f(list));
      });
      ch.on('broadcast', { event: 'msg' }, ({ payload }) => (handlers.bc[payload.event] || []).forEach((f) => f(payload.data)));
      ch.subscribe(async (s) => { if (s === 'SUBSCRIBED') await ch.track({ ...meta, uid }); });
      return {
        onPresence: (f) => handlers.presence.push(f),
        onBroadcast: (event, f) => (handlers.bc[event] ||= []).push(f),
        send: (event, data) => ch.send({ type: 'broadcast', event: 'msg', payload: { event, data } }),
        update: (m) => ch.track({ ...meta, ...m, uid }),
        close: () => sb.removeChannel(ch),
      };
    },
  };
  return api;
}

function explain(error) {
  const m = error.message || String(error);
  if (/Anonymous sign-ins are disabled/i.test(m)) return 'В проекте Supabase выключен анонимный вход (Authentication → Providers → Anonymous)';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Нет связи с сервером Supabase. Проверьте интернет; бесплатный проект мог уснуть — откройте его в панели Supabase';
  if (/JWT|apikey|Invalid API key/i.test(m)) return 'Неверный ключ Supabase в config.js';
  return m;
}
