import { afterEach, describe, expect, test, vi } from 'vitest';

describe('supabase client factory', () => {
  const importModule = async () => import('../../src/lib/supabase');

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('returns null when url/key missing (with credentials helper)', async () => {
    const mod = await importModule();
    expect(mod.createSupabaseClientWithCredentials({ persistSession: false })).toBeNull();
    expect(
      mod.createSupabaseClientWithCredentials({
        persistSession: false,
        url: 'https://x.supabase.co'
      })
    ).toBeNull();
  });

  test('returns client object when credentials exist (with credentials helper)', async () => {
    const mod = await importModule();
    const client = mod.createSupabaseClientWithCredentials({
      persistSession: false,
      url: 'https://example.supabase.co',
      anonKey: 'public-anon-key'
    });
    expect(client).toBeTruthy();
    expect(typeof client).toBe('object');
  });

  test('createSupabaseClient returns null when VITE env is empty', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const mod = await importModule();
    expect(mod.createSupabaseClient({ persistSession: false })).toBeNull();
  });

  test('createSupabaseClient returns client when VITE env is present', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    const mod = await importModule();
    const client = mod.createSupabaseClient({ persistSession: false });
    expect(client).toBeTruthy();
  });
});

