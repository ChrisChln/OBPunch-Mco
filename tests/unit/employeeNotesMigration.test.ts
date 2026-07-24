import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const migrationPath = path.resolve(process.cwd(), 'sql/2026-07-23_add_admin_employee_notes.sql');
const migrationSql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
const editorMigrationPath = path.resolve(process.cwd(), 'sql/2026-07-23_add_employee_note_editors.sql');
const editorMigrationSql = existsSync(editorMigrationPath) ? readFileSync(editorMigrationPath, 'utf8') : '';

describe('admin employee notes migration', () => {
  test('keeps admin notes in a separate protected table', () => {
    expect(migrationSql).toContain('create table if not exists public.ob_admin_employee_notes');
    expect(migrationSql).toContain('alter table public.ob_admin_employee_notes enable row level security');
    expect(migrationSql).toContain('char_length(note) <= 500');
  });

  test('exposes combined reads while keeping role-specific writes separate', () => {
    expect(migrationSql).toContain('create or replace function public.get_employee_notes()');
    expect(migrationSql).toContain('create or replace function public.admin_upsert_employee_note(');
    expect(migrationSql).toContain("public.user_has_position_access('employees', v_position, 'operate', v_user_id)");
    expect(migrationSql).toContain("public.user_has_position_access('schedule', v_position, 'operate', v_user_id)");
    expect(migrationSql).toContain('public.agency_user_can_access_employee(employee.staff_id, v_user_id)');
    expect(migrationSql).toContain('revoke all on public.ob_admin_employee_notes from authenticated');
  });

  test('returns the latest editor name for both note owners', () => {
    expect(editorMigrationSql).toContain("'agency_note_updated_by'");
    expect(editorMigrationSql).toContain("'admin_note_updated_by'");
    expect(editorMigrationSql).toContain('agency_note.updated_by');
    expect(editorMigrationSql).toContain('admin_note.updated_by');
    expect(editorMigrationSql).toContain('agency_editor_profile.display_name');
    expect(editorMigrationSql).toContain('admin_editor_profile.display_name');
  });
});
