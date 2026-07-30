import { existsSync, readFileSync } from 'node:fs';
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

describe('employee metadata column consolidation migration', () => {
  const datedSqlPath = resolve(
    process.cwd(),
    'sql/2026-07-27_consolidate_employee_metadata_columns.sql'
  );
  const supabaseMigrationPath = resolve(
    process.cwd(),
    'supabase/migrations/20260727190000_consolidate_employee_metadata_columns.sql'
  );
  const readSql = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
  const datedSql = readSql(datedSqlPath);
  const supabaseMigrationSql = readSql(supabaseMigrationPath);

  test.each([
    ['dated SQL', datedSql],
    ['Supabase migration', supabaseMigrationSql]
  ])('%s snapshots and consolidates employee metadata safely', (_label, sql) => {
    expect(sql).toContain('ob_employee_metadata_column_backup_20260727');
    expect(sql).toContain('coalesce(nullif(btrim(employee."Agency")');
    expect(sql).toContain('coalesce(nullif(btrim(employee."Position")');
    expect(sql).toContain('raise exception');
    expect(sql).toContain('drop column "Agency"');
    expect(sql).toContain('drop column "Position"');
    expect(sql.toLowerCase()).not.toContain('cascade');
  });

  test.each([
    ['dated SQL', datedSql],
    ['Supabase migration', supabaseMigrationSql]
  ])('%s validates before dropping and installs a lowercase-only guard', (_label, sql) => {
    const validationIndex = sql.indexOf('Position consolidation left blank values');
    const dropIndex = sql.indexOf('drop column "Agency"');
    expect(validationIndex).toBeGreaterThan(-1);
    expect(dropIndex).toBeGreaterThan(validationIndex);
    expect(sql).toContain('new.agency');
    expect(sql).toContain('new.position');
    expect(sql).not.toContain("to_jsonb(new) ->> 'Position'");
    expect(sql).not.toContain("to_jsonb(new) ->> 'Agency'");
  });

  test('keeps the dated SQL and Supabase migration identical', () => {
    expect(datedSql).not.toBe('');
    expect(supabaseMigrationSql).toBe(datedSql);
  });
});
