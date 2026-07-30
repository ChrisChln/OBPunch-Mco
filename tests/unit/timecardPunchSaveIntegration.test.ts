import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/admin/AdminAppPage.tsx'), 'utf8');
const saveStart = source.indexOf('const saveAllTimecardPunchRows = async () => {');
const saveEnd = source.indexOf('const deleteTimecardPunchRow = async', saveStart);
const saveSource = source.slice(saveStart, saveEnd);

describe('timecard punch editor integration', () => {
  test('uses position-aware operation access for the selected employee', () => {
    expect(source).toContain('canOperateTimecardPunches(');
    expect(source).toContain("canOperatePosition('timecard', position)");
    expect(source).toContain('const timecardPunchCanOperate =');
    expect(source).toContain('timecardRows.find((item)');
    expect(source).toContain('const accessPosition = getTimecardPunchPosition(staff)');
  });

  test('saves the staged batch through the atomic RPC', () => {
    expect(saveSource).toContain("supabase.rpc('save_timecard_punch_changes'");
    expect(saveSource).toContain('parseTimecardPunchSaveResult(');
    expect(saveSource).toContain('computeConfirmedOperationalDayHours(');
  });

  test('reports audit failure separately and refreshes confirmed data immediately', () => {
    expect(saveSource).toContain('const primaryAuditSaved = await writeAudit(');
    expect(saveSource).toContain('打卡已保存，但操作记录写入失败。');
    expect(saveSource).toContain('await fetchTimecard({ reset: true, lockUi: false })');
  });

  test('does not directly mutate ob_punches inside the batch save handler', () => {
    expect(saveSource).not.toMatch(/\.from\('ob_punches'\)[\s\S]*?\.update\(/);
    expect(saveSource).not.toMatch(/\.from\('ob_punches'\)[\s\S]*?\.insert\(/);
    expect(saveSource).not.toMatch(/\.from\('ob_punches'\)[\s\S]*?\.delete\(/);
  });
});
