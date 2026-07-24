import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

const sqlPath = resolve(process.cwd(), 'sql/2026-07-24_save_timecard_punch_changes.sql');
const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260724170000_save_timecard_punch_changes.sql'
);
const readSql = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : '');

describe('timecard punch save migration', () => {
  const sql = readSql(sqlPath);
  const migrationSql = readSql(migrationPath);

  test.each([
    ['dated SQL', sql],
    ['Supabase migration', migrationSql]
  ])('%s defines the authorized atomic RPC', (_label, source) => {
    expect(source).toContain('create or replace function public.save_timecard_punch_changes');
    expect(source).toContain('security definer');
    expect(source).toContain('set search_path = public, pg_temp');
    expect(source).toContain('if auth.uid() is null then');
    expect(source).toContain(
      "public.user_can_access_staff_position('timecard', v_staff_id, 'operate')"
    );
    expect(source).toContain('for update');
    expect(source).toContain("raise exception 'Punch record not found:");
    expect(source).toContain("raise exception 'Punch record belongs to another employee:");
    expect(source).toContain("raise exception 'Punch timestamp is outside the operational day.'");
    expect(source).toContain("raise exception 'Punch edit does not change the record:");
    expect(source).toContain('v_created_at is null');
    expect(source).toContain('v_existing.created_at < v_range_start');
    expect(source).toContain('(p_work_date + 1)::timestamp without time zone');
    expect(source).toContain(
      'revoke all on function public.save_timecard_punch_changes(text, date, jsonb, jsonb, jsonb, text) from public'
    );
    expect(source).toContain(
      'grant execute on function public.save_timecard_punch_changes(text, date, jsonb, jsonb, jsonb, text) to authenticated'
    );
  });

  test('keeps the dated SQL and Supabase migration identical', () => {
    expect(sql).not.toBe('');
    expect(migrationSql).toBe(sql);
  });
});
