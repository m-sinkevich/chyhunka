// Лобби сетевой партии: создание комнаты, вход по коду, возврат по коду, настройки хозяина.
import { RULES_VERSION } from '../engine/index.js';
import { saveSession } from './sessions.js';

// Цвета игроков — неоновые, чтобы не путать с цветами перегонов на поле.
export const PLAYER_COLORS = { pink: '#FF1F8F', cyan: '#00D9E8', lime: '#8CF01A', pumpkin: '#FF5E00', violet: '#9B4DFF' };
export const PLAYER_COLOR_NAMES = { pink: 'малиновый', cyan: 'бирюзовый', lime: 'салатовый', pumpkin: 'тыквенный', violet: 'электрик' };
const LEGACY = { red: 'pink', blue: 'cyan', green: 'lime', yellow: 'pumpkin', black: 'violet' };
/** Цвет игрока по ключу (старые ключи из прежних версий тоже понимаются). */
export const playerColor = (key) => PLAYER_COLORS[key] || PLAYER_COLORS[LEGACY[key]] || '#888';
export const PLAYER_COLOR_KEYS = Object.keys(PLAYER_COLORS);

export async function createRoom(api, name, config) {
  const r = await api.rpc('create_room', { p_name: name, p_config: config, p_rules: RULES_VERSION });
  saveSession({ backend: api.kind, room_id: r.room_id, code: r.code, seat: r.seat, return_code: r.return_code, name, host: true });
  return r;
}
export async function joinRoom(api, code, name) {
  const r = await api.rpc('join_room', { p_code: code, p_name: name });
  saveSession({ backend: api.kind, room_id: r.room_id, code: r.code, seat: r.seat, return_code: r.return_code ?? undefined, name, host: r.seat === 0 });
  return r;
}
export async function claimSeat(api, code, seat, returnCode, name) {
  const r = await api.rpc('claim_seat', { p_code: code, p_seat: Number(seat), p_return_code: returnCode });
  saveSession({ backend: api.kind, room_id: r.room_id, code: r.code, seat: r.seat, return_code: returnCode, name: name || '', host: r.seat === 0 });
  return r;
}

export class Lobby {
  constructor(api, roomId) { this.api = api; this.roomId = roomId; this.listeners = new Set(); this.room = null; this.seats = []; this.online = new Set(); }
  on(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
  emit(w) { for (const f of this.listeners) f(w); }
  get isHost() { return this.room && this.room.host_uid === this.api.uid; }
  get mySeat() { return this.seats.find((s) => s.uid === this.api.uid)?.seat ?? null; }
  async load() {
    const [room] = await this.api.select('rooms', { id: this.roomId });
    if (!room) throw new Error('Комната не найдена или у вас нет к ней доступа');
    this.room = room;
    this.seats = await this.api.select('seats', { room_id: this.roomId }, { order: 'seat' });
    this.emit('change');
  }
  async start() {
    await this.load();
    this.unwatch = this.api.watch(this.roomId, ['rooms', 'seats'], () => { clearTimeout(this.t); this.t = setTimeout(() => this.load().catch(() => {}), 80); });
    this.presence = this.api.channel('room:' + this.room.code, { seat: this.mySeat, host: this.isHost });
    this.presence.onPresence((list) => { this.online = new Set(list.map((m) => m.seat)); this.emit('presence'); });
  }
  async save(config, seats) { await this.api.rpc('update_lobby', { p_room: this.roomId, p_config: config, p_seats: seats }); }
  async setMe(name, color) { await this.api.rpc('update_my_seat', { p_room: this.roomId, p_name: name, p_color: color }); }
  close() { this.unwatch?.(); this.presence?.close(); this.listeners.clear(); }
}
