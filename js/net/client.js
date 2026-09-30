// Выбор «сервера»: Supabase из config.js или демо-сеть между вкладками браузера.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../config.js';
import { openSupabase } from './supabase.js';
import { openDemo } from './demo.js';

let current = null;

export const supabaseConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** Нужен только адрес проекта: https://xxxx.supabase.co. Частая ошибка — скопировать адрес с хвостом /rest/v1/. */
export function cleanSupabaseUrl(u) {
  let s = String(u || '').trim();
  try { const x = new URL(s); s = x.origin; } catch { s = s.replace(/\/(rest|auth|realtime|storage)\/v1.*$/i, '').replace(/\/+$/, ''); }
  return s;
}

/** kind: 'supabase' | 'demo'. Подключение переиспользуется. */
export async function backend(kind) {
  if (current && current.kind === kind) return current;
  if (kind === 'supabase') {
    if (!supabaseConfigured()) throw new Error('Supabase не настроен: заполните config.js (см. README.md)');
    current = await openSupabase(cleanSupabaseUrl(SUPABASE_URL), String(SUPABASE_ANON_KEY).trim());
  } else current = openDemo();
  return current;
}
