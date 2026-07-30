import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

describe('Agency leave deadline migration', () => {
  const datedSqlPath = resolve(
    process.cwd(),
    'sql/2026-07-27_enforce_agency_leave_24_hour_deadline.sql'
  );
  const supabaseMigrationPath = resolve(
    process.cwd(),
    'supabase/migrations/20260727000000_enforce_agency_leave_24_hour_deadline.sql'
  );
  const readSql = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
  const datedSql = readSql(datedSqlPath);
  const supabaseMigrationSql = readSql(supabaseMigrationPath);

  test.each([
    ['dated SQL', datedSql],
    ['Supabase migration', supabaseMigrationSql]
  ])('%s enforces the personal shift start and 24-hour boundary', (_label, sql) => {
    expect(sql).toContain("v_shift_time text := ''");
    expect(sql).toContain('v_shift_start timestamptz := null');
    expect(sql).toContain("'07:00'");
    expect(sql).toContain("'15:00'");
    expect(sql).toContain("v_shift_start - interval '24 hours'");
    expect(sql).toContain(
      'Leave requests must be submitted more than 24 hours before shift start.'
    );
    expect(sql).toContain(
      'agency_set_schedule_state_without_leave_deadline(text, date, text, text)'
    );
    expect(sql).toContain(
      'revoke all on function public.agency_set_schedule_state_without_leave_deadline'
    );
    expect(sql).toContain(
      'revoke all on function public.agency_set_planned_leave(text, date, text)'
    );
  });

  test('keeps the dated SQL and Supabase migration identical', () => {
    expect(datedSql).not.toBe('');
    expect(supabaseMigrationSql).toBe(datedSql);
  });
});
