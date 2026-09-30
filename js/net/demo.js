// «Демо-сеть»: та же игра по сети, но без Supabase — между вкладками одного браузера.
// База лежит в IndexedDB (транзакции не теряют записи при одновременной работе вкладок),
// уведомления идут через BroadcastChannel, у каждой вкладки свой игрок.
// Логика функций и правил доступа повторяет supabase/schema.sql, чтобы проверять сетевой код без сервера.

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TABLES = ['rooms', 'seats', 'secrets', 'public_state', 'private_views', 'host_state', 'actions', 'events'];

const init = (db) => { db ||= { nextId: 1 }; for (const t of TABLES) db[t] ||= []; return db; };

/** Хранилище в памяти/строке (для тестов в Node): операции выполняются по очереди. */
function textStore(storage, key) {
  const load = () => { try { return init(JSON.parse(storage.getItem(key) || 'null')); } catch { return init(null); } };
  return {
    async tx(fn) { const db = load(); const out = fn(db); storage.setItem(key, JSON.stringify(db)); return out; },
    async read(fn) { return fn(load()); },
  };
}

/** IndexedDB: одна запись с базой, каждая операция — отдельная транзакция. */
function idbStore(name) {
  const opened = new Promise((res, rej) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const run = (mode, fn) => opened.then((idb) => new Promise((res, rej) => {
    const t = idb.transaction('kv', mode);
    const os = t.objectStore('kv');
    const g = os.get('db');
    let out; let err = null;
    g.onsuccess = () => {
      const db = init(g.result);
      try { out = fn(db); } catch (e) { err = e; t.abort(); return; }
      if (mode === 'readwrite') os.put(db, 'db');
    };
    t.oncomplete = () => res(out);
    t.onabort = () => rej(err || t.error);
    t.onerror = () => rej(err || t.error);
  }));
  return { tx: (fn) => run('readwrite', fn), read: (fn) => run('readonly', fn) };
}

export function openDemo({ storage = null, session = globalThis.sessionStorage, key = 'bnr-demo-db', bcName = 'bnr-demo', uid, rateLimit = 10 } = {}) {
  const myUid = uid || session?.getItem('bnr-demo-uid') || crypto.randomUUID();
  session?.setItem?.('bnr-demo-uid', myUid);
  const bc = new BroadcastChannel(bcName);
  const listeners = new Set();
  let closed = false;
  const notify = (msg) => { if (closed) return; try { bc.postMessage(msg); } catch { /* канал закрыт */ } for (const f of listeners) f(msg); };
  bc.onmessage = (e) => { for (const f of listeners) f(e.data); };

  const store = storage ? textStore(storage, key) : globalThis.indexedDB ? idbStore(key) : textStore(globalThis.localStorage, key);
  const fail = (m) => { throw new Error(m); };
  const code = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => ALPHA[b % ALPHA.length]).join('');
  const hash = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const isHost = (db, room) => db.rooms.some((r) => r.id === room && r.host_uid === myUid);
  const mySeat = (db, room) => db.seats.find((s) => s.room_id === room && s.uid === myUid)?.seat ?? null;
  const isMember = (db, room) => mySeat(db, room) != null || isHost(db, room);
  const now = () => new Date().toISOString();
  const touch = (db, room, patch = {}) => { const r = db.rooms.find((x) => x.id === room); Object.assign(r, patch, { updated_at: now() }); };
  const changed = (table, row) => notify({ table, room_id: row.room_id ?? row.id, row, t: Date.now() });

  const RPC = {
    create_room(db, { p_name, p_config, p_rules }) {
      if (!p_name?.trim() || p_name.length > 20) fail('Имя — от 1 до 20 символов');
      let c; do c = code(6); while (db.rooms.some((r) => r.code === c));
      const room = { id: crypto.randomUUID(), code: c, host_uid: myUid, status: 'lobby', config: p_config || {}, rules_version: p_rules, created_at: now(), updated_at: now() };
      db.rooms.push(room);
      for (let i = 0; i < 5; i++) db.seats.push({ room_id: room.id, seat: i, kind: i < 2 ? 'human' : 'closed', bot_level: null, uid: i === 0 ? myUid : null, name: i === 0 ? p_name.trim() : null, color: i === 0 ? 'pink' : null });
      const ret = code(8);
      db.secrets.push({ room_id: room.id, seat: 0, h: hash(ret) });
      return { out: { room_id: room.id, code: c, seat: 0, return_code: ret }, touched: [['rooms', room], ['seats', { room_id: room.id }]] };
    },
    join_room(db, { p_code, p_name }) {
      if (!p_name?.trim() || p_name.length > 20) fail('Имя — от 1 до 20 символов');
      const r = db.rooms.find((x) => x.code === String(p_code).trim().toUpperCase());
      if (!r) fail('Комната не найдена');
      const mine = db.seats.find((s) => s.room_id === r.id && s.uid === myUid);
      if (mine) return { out: { room_id: r.id, code: r.code, seat: mine.seat, return_code: null, status: r.status } };
      if (r.status !== 'lobby') fail('Партия уже идёт. Чтобы вернуться на своё место, введите код возврата');
      const s = db.seats.filter((x) => x.room_id === r.id && x.kind === 'human' && !x.uid).sort((a, b) => a.seat - b.seat)[0];
      if (!s) fail('Свободных мест нет');
      Object.assign(s, { uid: myUid, name: p_name.trim(), color: s.color || ['pink', 'cyan', 'lime', 'pumpkin', 'violet'][s.seat] });
      const ret = code(8);
      db.secrets = db.secrets.filter((x) => !(x.room_id === r.id && x.seat === s.seat));
      db.secrets.push({ room_id: r.id, seat: s.seat, h: hash(ret) });
      touch(db, r.id);
      return { out: { room_id: r.id, code: r.code, seat: s.seat, return_code: ret, status: r.status }, touched: [['seats', s]] };
    },
    claim_seat(db, { p_code, p_seat, p_return_code }) {
      const r = db.rooms.find((x) => x.code === String(p_code).trim().toUpperCase());
      if (!r) fail('Комната не найдена');
      if (!db.secrets.some((x) => x.room_id === r.id && x.seat === p_seat && x.h === hash(p_return_code))) fail('Неверный код возврата');
      for (const s of db.seats) if (s.room_id === r.id && s.uid === myUid && s.seat !== p_seat) s.uid = null;
      const s = db.seats.find((x) => x.room_id === r.id && x.seat === p_seat);
      Object.assign(s, { uid: myUid, kind: 'human', bot_level: null });
      if (p_seat === 0) r.host_uid = myUid;
      touch(db, r.id);
      return { out: { room_id: r.id, code: r.code, seat: p_seat, status: r.status }, touched: [['seats', s], ['rooms', r]] };
    },
    update_lobby(db, { p_room, p_config, p_seats }) {
      if (!isHost(db, p_room)) fail('Только хозяин меняет настройки');
      const r = db.rooms.find((x) => x.id === p_room);
      if (r.status !== 'lobby') fail('Партия уже началась');
      if (p_config) r.config = p_config;
      for (const x of p_seats || []) {
        const s = db.seats.find((y) => y.room_id === p_room && y.seat === x.seat);
        if (x.seat === 0) { s.color = x.color || s.color; continue; }
        s.kind = x.kind;
        s.bot_level = x.kind === 'bot' ? x.bot_level || 'medium' : null;
        if (x.kind !== 'human') s.uid = null;
        s.name = x.kind === 'bot' ? (x.name || 'Бот').slice(0, 20) : x.kind === 'human' ? s.name : null;
        s.color = x.color || s.color;
      }
      touch(db, p_room);
      return { touched: [['rooms', r], ['seats', { room_id: p_room }]] };
    },
    update_my_seat(db, { p_room, p_name, p_color }) {
      const r = db.rooms.find((x) => x.id === p_room);
      if (!r || r.status !== 'lobby') fail('Партия уже началась');
      const s = db.seats.find((y) => y.room_id === p_room && y.uid === myUid);
      if (s) { if (p_name?.trim()) s.name = p_name.trim().slice(0, 20); if (p_color) s.color = p_color; }
      return { touched: [['seats', { room_id: p_room }]] };
    },
    commit_turn(db, a) {
      const room = a.p_room;
      if (!isHost(db, room)) fail('Только хозяин ведёт партию');
      const hs = db.host_state.find((x) => x.room_id === room);
      if (hs && a.p_seq <= hs.seq && a.p_host) fail('Состояние устарело (открыта вторая вкладка хозяина?)');
      const touched = [];
      if (a.p_host) {
        upsert(db.host_state, { room_id: room, seq: a.p_seq, state: a.p_host }, ['room_id']);
        const ps = upsert(db.public_state, { room_id: room, seq: a.p_seq, state: a.p_public, updated_at: now() }, ['room_id']);
        touched.push(['public_state', ps]);
        for (const pv of a.p_privates || []) touched.push(['private_views', upsert(db.private_views, { room_id: room, seat: pv.seat, seq: a.p_seq, view: pv.view }, ['room_id', 'seat'])]);
        for (const ev of a.p_events || []) {
          const row = { id: db.nextId++, room_id: room, seq: a.p_seq, visibility: ev.vis === 'all' || ev.vis == null ? null : ev.vis, text: ev.text, data: ev.data || null, created_at: now() };
          db.events.push(row); touched.push(['events', row]);
        }
      }
      if (a.p_action != null) {
        const act = db.actions.find((x) => x.id === a.p_action && x.room_id === room);
        if (act) { act.status = a.p_action_status; act.error = a.p_error; touched.push(['actions', act]); }
      }
      touch(db, room, a.p_room_status ? { status: a.p_room_status } : {});
      touched.push(['rooms', db.rooms.find((x) => x.id === room)]);
      return { touched };
    },
    set_seat_bot(db, { p_room, p_seat, p_level, p_name }) {
      if (!isHost(db, p_room)) fail('Только хозяин');
      if (p_seat === 0) fail('Место хозяина нельзя отдать боту');
      const s = db.seats.find((y) => y.room_id === p_room && y.seat === p_seat);
      Object.assign(s, p_level ? { kind: 'bot', bot_level: p_level, uid: null } : { kind: 'human', bot_level: null, uid: null });
      if (p_name) s.name = p_name;
      return { touched: [['seats', s]] };
    },
    delete_room(db, { p_room }) {
      if (!isHost(db, p_room)) fail('Удалить партию может только хозяин');
      for (const t of TABLES) if (t !== 'rooms') db[t] = db[t].filter((x) => x.room_id !== p_room);
      db.rooms = db.rooms.filter((x) => x.id !== p_room);
      return { touched: [['rooms', { id: p_room, deleted: true }]] };
    },
    ping() { return { out: now() }; },
  };

  function upsert(arr, row, keys) {
    const i = arr.findIndex((x) => keys.every((k) => x[k] === row[k]));
    if (i >= 0) arr[i] = { ...arr[i], ...row }; else arr.push(row);
    return i >= 0 ? arr[i] : row;
  }

  // правила чтения — как политики RLS в schema.sql
  const canRead = (db, table, row) => {
    const room = table === 'rooms' ? row.id : row.room_id;
    switch (table) {
      case 'rooms': case 'seats': case 'public_state': return isMember(db, room);
      case 'private_views': return mySeat(db, room) === row.seat;
      case 'host_state': return isHost(db, room);
      case 'actions': return row.uid === myUid || isHost(db, room);
      case 'events': return isMember(db, room) && (row.visibility == null || row.visibility === mySeat(db, room));
      default: return false;
    }
  };

  function selectIn(db, table, eq = {}, opts = {}) {
    if (!db[table]) fail('Нет таблицы ' + table);
    let rows = db[table].filter((r) => Object.entries(eq).every(([k, v]) => r[k] === v) && canRead(db, table, r));
    if (opts.gt) rows = rows.filter((r) => Object.entries(opts.gt).every(([k, v]) => r[k] > v));
    if (opts.order) rows.sort((a, b) => (a[opts.order] > b[opts.order] ? 1 : -1) * (opts.asc === false ? -1 : 1));
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return JSON.parse(JSON.stringify(rows));
  }
  function insertIn(db, row) {
    const r = db.rooms.find((x) => x.id === row.room_id);
    if (!r || r.status !== 'playing' || mySeat(db, row.room_id) !== row.seat) fail('new row violates row-level security policy for table "actions"');
    const recent = db.actions.filter((a) => a.uid === myUid && Date.now() - Date.parse(a.created_at) < 5000).length;
    if (rateLimit && recent >= rateLimit) fail('Слишком часто. Подождите пару секунд');
    const out = { id: db.nextId++, room_id: row.room_id, seat: row.seat, uid: myUid, base_seq: row.base_seq, payload: row.payload, status: 'pending', error: null, created_at: now() };
    db.actions.push(out);
    return out;
  }

  const channels = new Map();
  const api = {
    kind: 'demo',
    uid: myUid,
    async rpc(name, args) {
      const fn = RPC[name];
      if (!fn) fail('Нет функции ' + name);
      const res = await store.tx((db) => fn(db, args || {}));
      for (const [t, row] of res.touched || []) changed(t, row);
      return res.out ?? null;
    },
    async select(table, eq = {}, opts = {}) {
      return store.read((db) => selectIn(db, table, eq, opts));
    },
    async insert(table, row) {
      if (table !== 'actions') fail('Запись в эту таблицу запрещена');
      const out = await store.tx((db) => insertIn(db, row));
      changed('actions', out);
      return out;
    },
    watch(roomId, tables, cb) {
      const f = (m) => {
        if (!m.table || m.presence || m.bc || m.room_id !== roomId || !tables.includes(m.table)) return;
        store.read((db) => {
          const row = m.row && m.row.id !== undefined && m.table !== 'rooms' ? (db[m.table].find((x) => x.id === m.row.id) || m.row) : m.row;
          if (row && row.room_id !== undefined && !canRead(db, m.table, row) && m.table !== 'seats') return null;
          return JSON.parse(JSON.stringify(row));
        }).then((row) => { if (row !== null) cb(m.table, row, 'UPDATE'); }, () => {});
      };
      listeners.add(f);
      setTimeout(() => cb('*', null, 'SUBSCRIBED'), 0);
      return () => listeners.delete(f);
    },
    channel(name, meta) {
      const peers = new Map();
      const handlers = { presence: [], bc: {} };
      let me = { ...meta, uid: myUid };
      const emit = () => {
        const cut = Date.now() - 8000;
        for (const [k, v] of peers) if (v.t < cut) peers.delete(k);
        const list = [me, ...[...peers.values()].map((p) => p.meta)];
        handlers.presence.forEach((f) => f(list));
      };
      const beat = () => notify({ presence: name, uid: myUid, meta: me });
      const f = (m) => {
        if (m.presence === name && m.uid !== myUid) {
          const isNew = !peers.has(m.uid);
          if (m.leave) peers.delete(m.uid); else peers.set(m.uid, { meta: m.meta, t: Date.now() });
          if (isNew && !m.leave) beat();
          emit();
        }
        if (m.bc === name) (handlers.bc[m.event] || []).forEach((h) => h(m.data));
      };
      listeners.add(f);
      const timer = setInterval(() => { beat(); emit(); }, 3000);
      setTimeout(() => { beat(); emit(); }, 0);
      const ch = {
        onPresence: (h) => handlers.presence.push(h),
        onBroadcast: (event, h) => (handlers.bc[event] ||= []).push(h),
        send: (event, data) => notify({ bc: name, event, data }),
        update: (m) => { me = { ...me, ...m }; beat(); emit(); },
        close: () => { clearInterval(timer); notify({ presence: name, uid: myUid, leave: true }); listeners.delete(f); },
      };
      channels.set(name, ch);
      return ch;
    },
    close() { for (const c of channels.values()) c.close(); closed = true; bc.close(); },
  };
  return api;
}
