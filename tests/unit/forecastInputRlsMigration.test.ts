import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

const readMigration = (filename: string) =>
  readFileSync(resolve(process.cwd(), 'sql', filename), 'utf8').replace(/\s+/g, ' ').toLowerCase();

const readSupabaseMigration = (filename: string) =>
  readFileSync(resolve(process.cwd(), 'supabase', 'migrations', filename), 'utf8').replace(/\s+/g, ' ').toLowerCase();

describe('forecast input RLS migration', () => {
  const expectForecastInputRlsPolicies = (source: string) => {
    expect(source).toContain('grant select, insert, update on public.volume_forecast_daily_inputs to authenticated');
    expect(source).toContain('for select to authenticated using (public.user_has_module_access(\'forecast\', \'view\'))');
    expect(source).toContain('for insert to authenticated with check (public.user_has_module_access(\'forecast\', \'operate\'))');
    expect(source).toContain('for update to authenticated using (public.user_has_module_access(\'forecast\', \'operate\')) with check (public.user_has_module_access(\'forecast\', \'operate\'))');
  };

  test('allows forecast operators to maintain daily input rows', () => {
    expectForecastInputRlsPolicies(readMigration('2026-07-10_fix_volume_forecast_daily_inputs_rls.sql'));
    expectForecastInputRlsPolicies(readSupabaseMigration('20260710101500_fix_volume_forecast_daily_inputs_rls.sql'));
  });
});
