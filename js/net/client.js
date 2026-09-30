// Выбор «сервера»: Supabase из config.js или демо-сеть между вкладками браузера.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../config.js';
import { openSupabase } from './supabase.js';
import { openDemo } from './demo.js';

let current = null;

export const supabaseConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** kind: 'supabase' | 'demo'. Подключение переиспользуется. */
export async function backend(kind) {
  if (current && current.kind === kind) return current;
  if (kind === 'supabase') {
    if (!supabaseConfigured()) throw new Error('Supabase не настроен: заполните config.js (см. README.md)');
    current = await openSupabase(SUPABASE_URL, SUPABASE_ANON_KEY);
  } else current = openDemo();
  return current;
}
