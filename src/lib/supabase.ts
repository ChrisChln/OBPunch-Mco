import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export function createSupabaseClient(options: { persistSession: boolean }) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: options.persistSession,
      autoRefreshToken: options.persistSession,
      detectSessionInUrl: options.persistSession
    },
    realtime: { params: { eventsPerSecond: 0 } }
  });
}

