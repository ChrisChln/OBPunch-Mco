import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export function createSupabaseClientWithCredentials(options: {
  persistSession: boolean;
  url?: string;
  anonKey?: string;
}) {
  if (!options.url || !options.anonKey) {
    return null;
  }

  return createClient(options.url, options.anonKey, {
    auth: {
      persistSession: options.persistSession,
      autoRefreshToken: options.persistSession,
      detectSessionInUrl: options.persistSession
    },
    realtime: { params: { eventsPerSecond: 10 } }
  });
}

export function createSupabaseClient(options: { persistSession: boolean }) {
  return createSupabaseClientWithCredentials({
    persistSession: options.persistSession,
    url: supabaseUrl,
    anonKey: supabaseAnonKey
  });
}

