import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

const normalizeSql = (path: string) => readFileSync(path, 'utf8').replace(/\s+/g, ' ').toLowerCase();

const expectVolumeHistoryPolicies = (source: string) => {
  expect(source).toContain('alter table public.volume_history enable row level security');
  expect(source).toContain('grant select, insert, update on public.volume_history to authenticated');
  expect(source).toContain("for select to authenticated using (public.user_has_module_access('forecast', 'view'))");
  expect(source).toContain("for insert to authenticated with check (public.user_has_module_access('forecast', 'operate'))");
  expect(source).toContain(
    "for update to authenticated using (public.user_has_module_access('forecast', 'operate')) with check (public.user_has_module_access('forecast', 'operate'))"
  );
};

describe('volume history RLS migration', () => {
  test('allows Forecast viewers to read and operators to import hourly history', () => {
    expectVolumeHistoryPolicies(
      normalizeSql(resolve(process.cwd(), 'sql', '2026-07-30_fix_volume_history_rls.sql'))
    );
    expectVolumeHistoryPolicies(
      normalizeSql(resolve(process.cwd(), 'supabase', 'migrations', '20260730120000_fix_volume_history_rls.sql'))
    );
  });
});
