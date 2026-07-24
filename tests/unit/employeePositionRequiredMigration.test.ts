import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

describe('required employee position migration', () => {
  const migrationPath = resolve(
    process.cwd(),
    'supabase/migrations/20260724033000_require_employee_position.sql'
  );
  const migrationSql = readFileSync(migrationPath, 'utf8');

  test('backfills blank JDL admin-account positions to JDL', () => {
    expect(migrationSql).toContain("v_default_position text := 'JDL'");
    expect(migrationSql).toContain("v_agency in ('JDL', '自顾')");
    expect(migrationSql).toContain('jsonb_populate_record');
  });

  test('rejects blank positions for other employee writes', () => {
    expect(migrationSql).toContain("raise exception 'Position is required.'");
    expect(migrationSql).toContain('before insert or update');
  });
});
